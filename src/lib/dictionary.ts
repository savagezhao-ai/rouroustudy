// 内嵌词典：数据源 ECDICT（MIT），首次使用时下载压缩包并写入 IndexedDB，之后完全离线查询。
// 数据由 .dict-build/build_oxford.py 从牛津英汉双解（stardict-oxford-gb）生成到
// public/dict/，约 2 万词条、2MB。
//
// 与业务数据库分开存放：词典是只读的共享资源，不随用户切换而变，
// 所以单独一个数据库，避免每个用户各存一份。
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { gunzipSync } from 'fflate'

// Vite 注入的部署基础路径（GitHub Pages 上是 /rouroustudy/）
const BASE = import.meta.env.BASE_URL

/** 单条词形变化，如 { type: 'p', form: 'abandoned' } */
export interface WordForm {
  type: string
  form: string
}

export interface DictEntry {
  word: string
  phonetic: string
  /** 中文释义，逐条（“一句一句往下”） */
  translation: string[]
  /** 英文释义，逐条 */
  definition: string[]
  /** 词形变化（过去式、复数等） */
  forms: WordForm[]
  collins: number // 柯林斯星级 0-5
  oxford: number // 是否牛津 3000 核心词
  tags: string[] // 中考/高考/四级/考研…
  frq: number // 当代语料库词频排名，0 表示无数据
}

/** 查词结果：matched 是实际命中的词条，via 说明怎么命中的 */
export interface DictHit {
  entry: DictEntry
  matched: string
  via: 'exact' | 'form' | 'stem'
}

export interface DictStatus {
  ready: boolean
  count: number
  version: string
  /** 数据包清单里的版本，与本地不一致时需要重新下载 */
  availableVersion: string
  bytes: number
  builtAt: string
}

interface DictDB extends DBSchema {
  entries: { key: string; value: DictEntry }
  forms: { key: string; value: string }
  meta: { key: string; value: unknown }
}

const DB_NAME = 'rouroustudy_dict'
const MANIFEST_URL = `${BASE}dict/manifest.json`
const DATA_URL = `${BASE}dict/dict-core.jsonl.gz`

let conn: Promise<IDBPDatabase<DictDB>> | null = null

function dictDb() {
  if (!conn) {
    conn = openDB<DictDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('entries')
        d.createObjectStore('forms')
        d.createObjectStore('meta')
      },
    })
  }
  return conn
}

/** 测试用：丢弃连接缓存，下次访问会重新开库 */
export function resetDictDb() {
  conn = null
}

/* ---------------- 解析（纯函数，便于测试） ---------------- */

/** 数据文件里的一行原始记录 */
interface RawEntry {
  w: string
  p: string
  t: string[]
  d: string[]
  e: string
  c: number
  o: number
  g: string
  f: number
}

/** 词形变化字段：d:abandoned/p:abandoned/i:abandoning/3:abandons */
export function parseExchange(raw: string): WordForm[] {
  if (!raw) return []
  return raw
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(':')
      return i > 0 ? { type: part.slice(0, i), form: part.slice(i + 1) } : null
    })
    .filter((x): x is WordForm => x !== null)
}

function toEntry(r: RawEntry): DictEntry {
  return {
    word: r.w,
    phonetic: r.p,
    translation: r.t ?? [],
    definition: r.d ?? [],
    forms: parseExchange(r.e),
    collins: r.c ?? 0,
    oxford: r.o ?? 0,
    tags: (r.g ?? '').split(/\s+/).filter(Boolean),
    frq: r.f ?? 0,
  }
}

/**
 * 解析解压后的数据包文本（每行一条 JSON）。
 * 同时产出「词形 -> 原形」映射，让 abandoned 能查到 abandon。
 */
export function parsePack(text: string): { entries: DictEntry[]; forms: Map<string, string> } {
  const entries: DictEntry[] = []
  const forms = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const raw = JSON.parse(line) as RawEntry
    const entry = toEntry(raw)
    entries.push(entry)
    const base = entry.word.toLowerCase()
    for (const { type, form } of entry.forms) {
      const f = form.trim().toLowerCase()
      if (!f || f === base) continue
      if (type === '0') {
        // 0:lemma —— 当前词本身是变形，指向原形
        forms.set(base, f)
      } else if ('pdi3srt'.includes(type)) {
        forms.set(f, base)
      }
    }
  }
  return { entries, forms }
}

/* ---------------- 状态与装载 ---------------- */

export async function dictStatus(): Promise<DictStatus> {
  const d = await dictDb()
  let manifest: { version?: string; count?: number; bytes?: number; builtAt?: string } = {}
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (res.ok) manifest = await res.json()
  } catch {
    // 离线时拿不到清单，退化为只看本地是否有数据
  }
  const [version, count] = await Promise.all([
    d.get('meta', 'version') as Promise<string | undefined>,
    d.get('meta', 'count') as Promise<number | undefined>,
  ])
  return {
    ready: (count ?? 0) > 0,
    count: count ?? 0,
    version: version ?? '',
    availableVersion: manifest.version ?? '',
    bytes: manifest.bytes ?? 0,
    builtAt: manifest.builtAt ?? '',
  }
}

export interface LoadProgress {
  phase: 'download' | 'parse' | 'store'
  /** 0-1，store 阶段按词条写入进度 */
  ratio: number
}

/**
 * 下载并装载词典。已装载且版本一致时直接返回。
 * onProgress 用于界面显示进度条（3MB 下载在手机上需要几秒）。
 */
export async function loadDict(onProgress?: (p: LoadProgress) => void): Promise<void> {
  const status = await dictStatus()
  if (status.ready && status.version && status.version === status.availableVersion) return

  const res = await fetch(DATA_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`词典数据下载失败（${res.status}）`)
  const total = Number(res.headers.get('content-length') || 0)
  const gz = await readBody(res, total, onProgress)

  onProgress?.({ phase: 'parse', ratio: 0 })
  const text = new TextDecoder().decode(gunzipSync(gz))
  await importPack(text, status.availableVersion || 'unknown', onProgress)
}

/**
 * 把解压后的数据包写入本地库。与下载解耦，方便测试直接喂数据。
 * 重复调用是幂等的（同样的 key 覆盖写），版本号用于判断是否需要重下。
 */
export async function importPack(
  text: string,
  version = 'test',
  onProgress?: (p: LoadProgress) => void,
): Promise<number> {
  const d = await dictDb()
  const { entries, forms } = parsePack(text)

  onProgress?.({ phase: 'store', ratio: 0 })
  const CHUNK = 2000
  const formList = [...forms.entries()]
  const totalOps = entries.length + formList.length
  let written = 0
  for (let i = 0; i < entries.length; i += CHUNK) {
    const tx = d.transaction('entries', 'readwrite')
    const slice = entries.slice(i, i + CHUNK)
    await Promise.all(slice.map((e) => tx.store.put(e, e.word.toLowerCase())))
    await tx.done
    written += slice.length
    onProgress?.({ phase: 'store', ratio: written / totalOps })
  }
  for (let i = 0; i < formList.length; i += CHUNK) {
    const tx = d.transaction('forms', 'readwrite')
    const slice = formList.slice(i, i + CHUNK)
    await Promise.all(slice.map(([k, v]) => tx.store.put(v, k)))
    await tx.done
    written += slice.length
    onProgress?.({ phase: 'store', ratio: Math.min(1, written / totalOps) })
  }

  const tx3 = d.transaction('meta', 'readwrite')
  await Promise.all([
    tx3.store.put(version, 'version'),
    tx3.store.put(entries.length, 'count'),
  ])
  await tx3.done
  rankCache = null
  return entries.length
}

async function readBody(
  res: Response,
  total: number,
  onProgress?: (p: LoadProgress) => void,
): Promise<Uint8Array> {
  if (!res.body || !total) {
    return new Uint8Array(await res.arrayBuffer())
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let done = 0
  for (;;) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    chunks.push(value)
    done += value.length
    onProgress?.({ phase: 'download', ratio: total ? done / total : 0 })
  }
  const out = new Uint8Array(done)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/* ---------------- 查询 ---------------- */

function normalize(word: string): string {
  return word.trim().toLowerCase()
}

/**
 * 词形还原候选：查不到原形时，把可能的变形逐个试一遍。
 * 覆盖 -s/-es/-ies、-ed/-ied（含双写末辅音）、-ing（含去 e、双写）等常见情况。
 */
export function stemCandidates(word: string): string[] {
  const out: string[] = []
  const push = (s: string) => {
    if (s.length >= 2 && s !== word && !out.includes(s)) out.push(s)
  }
  if (word.endsWith('ies')) push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ves')) {
    push(`${word.slice(0, -3)}f`)
    push(`${word.slice(0, -3)}fe`)
  }
  if (word.endsWith('es')) {
    push(word.slice(0, -2))
    push(word.slice(0, -1))
  }
  if (word.endsWith('s') && !word.endsWith('ss')) push(word.slice(0, -1))
  if (word.endsWith('ied')) push(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed')) {
    push(word.slice(0, -2))
    push(word.slice(0, -1))
    // 双写末辅音：stopped -> stop
    const stem = word.slice(0, -2)
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1))
  }
  if (word.endsWith('ing')) {
    push(word.slice(0, -3))
    push(`${word.slice(0, -3)}e`)
    const stem = word.slice(0, -3)
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) push(stem.slice(0, -1))
  }
  return out
}

export async function lookupDict(word: string): Promise<DictHit | null> {
  const q = normalize(word)
  if (!q) return null
  const d = await dictDb()

  const exact = await d.get('entries', q)
  if (exact) return { entry: exact, matched: exact.word, via: 'exact' }

  const lemma = await d.get('forms', q)
  if (lemma) {
    const hit = await d.get('entries', lemma)
    if (hit) return { entry: hit, matched: hit.word, via: 'form' }
  }

  for (const c of stemCandidates(q)) {
    const direct = await d.get('entries', c)
    if (direct) return { entry: direct, matched: direct.word, via: 'stem' }
    const viaForm = await d.get('forms', c)
    if (viaForm) {
      const hit = await d.get('entries', viaForm)
      if (hit) return { entry: hit, matched: hit.word, via: 'stem' }
    }
  }
  return null
}

// 词频排序的词表缓存：搜索建议要按常见程度排序，全表扫一次缓存在内存
let rankCache: string[] | null = null

async function rankedWords(): Promise<string[]> {
  if (rankCache) return rankCache
  const d = await dictDb()
  const keys = (await d.getAllKeys('entries')) as string[]
  rankCache = keys
  return keys
}

/** 搜索建议：以 prefix 开头的词，按常见程度取前 limit 个 */
export async function suggestDict(prefix: string, limit = 12): Promise<string[]> {
  const p = normalize(prefix)
  if (!p) return []
  const keys = await rankedWords()
  const hits: string[] = []
  for (const k of keys) {
    if (k.startsWith(p)) {
      hits.push(k)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/** 随机取若干单词，用于首页「每日一词」之类的小功能（目前仅测试与调试用） */
export async function dictSize(): Promise<number> {
  const d = await dictDb()
  return d.count('entries')
}
