// 发音模块：自动挑选高质量英语音色（Samantha/Daniel 等），设置里可手动换
import { getMeta } from './db'

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

function refreshVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  voices = window.speechSynthesis.getVoices()
  return voices
}

/** 应用启动时调用一次，持续追踪可用音色列表 */
export function loadVoices() {
  if (!('speechSynthesis' in window)) return
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
  if (!('speechSynthesis' in window)) return []
  if (voices.length === 0) refreshVoices()
  return voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
}

// 优先级：macOS/iOS 高质量增强音色在前
const PREFERRED = ['Samantha', 'Daniel', 'Karen', 'Ava', 'Aria', 'Jenny', 'Google US English', 'Moira', 'Tessa']
// 中文音色优先级：Tingting（大陆）在前，避免挑到粤语/台语音色
const PREFERRED_ZH = ['Tingting', 'Ting-Ting', 'Meijia', 'Sinji', 'Google 普通话', 'Yaoyao', 'Huihui']

export type SpeakLang = 'en' | 'zh'

function voicesOf(lang: SpeakLang): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
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

/** 朗读文本。lang='zh' 时用中文音色（词典里的中文释义），默认英文 */
export function speak(text: string, lang: SpeakLang = 'en') {
  if (!('speechSynthesis' in window) || !text) return
  const synth = window.speechSynthesis
  // 同步读取已缓存的设置；绝不在这里 await，否则 Safari 会因脱离手势而不发声
  const s = cachedSpeech
  // 每次发音前重新拉取音色列表，避免用陈旧/空列表导致回落到默认音色
  refreshVoices()
  const u = new SpeechSynthesisUtterance(text)
  // 英文沿用用户设置的音色；中文单独挑，避免拿英语音色念中文
  const v = lang === 'zh' ? pickDefaultVoice('zh') : (findVoice(s.voiceURI) ?? pickDefaultVoice())
  if (v) {
    u.voice = v
    u.lang = v.lang
  } else {
    u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
  }
  u.rate = s.rate > 0 ? s.rate : DEFAULT_SPEECH.rate
  // Safari/iOS：合成器常处于 paused 状态，先 resume 再 speak，否则静默失败
  try {
    synth.resume()
  } catch {
    /* 忽略 */
  }
  const go = () => {
    try {
      synth.speak(u)
    } catch {
      /* 忽略 */
    }
  }
  // 先 cancel 再立即 speak 在 Chrome 上会吞掉本次发音，稍微延迟
  if (synth.speaking || synth.pending) {
    synth.cancel()
    setTimeout(go, 80)
  } else {
    go()
  }
}
