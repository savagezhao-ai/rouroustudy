// 用真实文件完整模拟前端 importApkg 的解析逻辑，验证输出质量
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'

const wasmBinary = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')
const SQL = await initSqlJs({ wasmBinary })

// ---- 与 src/lib/apkg.ts 保持一致的逻辑 ----
function clean(s) {
  return s
    .replace(/\[sound:[^\]]*\]/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\[\/?[a-zA-Z0-9_]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function guessFieldIndexes(names) {
  const word = names.findIndex((n) => /^(front|正面|word|单词|英语|vocab)$/i.test(n.trim()))
  const phonetic = names.findIndex((n) => /(音标|phonetic|ipa|pronunciation)/i.test(n) && !/发音$/.test(n))
  const translationExact = names.findIndex((n) => /^(back|背面|释义|中文|意思|翻译|definition|meaning|简明)$/i.test(n.trim()))
  let translation = translationExact
  if (translation < 0) {
    for (let i = 0; i < names.length; i++) {
      if (i === word || i === phonetic) continue
      if (/(比例|频率|freq|flags|图片|Lesson)/i.test(names[i])) continue
      translation = i
      break
    }
  }
  return { word: word >= 0 ? word : 0, phonetic, translation: translation >= 0 ? translation : 1 }
}

function normalizePhonetic(p) {
  if (!p) return ''
  const kk = p.match(/KK:\s*\[([^\]]+)\]/)
  if (kk) return `/${kk[1].trim()}/`
  const dj = p.match(/DJ:\s*\[([^\]]+)\]/)
  if (dj) return `/${dj[1].trim()}/`
  if (/^\/.+\//.test(p)) return p
  return p
}

// ---- 执行 ----
const buf = readFileSync('primary-school.apkg')
const zip = unzipSync(buf)
const dbFile = zip['collection.anki21'] ?? zip['collection.anki2']
const db = new SQL.Database(dbFile)

const colRes = db.exec('SELECT models FROM col LIMIT 1')
const models = JSON.parse(String(colRes[0].values[0][0]))
const notesRes = db.exec('SELECT mid, flds FROM notes')

const idxCache = new Map()
const seen = new Set()
const out = []
for (const row of notesRes[0].values) {
  const mid = String(row[0])
  const fields = String(row[1]).split('\x1f')
  if (!idxCache.has(mid)) {
    const names = models[mid]?.flds?.map((f) => f.name) ?? []
    idxCache.set(mid, guessFieldIndexes(names))
  }
  const { word: wi, phonetic: pi, translation: ti } = idxCache.get(mid)
  const word = clean(fields[wi] ?? '')
  if (!word) continue
  let phonetic = pi >= 0 ? normalizePhonetic(clean(fields[pi] ?? '')) : ''
  if (phonetic && !/^[/\[ˈˌ:.]/.test(phonetic)) phonetic = ''
  let translation = ti >= 0 ? clean(fields[ti] ?? '') : ''
  if (!translation && fields.length > 2) {
    const second = clean(fields[1] ?? '')
    if (/^\/.+\//.test(second)) {
      phonetic = second
      translation = clean(fields[2] ?? '')
    }
  }
  if (!translation) translation = clean(fields[1] ?? '')
  if (!translation) continue
  const key = word.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  out.push({ word, phonetic, translation })
}

console.log(`解析出 ${out.length} 个单词`)
console.log('\n=== 前 8 个 ===')
for (const w of out.slice(0, 8)) {
  console.log(`${w.word} | ${w.phonetic} | ${w.translation.slice(0, 80)}`)
}
console.log('\n=== 释义长度分布 ===')
const lens = out.map((w) => w.translation.length)
console.log('最长:', Math.max(...lens), '平均:', Math.round(lens.reduce((a, b) => a + b, 0) / lens.length))
const longOnes = out.filter((w) => w.translation.length > 200).length
console.log('释义超 200 字符的:', longOnes)
const noPhonetic = out.filter((w) => !w.phonetic).length
console.log('无音标的:', noPhonetic)
db.close()
