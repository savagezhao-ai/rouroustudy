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

/**
 * 在「用户点击手势内」同步调用一次以解锁 Safari/iOS 的语音合成。
 * Safari 在没有任何手势内的 speak() 时，后续的异步 speak() 会被静默忽略。
 * 传一个几乎无声的空文本即可完成解锁，不影响后续发音。
 */
export function primeSpeech() {
  if (!hasSynth()) return
  try {
    const u = new SpeechSynthesisUtterance('')
    u.volume = 0
    u.rate = 5
    window.speechSynthesis.speak(u)
    // 立即取消，避免空文本被真的朗读出来
    window.speechSynthesis.cancel()
  } catch {
    /* 忽略 */
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
 * 内部：同步朗读一段文本，返回在朗读结束（或超时兜底）后才 resolve 的 Promise。
 * 不修改 seqId，仅供自动连读序列使用。
 */
function speakNow(text: string, lang: SpeakLang = 'en'): Promise<void> {
  return new Promise((resolve) => {
    if (!hasSynth() || !text) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const s = cachedSpeech
    refreshVoices()
    const u = new SpeechSynthesisUtterance(text)
    const v = lang === 'zh' ? pickDefaultVoice('zh') : (findVoice(s.voiceURI) ?? pickDefaultVoice())
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
    u.onend = finish
    u.onerror = finish
    // Safari 上 onend 有时不触发，按文本长度估算一个兜底时长
    const est = Math.max(800, (text.length * 70) / (u.rate || 1) + 500)
    const to = setTimeout(finish, est + 2000)
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
    // 防止 timeout 泄漏：finish 后若 Promise 已 resolve，setTimeout 回调是空操作
    void to
  })
}

/** 手动朗读：取消任何正在进行的自动连读，立即朗读这段文本 */
export function speak(text: string, lang: SpeakLang = 'en') {
  if (!hasSynth() || !text) return
  // 手动点击 -> 打断自动连读
  seqId++
  const synth = window.speechSynthesis
  // 先取消再朗读
  try {
    synth.cancel()
  } catch {
    /* 忽略 */
  }
  void speakNow(text, lang)
}

/**
 * 自动连读序列：依次朗读 items，每项可重复 repeat 次、项间停顿 gapMs。
 * 任意时刻若发生手动朗读（seqId 变化），序列立即中止。
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
  for (const item of items) {
    if (myId !== seqId) return
    for (let r = 0; r < repeat; r++) {
      if (myId !== seqId) return
      await speakNow(item.text, item.lang)
      if (r < repeat - 1) await delay(gap)
    }
    await delay(gap)
  }
}

/**
 * 查词自动朗读：单词读三遍（每次间隔 1 秒），然后依次朗读中文释义、英文解释。
 * 用户若手动点击任意 🔊，会立即中断自动连读并改读所点击内容。
 */
export function autoReadEntry(entry: DictEntry) {
  if (!entry) return
  const items: { text: string; lang: SpeakLang }[] = []
  // 单词读三遍
  for (let i = 0; i < 3; i++) items.push({ text: entry.word, lang: 'en' })
  // 中文释义
  for (const t of entry.translation) {
    if (t) items.push({ text: t, lang: 'zh' })
  }
  // 英文解释
  for (const d of entry.definition) {
    if (d) items.push({ text: d, lang: 'en' })
  }
  void playSequence(items, { repeat: 1, gapMs: 1000 })
}
