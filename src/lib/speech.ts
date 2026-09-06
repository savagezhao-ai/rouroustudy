// 发音模块：自动挑选高质量英语音色（Samantha/Daniel 等），设置里可手动换
import { getMeta, setMeta } from './db'
import type { DictEntry } from './dictionary'

export interface SpeechSettings {
  voiceURI: string
  rate: number
}

export const DEFAULT_SPEECH: SpeechSettings = { voiceURI: '', rate: 0.9 }

let voices: SpeechSynthesisVoice[] = []

// 发音设置只在启动时加载一次并缓存到内存。
// 关键：speak() 必须在用户点击手势「同步」调用 speechSynthesis.speak()，
// Safari 在手势外（比如 await 之后）调用会被静默忽略，导致点了没声音。
let cachedSpeech: SpeechSettings = DEFAULT_SPEECH

/** 应用启动时调用：把发音设置读进内存，供 speak() 同步使用 */
export function loadSpeechSettings() {
  if (!('speechSynthesis' in window)) return
  getMeta('speech', DEFAULT_SPEECH)
    .then((s) => {
      cachedSpeech = s
    })
    .catch(() => {})
}

/**
 * 用户在「发音设置」里改了语音/语速后立即调用：同步刷新内存里的 cachedSpeech，并落盘。
 * 这是设置改动的【唯一入口】，Manage 页面改设置只调它即可，不再单独写 storage，
 * 否则「改了设置但内存缓存没刷新 → 朗读还是旧值」的回归（之前就是这么坏的）。
 */
export async function setSpeechSettings(s: SpeechSettings) {
  cachedSpeech = s
  await setMeta('speech', s) // 落盘
}

function hasSynth(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function refreshVoices(): SpeechSynthesisVoice[] {
  if (!hasSynth()) return []
  voices = window.speechSynthesis.getVoices()
  return voices
}

/** 应用启动时调用一次，持续追踪可用音色列表 */
export function loadVoices() {
  if (!hasSynth()) return
  refreshVoices()
  window.speechSynthesis.onvoiceschanged = () => refreshVoices()
  // 部分浏览器 voiceschanged 不可靠，兜底轮询几秒
  let tries = 0
  const timer = setInterval(() => {
    const v = refreshVoices()
    if (++tries > 20 || v.length > 0) clearInterval(timer)
  }, 400)
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!hasSynth()) return []
  if (voices.length === 0) refreshVoices()
  return voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
}

// 优先级：macOS/iOS 高质量增强音色在前
const PREFERRED = ['Samantha', 'Daniel', 'Karen', 'Ava', 'Aria', 'Jenny', 'Google US English', 'Moira', 'Tessa']
// 中文音色优先级：Tingting（大陆）在前，避免挑到粤语/台语音色
const PREFERRED_ZH = ['Tingting', 'Ting-Ting', 'Meijia', 'Sinji', 'Google 普通话', 'Yaoyao', 'Huihui']

export type SpeakLang = 'en' | 'zh'

function voicesOf(lang: SpeakLang): SpeechSynthesisVoice[] {
  if (!hasSynth()) return []
  if (voices.length === 0) refreshVoices()
  const prefix = lang === 'zh' ? 'zh' : 'en'
  // 中文还要排除 yue（粤语）等方言
  return voices.filter((v) => {
    const l = v.lang.toLowerCase().replace('_', '-')
    return l.startsWith(prefix) && (lang === 'en' || l.startsWith('zh'))
  })
}

export function pickDefaultVoice(lang: SpeakLang = 'en'): SpeechSynthesisVoice | undefined {
  if (lang === 'zh') {
    const zh = voicesOf('zh')
    for (const name of PREFERRED_ZH) {
      const hit = zh.find((v) => v.name.includes(name))
      if (hit) return hit
    }
    return zh.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('zh-cn')) ?? zh[0]
  }
  const en = voicesOf('en')
  for (const name of PREFERRED) {
    const hit = en.find((v) => v.name.includes(name))
    if (hit) return hit
  }
  return en.find((v) => v.lang === 'en-US') ?? en[0]
}

/** 按用户设置查找音色：voiceURI 或 name 双重匹配（Safari 两者的稳定性不同） */
function findVoice(uri: string): SpeechSynthesisVoice | undefined {
  if (!uri) return undefined
  const list = voices.length > 0 ? voices : refreshVoices()
  return (
    list.find((v) => v.voiceURI === uri) ??
    list.find((v) => v.name === uri) ??
    undefined
  )
}

// 当前自动连读序列的令牌；手动朗读会使其自增，从而让正在进行的序列在下一句前中止
let seqId = 0

// 记录最近一次在手势内朗读过的单词，供 autoReadEntry 避免重复计数
let primedWord = ''

/**
 * 必须在「用户点击手势内」同步调用，用来解锁 Safari/iOS 的语音合成。
 * Safari 的硬规矩：页面里第一次 speechSynthesis.speak() 必须落在用户手势内，
 * 否则之后任何（包括异步查词后的）自动朗读都会被静默忽略。
 *
 * 最稳妥的解锁方式：直接在手势内把单词本身念出来——既是解锁，也等于先读了一遍。
 * 传入 word 时朗读该词；不传（如首页「查词典」空开）则念一个极短静音 token 仅做解锁，
 * 真正的单词解锁会在随后的查询点击里补上。
 */
export function primeSpeech(word?: string) {
  if (!hasSynth()) return
  const synth = window.speechSynthesis
  const w = (word ?? '').trim()
  try {
    synth.resume()
  } catch {
    /* 忽略 */
  }
  if (w) {
    // 朗读真实单词：完成解锁，并作为自动连读的第一遍
    const u = new SpeechSynthesisUtterance(w)
    u.lang = 'en-US'
    u.rate = cachedSpeech.rate > 0 ? cachedSpeech.rate : DEFAULT_SPEECH.rate
    primedWord = w.toLowerCase()
    try {
      synth.speak(u)
    } catch {
      /* 忽略 */
    }
  } else {
    // 无单词时仅做解锁：极短静音 token（volume 0 不发声但能解锁）
    primedWord = ''
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      u.rate = 10
      synth.speak(u)
      synth.cancel()
    } catch {
      /* 忽略 */
    }
  }
}

/** 取消当前正在朗读/自动连读的内容 */
export function cancelSpeech() {
  if (!hasSynth()) return
  seqId++
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* 忽略 */
  }
}

/**
 * 内部：朗读一段文本，返回在「朗读真正结束（或超时兜底）」后才 resolve 的 Promise。
 * 不修改 seqId，供自动连读序列与手动朗读共用。
 *
 * 时序设计（彻底消除「结尾乱读/前后句叠加」）：
 * - 不在每句之间调用 cancel()：cancel 会切碎上一句残留尾音、被下一句混进来造成杂音。
 * - 以「按文本长度充裕估算」的主计时器作为收尾基准；Web Speech 的 onend 在 Safari/WebKit
 *   上偶尔会【提前】触发（音频其实还没播完），若直接以 onend 收尾，下一句就会叠到尾音上
 *   （长英文句尤其明显，表现为「最后一句混乱」）。故：onend 若在最短时长前触发视为误报忽略，
 *   直到主计时器自然收尾，保证整句播完、下一句不提前叠加。
 */
function speakOne(text: string, lang: SpeakLang = 'en'): Promise<void> {
  return new Promise((resolve) => {
    text = expandAbbr(text, lang)
    if (!hasSynth() || !text) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const s = cachedSpeech
    refreshVoices()
    // 中英文都优先用用户选定的音色（之前中文被硬编码成默认音色，无视设置）
    const v = findVoice(s.voiceURI) ?? pickDefaultVoice(lang)
    const u = new SpeechSynthesisUtterance(text)
    if (v) {
      u.voice = v
      u.lang = v.lang
    } else {
      u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
    }
    u.rate = s.rate > 0 ? s.rate : DEFAULT_SPEECH.rate
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    // 收尾基准 = 实际音频结束（onend）。Web Speech 在 Safari/WebKit 上偶尔会【提前】触发 onend
    // （音频其实还没播完），若直接以 onend 收尾，下一句会叠到尾音上（长英文句尤其明显）。
    // 故：onend 若在【开始 250ms 内】触发视为误报忽略，直到自然收尾；est 仅作硬兜底超时。
    // est 紧贴真实语速估算（避免过长死等），让「项间停顿 gap/langGap」成为主导的、对称的停顿，
    // 否则英文段结束后会死等长 ms，造成「英→中」比「中→英」明显更久的错觉。
    const est = Math.max(700, (text.length * 80) / (u.rate || 1) + 500)
    const startedAt = Date.now()
    const to = setTimeout(finish, est)
    u.onend = () => {
      if (Date.now() - startedAt >= 250) finish()
    }
    u.onerror = finish
    try {
      synth.resume()
    } catch {
      /* 忽略 */
    }
    try {
      synth.speak(u)
    } catch {
      clearTimeout(to)
      finish()
    }
  })
}

/** 手动朗读：取消任何正在进行的自动连读，立即朗读这段文本 */
export function speak(text: string, lang: SpeakLang = 'en') {
  if (!hasSynth() || !text) return
  // 手动点击 -> 打断自动连读
  seqId++
  const synth = window.speechSynthesis
  // 手动打断：cancel 一次清掉正在朗读的句子
  try {
    synth.cancel()
  } catch {
    /* 忽略 */
  }
  // 等一小段让 cancel 生效、清掉残留音频，避免与所点内容重叠成杂音
  setTimeout(() => void speakOne(text, lang), 80)
}

/**
 * 自动连读序列：依次朗读 items，项间停顿 gapMs。
 * 任意时刻若发生手动朗读（seqId 变化），序列立即中止。
 *
 * 序列内部【不】逐句 cancel：依赖 Web Speech 的自然队列（上一句结束后再 speak 下一句），
 * 避免 cancel 切断尾音造成「胡言乱语」杂音。仅在开头 cancel 一次（清掉点击手势里
 * primeSpeech 可能还在念的单词），并等待足够时长让其尾音落下，防止与序列首句重叠。
 */
export async function playSequence(
  items: SeqItem[],
  opts?: { repeat?: number; gapMs?: number; langGapMs?: number },
) {
  if (!hasSynth()) return
  const repeat = opts?.repeat ?? 1
  const gap = opts?.gapMs ?? 1000
  const langGap = opts?.langGapMs
  const myId = ++seqId
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // 开头清一次：取消点击手势里 primeSpeech 可能还在念的单词，避免与序列第一句重叠。
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* 忽略 */
  }
  await delay(150)
  let prevLang: SpeakLang | null = null
  for (const item of items) {
    if (myId !== seqId) return
    if ('pause' in item) {
      await delay(item.pause)
      continue
    }
    // 中↔英切换：在下一项（文本）朗读之前插入对称停顿，两侧一致
    if (prevLang !== null && langGap != null && item.lang !== prevLang) {
      await delay(langGap)
    }
    for (let r = 0; r < repeat; r++) {
      if (myId !== seqId) return
      await speakOne(item.text, item.lang)
      if (r < repeat - 1) await delay(gap)
    }
    prevLang = item.lang
  }
}

/**
 * 把词典原文按「字符脚本」切分成「同语言连续段」。
 * 每段用对应语言朗读；两段语言不同时，playSequence 会插入较长停顿（中英文切换停顿）。
 *
 * 切分策略（解决「中英混合朗读」的核心）：
 * - 逐字符分类：CJK 汉字 / 全角标点 → zh；ASCII 字母 / 数字 → en；
 *   空格与半角标点 → 归属到【相邻段】（不单独成段）。
 *   这样「English (中文) English.」会变成 en｜zh｜en 三段，读起来自然，
 *   也不会因为一个逗号在中文里误触发英文嗓音。
 * - 朗读前展开缩写（sb→somebody 等，见 expandAbbr），其余交叉引用 `=`/`Cf` 已在
 *   数据清洗阶段转成「参见」，无需在此处理。
 */
function langOf(ch: string): 'zh' | 'en' | 'neutral' {
  const c = ch.codePointAt(0) ?? 0
  if (c >= 0x4e00 && c <= 0x9fff) return 'zh' // CJK 汉字
  if (c >= 0x3000 && c <= 0x303f) return 'zh' // CJK 符号
  if ((c >= 0xff00 && c <= 0xffef) || c === 0x2026) return 'zh' // 全角标点 / 省略号
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return 'en'
  return 'neutral'
}

/** 逐字符切分原文为「同语言连续段」+「中文括号停顿项」 */
export function segmentByLang(raw: string): SeqItem[] {
  const out: SeqItem[] = []
  let cur = ''
  let curLang: SpeakLang = 'en'
  const flush = () => {
    if (cur.trim()) out.push({ text: cur.trim(), lang: curLang })
    cur = ''
  }
  for (const ch of raw) {
    // 中文全角括号：收尾当前段，并插入一个停顿项（用户要的「适当停顿」）
    if (ch === '（' || ch === '）') {
      flush()
      out.push({ pause: PAUSE_MS })
      continue
    }
    const k = langOf(ch)
    const cls: SpeakLang = k === 'neutral' ? curLang : k
    if (cur && cls !== curLang) flush() // 语言切换：先收尾当前段
    cur += ch
    curLang = cls
  }
  flush()
  return out
}

/**
 * 朗读前清理：去掉半角/方括号等无需朗读的括号，并把空白压成单空格。
 * 注意：【中文全角括号 （） 故意保留】，由 segmentByLang 在遍历时识别为「0.5s 停顿项」，
 * 这样中文标点既不会被念成「括号/逗号」，又能按用户要求留出适当停顿。
 * 展示文本（entry.raw）保留全部括号与换行，只有「朗读」走这层清理。
 */
function cleanForRead(raw: string): string {
  return raw.replace(/[()【】\[\]]/g, '').replace(/\s+/g, ' ').trim()
}

/** 朗读序列元素：要么是「一段同语言文本」，要么是「插入一段停顿」 */
export type SeqItem = { text: string; lang: SpeakLang } | { pause: number }

/** 中文括号停顿时长（毫秒） */
export const PAUSE_MS = 500

/** 合并相邻同语言文本段，避免标点残留造成的碎片段与无谓停顿（停顿项保持独立） */
function mergeSameLang(segs: SeqItem[]): SeqItem[] {
  const out: SeqItem[] = []
  for (const s of segs) {
    if ('pause' in s) {
      out.push(s)
      continue
    }
    const last = out[out.length - 1]
    if (last && !('pause' in last) && last.lang === s.lang) {
      last.text = (last.text + ' ' + s.text).replace(/\s+/g, ' ').trim()
    } else {
      out.push({ text: s.text, lang: s.lang })
    }
  }
  return out
}

/**
 * 查词自动朗读：单词读三遍（每次间隔 1 秒；若查询手势里已念过一遍则补足两遍），
 * 然后从上往下朗读整条原文（保留全部释义与例句），中英文切换处自动停顿。
 * 用户手动点击任意 🔊 会立即中断。
 */
export function readEntry(entry: DictEntry) {
  if (!entry) return
  const matched = primedWord && primedWord === entry.word.toLowerCase()
  const wordRepeat = matched ? 2 : 3
  const items: SeqItem[] = []
  for (let i = 0; i < wordRepeat; i++) items.push({ text: entry.word, lang: 'en' })
  items.push(...mergeSameLang(segmentByLang(cleanForRead(entry.raw))))
  // gapMs：同语言相邻段的短停顿；langGapMs：中↔英切换时的停顿（两侧对称、清晰可辨）
  void playSequence(items, { repeat: 1, gapMs: 300, langGapMs: 700 })
}

/**
 * 缩写展开：词典原文里大量使用 sb/sth/esp/usu/eg/ie 等缩写，英文 TTS 会逐个字母念
 * （"sb"→S-B），听感很怪。这里在朗读前把它们展开成完整词。
 *
 * 安全铁律（用户明确要求「别和正常单词混淆」）：
 * 1. 只用 \b 词边界匹配「独立缩写 token」，绝不按子串替换——
 *    因此 eg 不会动到 egg、usu 不会动到 usual、ie 不会动到 friend/piece。
 * 2. 映射表只收录「确认是缩写」的 token，已主动剔除会撞正常单词的：
 *    sing(唱歌)/ant(蚂蚁)/fig(无花果)/lit(light过去式) 等一律不在表内。
 * 3. 中文 t[] 与英文 d[] 用各自的映射：中文语境展开成中文（某人/某物/尤其），
 *    由中文语音念出来自然；英文语境展开成英文（somebody/something/especially）。
 * 注：词性前缀（n./vt. 等）由 POS_ZH/POS_EN 单独朗读，不经此函数，互不干扰。
 */
const ABBR_EN: Record<string, string> = {
  sb: 'somebody',
  sth: 'something',
  esp: 'especially',
  usu: 'usually',
  eg: 'for example',
  ie: 'that is',
  abbr: 'abbreviation',
  infml: 'informal',
  fml: 'formal',
  pl: 'plural',
  opp: 'opposite',
  syn: 'synonym',
  approx: 'approximately',
  BrE: 'British English',
  AmE: 'American English',
  idm: 'idiom',
  attr: 'attributive',
  pred: 'predicative',
  c: 'countable',
  u: 'uncountable',
}
const ABBR_ZH: Record<string, string> = {
  sb: '某人',
  sth: '某物',
  esp: '尤其',
  usu: '通常',
  eg: '例如',
  ie: '也就是',
  abbr: '缩写',
  infml: '非正式',
  fml: '正式',
  pl: '复数',
  opp: '反义',
  syn: '同义',
  approx: '大约',
  BrE: '英式英语',
  AmE: '美式英语',
  idm: '习语',
  attr: '作定语',
  pred: '作表语',
  c: '可数',
  u: '不可数',
}
// 所有 key 一致（值不同），按长度降序拼接，避免前缀误匹配
const ABBR_KEYS = Object.keys(ABBR_EN).sort((a, b) => b.length - a.length)
const ABBR_RE = new RegExp(
  '\\b(' + ABBR_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'g',
)

/** 朗读前展开缩写；lang 决定用中文还是英文展开词。 */
export function expandAbbr(text: string, lang: SpeakLang = 'en'): string {
  if (!text) return text
  const map = lang === 'zh' ? ABBR_ZH : ABBR_EN
  return text.replace(ABBR_RE, (m) => (m in map ? map[m] : m))
}
