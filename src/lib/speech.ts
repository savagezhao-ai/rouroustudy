// 发音模块：自动挑选高质量英语音色（Samantha/Daniel 等），设置里可手动换
import { getMeta } from './db'

export interface SpeechSettings {
  voiceURI: string
  rate: number
}

export const DEFAULT_SPEECH: SpeechSettings = { voiceURI: '', rate: 0.9 }

let voices: SpeechSynthesisVoice[] = []

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

export function pickDefaultVoice(): SpeechSynthesisVoice | undefined {
  const en = englishVoices()
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

export async function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const s = await getMeta<SpeechSettings>('speech', DEFAULT_SPEECH)
  const synth = window.speechSynthesis
  // 每次发音前重新拉取音色列表，避免用陈旧/空列表导致回落到默认音色
  refreshVoices()
  const u = new SpeechSynthesisUtterance(text)
  const v = findVoice(s.voiceURI) ?? pickDefaultVoice()
  if (v) {
    u.voice = v
    u.lang = v.lang
  } else {
    u.lang = 'en-US'
  }
  u.rate = s.rate > 0 ? s.rate : DEFAULT_SPEECH.rate
  const go = () => synth.speak(u)
  // 先 cancel 再立即 speak 在 Chrome 上会吞掉本次发音，稍微延迟
  if (synth.speaking || synth.pending) {
    synth.cancel()
    setTimeout(go, 60)
  } else {
    go()
  }
}
