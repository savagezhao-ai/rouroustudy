// 发音模块：自动挑选高质量英语音色（Samantha/Daniel 等），设置里可手动换
import { getMeta } from './db'
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
    if (!hasSynth() || !text) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const s = cachedSpeech
    refreshVoices()
    const v = lang === 'zh' ? pickDefaultVoice('zh') : (findVoice(s.voiceURI) ?? pickDefaultVoice())
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
    // 充裕估算：系数放大、基础时长加长，确保覆盖绝大多数长句，避免下一句提前叠加
    const est = Math.max(1200, (text.length * 110) / (u.rate || 1) + 1800)
    const minMs = est * 0.6
    const startedAt = Date.now()
    const to = setTimeout(finish, est)
    u.onend = () => {
      if (Date.now() - startedAt >= minMs) finish()
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
  items: { text: string; lang: SpeakLang }[],
  opts?: { repeat?: number; gapMs?: number },
) {
  if (!hasSynth()) return
  const repeat = opts?.repeat ?? 1
  const gap = opts?.gapMs ?? 1000
  const myId = ++seqId
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // 开头清一次：取消点击手势里 primeSpeech 可能还在念的单词，避免与序列第一句重叠。
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* 忽略 */
  }
  await delay(150)
  for (const item of items) {
    if (myId !== seqId) return
    for (let r = 0; r < repeat; r++) {
      if (myId !== seqId) return
      await speakOne(item.text, item.lang)
      if (r < repeat - 1) await delay(gap)
    }
    await delay(gap)
  }
}

/**
 * 把释义拆成「词性 + 正文」，与词典面板显示、手动 🔊 朗读保持一致。
 * 行为必须与 src/components/DictSheet.tsx 里的 splitPos 完全相同。
 */
function splitPos(line: string): { pos: string; text: string } {
  const m = /^([a-z]{1,5})\.\s*(.*)$/i.exec((line ?? '').trim())
  return m ? { pos: m[1], text: m[2] } : { pos: '', text: (line ?? '').trim() }
}

/** 词性 -> 中文朗读词（n 名词 / vt 及物动词 / vi 不及物动词 …） */
const POS_ZH: Record<string, string> = {
  n: '名词',
  v: '动词',
  vt: '及物动词',
  vi: '不及物动词',
  vn: '动名词',
  vlink: '系动词',
  link: '系动词',
  adj: '形容词',
  adv: '副词',
  prep: '介词',
  conj: '连词',
  pron: '代词',
  art: '冠词',
  num: '数词',
  int: '感叹词',
  excl: '感叹词',
  abbr: '缩写',
  aux: '助动词',
  det: '限定词',
  modal: '情态动词',
  inf: '不定式',
  ger: '动名词',
  phr: '短语',
  phrv: '短语动词',
  pl: '复数',
  sb: '某人',
  sth: '某物',
  c: '可数',
  u: '不可数',
  esp: '尤其',
  usu: '通常',
  ie: '也就是',
  eg: '例如',
  attr: '作定语',
  pred: '作表语',
}

/** 词性 -> 英文朗读词（noun / transitive verb / intransitive verb …） */
const POS_EN: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  vt: 'transitive verb',
  vi: 'intransitive verb',
  vn: 'verbal noun',
  vlink: 'linking verb',
  link: 'linking verb',
  adj: 'adjective',
  adv: 'adverb',
  prep: 'preposition',
  conj: 'conjunction',
  pron: 'pronoun',
  art: 'article',
  num: 'numeral',
  int: 'interjection',
  excl: 'exclamation',
  abbr: 'abbreviation',
  aux: 'auxiliary verb',
  det: 'determiner',
  modal: 'modal verb',
  inf: 'infinitive',
  ger: 'gerund',
  phr: 'phrase',
  phrv: 'phrasal verb',
  pl: 'plural',
  sb: 'somebody',
  sth: 'something',
  c: 'countable',
  u: 'uncountable',
  esp: 'especially',
  usu: 'usually',
  ie: 'that is',
  eg: 'for example',
  attr: 'attributive',
  pred: 'predicative',
}

/**
 * 查词自动朗读：单词读三遍（每次间隔 1 秒），然后逐「义项」朗读——每个义项先读中文（带词性），
 * 再读英文（带词性）。用户若手动点击任意 🔊，会立即中断自动连读。
 *
 * 关键一致性：朗读内容必须与词典面板【显示的内容完全一致】。面板 DictSheet 把中文 translation
 * 与英文 definition 按行「配对」成义项（长度取中文条数），因此这里也用完全相同的配对方式遍历，
 * 而不是独立遍历全部 definition——否则会读出面板上没有显示的英文释义（如 test 的第 4 条
 * "a hard outer covering…"），造成「听到了但看不到」的错位感。
 *
 * 词性按「连续相同则只念一次」朗读（名词：…；…；动词：…），避免 ECDICT 英文释义每条词性都标
 * "n." 导致反复念 "noun" 的单调杂音；念完词性停顿 1 秒（playSequence 的项间间隔）再念正文。
 *
 * 若打开/查询的手势里已经念过该词（primeSpeech 完成解锁的那一遍），这里只补足到三遍。
 */
export function autoReadEntry(entry: DictEntry) {
  if (!entry) return
  const matched = primedWord && primedWord === entry.word.toLowerCase()
  const wordRepeat = matched ? 2 : 3
  const items: { text: string; lang: SpeakLang }[] = []
  // 单词读三遍（已念过一遍则补足两遍）
  for (let i = 0; i < wordRepeat; i++) items.push({ text: entry.word, lang: 'en' })
  // 逐义项（与面板 DictSheet 的 senses 完全一致：translation[i] 配对 definition[i]）
  let lastZhPos = ''
  let lastEnPos = ''
  for (let i = 0; i < entry.translation.length; i++) {
    const t = splitPos(entry.translation[i])
    if (t.text) {
      if (t.pos && POS_ZH[t.pos] && t.pos !== lastZhPos) {
        items.push({ text: POS_ZH[t.pos], lang: 'zh' })
        lastZhPos = t.pos
      }
      items.push({ text: t.text, lang: 'zh' })
    }
    const defLine = entry.definition[i]
    if (defLine) {
      const d = splitPos(defLine)
      if (d.text) {
        if (d.pos && POS_EN[d.pos] && d.pos !== lastEnPos) {
          items.push({ text: POS_EN[d.pos], lang: 'en' })
          lastEnPos = d.pos
        }
        items.push({ text: d.text, lang: 'en' })
      }
    }
  }
  void playSequence(items, { repeat: 1, gapMs: 1000 })
}
