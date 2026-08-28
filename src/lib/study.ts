// 学习逻辑：多词库统计、复习队列、连续打卡
import { db, getMeta, setMeta, DAILY_NEW, type Deck, type Word } from './db'
import type { Card as FsrsCard } from 'ts-fsrs'

export interface QueueItem {
  word: Word
  isNew: boolean
}

export interface DeckStat {
  deck: Deck
  total: number
  learned: number
  due: number
  newLeft: number
}

export const todayStr = () => new Date().toDateString()

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 每天第一次作答时更新连续学习天数 */
export async function touchStreak() {
  const today = todayStr()
  const { last, streak } = await getMeta('streak', { last: '', streak: 0 })
  if (last === today) return
  const yesterday = new Date(Date.now() - 864e5).toDateString()
  const next = last === yesterday ? streak + 1 : 1
  await setMeta('streak', { last: today, streak: next })
}

const newTodayKey = (deckId: string) => `newToday:${deckId}`

/** 所有词库的学习概况 */
export async function deckStats(): Promise<DeckStat[]> {
  const d = await db()
  const now = new Date()
  const [decks, words, cardRows] = await Promise.all([
    d.getAll('decks'),
    d.getAll('words'),
    d.getAll('cards'),
  ])
  const cardMap = new Map(cardRows.map((r) => [r.id, r.card]))
  return Promise.all(
    decks.map(async (deck) => {
      const dw = words.filter((w) => w.deckId === deck.id)
      const cards = dw
        .map((w) => cardMap.get(w.id))
        .filter((c): c is FsrsCard => !!c)
      const npd = await getMeta(newTodayKey(deck.id), { date: '', count: 0 })
      const used = npd.date === todayStr() ? npd.count : 0
      return {
        deck,
        total: dw.length,
        learned: cards.length,
        due: cards.filter((c) => c.due <= now).length,
        newLeft: Math.max(0, DAILY_NEW - used),
      }
    }),
  )
}

/**
 * 生成某词库的复习队列：
 * - 正常模式：全部到期卡 + 今日剩余新词
 * - 循环练习模式（practice）：整个词库乱序过一遍，仍记录 FSRS 评级，不消耗新词额度
 */
export async function buildQueue(deckId: string, practice = false): Promise<QueueItem[]> {
  const d = await db()
  const now = new Date()
  const [words, cardRows] = await Promise.all([d.getAll('words'), d.getAll('cards')])
  const deckWords = words.filter((w) => w.deckId === deckId)

  if (practice) {
    return shuffle(deckWords.map((w) => ({ word: w, isNew: false })))
  }

  const cardMap = new Map(cardRows.map((r) => [r.id, r.card]))
  const due = deckWords.filter((w) => {
    const c = cardMap.get(w.id)
    return c && c.due <= now
  })
  const fresh = deckWords.filter((w) => !cardMap.has(w.id))

  const key = newTodayKey(deckId)
  const npd = await getMeta(key, { date: '', count: 0 })
  const used = npd.date === todayStr() ? npd.count : 0
  const chosen = fresh.slice(0, Math.max(0, DAILY_NEW - used))
  if (chosen.length > 0) {
    await setMeta(key, { date: todayStr(), count: used + chosen.length })
  }

  return [
    ...shuffle(due.map((w) => ({ word: w, isNew: false }))),
    ...chosen.map((w) => ({ word: w, isNew: true })),
  ]
}
