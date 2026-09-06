/**
 * 生成内嵌词典数据。
 *
 * 数据源：ECDICT（https://github.com/skywind3000/ecdict，MIT 许可）
 * 一套英汉双解词典数据库，含音标、中英释义、柯林斯星级、牛津 3000 标记、考试标签、词形变化。
 *
 * 原始 CSV 有 77 万词条（63MB），全量打包不现实，这里按学习价值筛选：
 *   1. 只收单词（去掉短语，孩子查词基本查单词）
 *   2. 必须有中文释义
 *   3. 有考试/级别标记（中考、高考、四六级、考研、托福雅思、柯林斯星级、牛津 3000）
 *      或当代语料库词频排名前 4 万
 * 结果约 3.8 万词条，gzip 后 3MB 出头，一次性下载后离线可用。
 *
 * 用法：
 *   npm run build:dict                     # 自动下载 CSV 到 .cache/ 再生成
 *   node scripts/build-dict.mjs --csv 路径  # 用本地已有的 CSV
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { gzipSync, constants as zlibConstants } from 'node:zlib'
import { basename } from 'node:path'

const CSV_URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
const CACHE = '.cache/ecdict.csv'
const OUT_DIR = 'public/dict'
const OUT_DATA = `${OUT_DIR}/dict-core.jsonl.gz`
const OUT_MANIFEST = `${OUT_DIR}/manifest.json`

/** 词频筛选阈值：当代语料库排名前 4 万 */
const MAX_FRQ = 40000
/** 中文释义最多保留几条（释义多的词取前面的常用义） */
const MAX_TRANS = 8
/** 英文释义最多保留几条 */
const MAX_DEF = 4

/** 词典数据版本：筛选规则或字段结构变了要 bump，客户端据此判断是否需要重新下载 */
const VERSION = '2026.09.06-1'

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv') out.csv = args[++i]
  }
  return out
}

async function download(url, dest) {
  mkdirSync(basename(dest) === dest ? '.' : dest.replace(/\/[^/]+$/, ''), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('content-length') || 0)
  let done = 0
  const tmp = `${dest}.part`
  const file = createWriteStream(tmp)
  const reader = res.body.getReader()
  for (;;) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    file.write(value)
    done += value.length
    if (total) process.stdout.write(`\r下载中 ${(done / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)}MB`)
  }
  await new Promise((r) => file.end(r))
  process.stdout.write('\n')
  const { renameSync } = await import('node:fs')
  renameSync(tmp, dest)
}

/**
 * 极简 CSV 解析：支持引号包裹、转义双引号、字段内换行。
 * ECDICT 的释义里含 \n 字面量与逗号，必须严格按 RFC 4180 解析。
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 释义字段里的换行是字面量 "\n"，转成真正的换行并截断到 n 条 */
function splitSenses(raw, max) {
  if (!raw) return []
  return raw
    .split(/\\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
}

/** 词形变化字段：d:abandoned/p:abandoned/i:abandoning/3:abandons */
function parseExchange(raw) {
  if (!raw) return []
  return raw
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf(':')
      return idx > 0 ? { type: p.slice(0, idx), form: p.slice(idx + 1) } : null
    })
    .filter(Boolean)
}

const EXAM_LABELS = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
}

async function main() {
  const args = parseArgs()
  let csvPath = args.csv || CACHE

  if (!existsSync(csvPath)) {
    console.log(`未找到本地 CSV，开始下载：${CSV_URL}`)
    await download(CSV_URL, csvPath)
  }
  console.log(`读取 ${csvPath} …`)
  const text = readFileSync(csvPath, 'utf-8')
  const rows = parseCsv(text)
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''))
  console.log(`解析到 ${rows.length - 1} 行，表头：${header.join(',')}`)

  const idx = (name) => header.indexOf(name)
  const col = {
    word: idx('word'),
    phonetic: idx('phonetic'),
    definition: idx('definition'),
    translation: idx('translation'),
    pos: idx('pos'),
    collins: idx('collins'),
    oxford: idx('oxford'),
    tag: idx('tag'),
    bnc: idx('bnc'),
    frq: idx('frq'),
    exchange: idx('exchange'),
  }
  for (const [k, v] of Object.entries(col)) {
    if (v < 0) throw new Error(`CSV 缺少字段 ${k}`)
  }

  const num = (s) => {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : 0
  }

  const entries = []
  /** 词形 -> 原形，查 "abandoned" 能落到 "abandon" */
  const forms = new Map()
  let skippedNoTrans = 0
  let skippedPhrase = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length < header.length) continue
    const word = row[col.word].trim()
    const translation = row[col.translation].trim()
    if (!word || !translation) {
      skippedNoTrans++
      continue
    }
    // 短语（含空格）不收：体积大头，且孩子查词以单词为主
    if (/\s/.test(word)) {
      skippedPhrase++
      continue
    }
    const collins = num(row[col.collins])
    const oxford = row[col.oxford].trim() === '1' ? 1 : 0
    const tag = row[col.tag].trim()
    const frq = num(row[col.frq])
    const tagged = collins > 0 || oxford === 1 || tag.length > 0
    if (!tagged && !(frq > 0 && frq <= MAX_FRQ)) continue

    const trans = splitSenses(translation, MAX_TRANS)
    if (trans.length === 0) continue
    const defs = splitSenses(row[col.definition], MAX_DEF)

    entries.push({
      w: word,
      p: row[col.phonetic].trim(),
      t: trans,
      d: defs,
      e: row[col.exchange].trim(),
      c: collins,
      o: oxford,
      g: tag,
      f: frq,
    })

    // 记录词形变化，供查词时还原到原形
    for (const { type, form } of parseExchange(row[col.exchange])) {
      const f = form.trim().toLowerCase()
      if (!f || f === word.toLowerCase()) continue
      if (type === '0') {
        // 0:lemma —— 当前词是变形，指向原形
        forms.set(word.toLowerCase(), f)
      } else if ('pdi3srtr'.includes(type)) {
        forms.set(f, word.toLowerCase())
      }
    }
  }

  // 按词频排序（无词频的排后面），保证搜索建议里常见词在前
  entries.sort((a, b) => {
    const fa = a.f > 0 ? a.f : Number.MAX_SAFE_INTEGER
    const fb = b.f > 0 ? b.f : Number.MAX_SAFE_INTEGER
    return fa - fb || a.w.localeCompare(b.w)
  })

  const lines = entries.map((e) => JSON.stringify(e))
  const raw = Buffer.from(lines.join('\n'), 'utf-8')
  const gz = gzipSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION })

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_DATA, gz)
  const manifest = {
    version: VERSION,
    source: 'ECDICT (MIT) https://github.com/skywind3000/ecdict',
    builtAt: new Date().toISOString(),
    count: entries.length,
    forms: forms.size,
    bytes: gz.length,
    rawBytes: raw.length,
    examLabels: EXAM_LABELS,
  }
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2))

  await rm(`${csvPath}.part`, { force: true })

  console.log('\n=== 生成完成 ===')
  console.log(`词条数     ${entries.length.toLocaleString()}`)
  console.log(`词形别名   ${forms.size.toLocaleString()}`)
  console.log(`有英释     ${entries.filter((e) => e.d.length > 0).length.toLocaleString()}`)
  console.log(`原始       ${(raw.length / 1e6).toFixed(1)}MB`)
  console.log(`gzip       ${(gz.length / 1e6).toFixed(2)}MB  → ${OUT_DATA}`)
  console.log(`清单       ${OUT_MANIFEST}`)
  console.log(`（跳过：无中文释义 ${skippedNoTrans}，短语 ${skippedPhrase.toLocaleString()}）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
