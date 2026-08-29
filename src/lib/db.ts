// IndexedDB 本地存储（按用户分库）：多词库、单词、FSRS 卡片状态、复习记录、元信息
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Card as FsrsCard } from 'ts-fsrs'
import { getCurrentUser } from './users'

export interface Deck {
  id: string
  name: string
  createdAt: number
}

/** Anki 卡片的完整字段（翻面后分区显示用） */
export interface WordField {
  name: string
  value: string
}

export interface Word {
  id: string // 格式：`${deckId}:${word}`，同一单词可同时存在于多个词库
  word: string
  phonetic: string
  translation: string
  deckId: string
  fields?: WordField[] // Anki 原始全部字段（牛津双解、简明、词根等）
}

export interface CardRow {
  id: string
  card: FsrsCard // FSRS 调度状态（due、stability 等）
}

export interface LogRow {
  id?: number
  wordId: string
  rating: number
  correct: boolean
  ts: number
}

interface AppDB extends DBSchema {
  decks: { key: string; value: Deck }
  words: { key: string; value: Word }
  cards: { key: string; value: CardRow }
  logs: { key: number; value: LogRow; indexes: { 'by-ts': number } }
  meta: { key: string; value: { key: string; value: unknown } }
}

// 每个用户一个独立的数据库实例
const dbs = new Map<string, Promise<IDBPDatabase<AppDB>>>()

export async function db() {
  const uid = getCurrentUser().id
  if (!dbs.has(uid)) {
    dbs.set(
      uid,
      openDB<AppDB>(`wordmemo_u_${uid}`, 3, {
        upgrade(d, oldVersion) {
          if (oldVersion < 2) {
            // v2：基础表
            d.createObjectStore('words', { keyPath: 'id' })
            d.createObjectStore('cards', { keyPath: 'id' })
            d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true })
              .createIndex('by-ts', 'ts')
            d.createObjectStore('meta', { keyPath: 'key' })
          }
          if (oldVersion < 3) {
            // v3：引入多词库（存量单词归类在应用层迁移）
            const decks = d.createObjectStore('decks', { keyPath: 'id' })
            decks.put({ id: 'starter', name: '入门词库', createdAt: Date.now() })
          }
        },
      }),
    )
  }
  return dbs.get(uid)!
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const d = await db()
  const row = await d.get('meta', key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown) {
  const d = await db()
  await d.put('meta', { key, value })
}

/** 旧版本数据迁移：把没有 deckId 的存量单词归入入门词库 */
export async function migrateLegacyWords() {
  const d = await db()
  const all = await d.getAll('words')
  const orphan = all.filter((w) => !w.deckId)
  if (orphan.length === 0) return
  const tx = d.transaction('words', 'readwrite')
  await Promise.all(orphan.map((w) => tx.store.put({ ...w, deckId: 'starter' })))
  await tx.done
}

/**
 * 单词 ID 迁移：从裸单词改为 `${deckId}:${word}`，
 * 使同一单词可以同时存在于多个词库（各库独立 FSRS 进度）
 */
export async function migrateWordIds() {
  const d = await db()
  if (await getMeta('v4wordids', false)) return
  const [words, cards] = await Promise.all([d.getAll('words'), d.getAll('cards')])
  const cardMap = new Map(cards.map((c) => [c.id, c]))
  const tx = d.transaction(['words', 'cards'], 'readwrite')
  for (const w of words) {
    const newId = `${w.deckId}:${w.word}`
    if (w.id === newId) continue
    const card = cardMap.get(w.id)
    if (card) {
      await tx.objectStore('cards').put({ ...card, id: newId })
      await tx.objectStore('cards').delete(card.id)
    }
    await tx.objectStore('words').put({ ...w, id: newId })
    await tx.objectStore('words').delete(w.id)
  }
  await tx.done
  await setMeta('v4wordids', true)
}

/** 生成 ID（优先用原生 UUID，旧浏览器降级） */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** 词库内单词的唯一 ID */
export function wordId(deckId: string, word: string): string {
  return `${deckId}:${word.trim().toLowerCase()}`
}

export const DAILY_NEW = 10 // 每个词库每天新词上限
