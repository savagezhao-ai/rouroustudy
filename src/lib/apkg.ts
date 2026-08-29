// Anki .apkg 导入：解压 zip → 读取 SQLite → 解析笔记为单词
// .apkg 是 zip 包，内含 collection.anki2（SQLite：notes 表存字段，col 表存模板定义）
import { unzipSync } from 'fflate'
import initSqlJs from 'sql.js'

/** Anki 卡片的完整字段（翻面分区显示用） */
export interface ApkgField {
  name: string
  value: string
}

export interface ApkgWord {
  word: string
  phonetic: string
  translation: string
  fields: ApkgField[] // 模板的全部字段（含单词/音标/释义之外的：牛津双解、简明、词根等）
}

export interface ApkgResult {
  deckName: string
  words: ApkgWord[]
}

let sqlPromise: Promise<any> | null = null

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      // 按实际请求的文件名拼接（浏览器构建会请求 sql-wasm-browser.wasm）
      locateFile: (file: string) => `${import.meta.env.BASE_URL}${file}`,
    })
  }
  return sqlPromise
}

/** 清理 Anki 字段里的 HTML/标记，得到纯文本（保留换行便于分区阅读） */
function clean(s: string): string {
  return (
    s
      .replace(/\[sound:[^\]]*\]/g, ' ') // [sound:xxx.mp3]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ') // HTML 标签
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\[\/?[a-zA-Z0-9_]+\]/g, '') // Anki 富文本标记 [b]...[/b]
      // 压缩空白但保留换行
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

interface NoteModel {
  name: string
  flds: { name: string }[]
}

/** 根据模板字段名猜测各内容的位置（字段名→索引） */
function guessFieldIndexes(names: string[]): { word: number; phonetic: number; translation: number } {
  // 释义候选：精确名优先（单词/释义/简明），排除"释义比例"这类统计字段
  const word = names.findIndex((n) => /^(front|正面|word|单词|英语|vocab)$/i.test(n.trim()))
  const phonetic = names.findIndex((n) => /(音标|phonetic|ipa|pronunciation)/i.test(n) && !/发音$/.test(n))
  const translationExact = names.findIndex((n) => /^(back|背面|释义|中文|意思|翻译|definition|meaning|简明)$/i.test(n.trim()))
  // 兜底：word 之后的第一个非音标、非统计字段
  let translation = translationExact
  if (translation < 0) {
    for (let i = 0; i < names.length; i++) {
      if (i === word || i === phonetic) continue
      if (/(比例|频率|freq|flags|图片|Lesson)/i.test(names[i])) continue
      translation = i
      break
    }
  }
  return {
    word: word >= 0 ? word : 0,
    phonetic,
    translation: translation >= 0 ? translation : 1,
  }
}

/** 规整音标：清理 KK:[xxx] DJ:[xxx] 双格式，取第一个 */
function normalizePhonetic(p: string): string {
  if (!p) return ''
  // KK:[ǝˈbaʊt]  DJ:[ǝˈbaut] → /ǝˈbaʊt/
  const kk = p.match(/KK:\s*\[([^\]]+)\]/)
  if (kk) return `/${kk[1].trim()}/`
  const dj = p.match(/DJ:\s*\[([^\]]+)\]/)
  if (dj) return `/${dj[1].trim()}/`
  // 已是 /xxx/ 形式
  if (/^\/.+\//.test(p)) return p
  return p
}

export async function importApkg(file: File): Promise<ApkgResult> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const zip = unzipSync(buf)
  // 新版 Anki 导出的包同时含 anki2（旧格式占位）和 anki21（schema 18 真实数据），必须优先 anki21
  const dbFile = zip['collection.anki21'] ?? zip['collection.anki2']
  if (!dbFile) {
    throw new Error('不是有效的 Anki .apkg 文件（缺少 collection.anki2）')
  }

  const SQL = await getSql()
  const database = new SQL.Database(dbFile)
  try {
    // 模板定义：字段名 → 位置映射
    const models: Record<string, NoteModel> = {}
    try {
      const colRes = database.exec('SELECT models FROM col LIMIT 1')
      if (colRes.length > 0) {
        Object.assign(models, JSON.parse(String(colRes[0].values[0][0])))
      }
    } catch {
      /* 老格式可能没有，走默认 */
    }

    const notesRes = database.exec('SELECT mid, flds FROM notes')
    if (notesRes.length === 0) {
      throw new Error('这个卡组里没有任何笔记')
    }

    // 每种模板分别猜字段位置；取笔记最多的模板名作为词库名
    const idxCache = new Map<string, ReturnType<typeof guessFieldIndexes>>()
    const namesCache = new Map<string, string[]>() // 模板 → 字段名列表
    const modelCount = new Map<string, number>()
    const words: ApkgWord[] = []
    const seen = new Set<string>()

    for (const row of notesRes[0].values) {
      const mid = String(row[0])
      const fields = String(row[1]).split('\x1f')
      if (!idxCache.has(mid)) {
        const names = models[mid]?.flds?.map((f) => f.name) ?? []
        namesCache.set(mid, names)
        idxCache.set(mid, guessFieldIndexes(names))
      }
      modelCount.set(mid, (modelCount.get(mid) ?? 0) + 1)
      const { word: wi, phonetic: pi, translation: ti } = idxCache.get(mid)!

      const word = clean(fields[wi] ?? '')
      if (!word) continue
      let phonetic = pi >= 0 ? normalizePhonetic(clean(fields[pi] ?? '').replace(/\n/g, ' ')) : ''
      // 音标一般是 /xxx/ 形式，做一层校正
      if (phonetic && !/^[/\[ˈˌ:.]/.test(phonetic)) phonetic = ''
      let translation = ti >= 0 ? clean(fields[ti] ?? '').replace(/\n/g, ' ') : ''
      // 启发式：第二字段长得像音标且还有第三字段，则第三字段才是释义
      if (!translation && fields.length > 2) {
        const second = clean(fields[1] ?? '').replace(/\n/g, ' ')
        if (/^\/.+\//.test(second)) {
          phonetic = second
          translation = clean(fields[2] ?? '').replace(/\n/g, ' ')
        }
      }
      if (!translation) translation = clean(fields[1] ?? '').replace(/\n/g, ' ')
      if (!translation) continue

      // 保留模板的全部字段（翻面分区显示）
      const names = namesCache.get(mid) ?? []
      const allFields: ApkgField[] = []
      for (let i = 0; i < fields.length; i++) {
        const value = clean(fields[i] ?? '')
        if (!value) continue
        allFields.push({ name: names[i] ?? `字段${i + 1}`, value })
      }

      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      words.push({ word, phonetic, translation, fields: allFields })
    }

    // 词库名优先级：卡组名（col.decks JSON）> 模板名 > 文件名
    let deckName = file.name.replace(/\.apkg$/i, '')
    try {
      const colRes2 = database.exec('SELECT decks FROM col LIMIT 1')
      if (colRes2.length > 0) {
        const decks = JSON.parse(String(colRes2[0].values[0][0])) as Record<
          string,
          { name?: string }
        >
        const names = Object.values(decks)
          .map((x) => x.name ?? '')
          .filter((n) => n && !/^(Default|系统默认)$/.test(n))
        if (names.length > 0) deckName = names[0]
      }
    } catch {
      /* 读取失败则走模板名 */
    }
    let best = 0
    for (const [mid, n] of modelCount) {
      if (n > best && models[mid]?.name && deckName === file.name.replace(/\.apkg$/i, '')) {
        best = n
        deckName = models[mid].name
      }
    }

    return { deckName: deckName.slice(0, 40), words }
  } finally {
    database.close()
  }
}
