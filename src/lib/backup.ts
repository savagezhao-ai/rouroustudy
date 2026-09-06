// 数据备份：把当前用户的全部学习数据导出成 JSON 文件，也能从备份文件恢复
// 换设备、清缓存、误删之后就靠它把学习进度找回来
import { db, type Deck, type Word, type CardRow, type LogRow } from './db'
import { getCurrentUser } from './users'

export const BACKUP_FORMAT = 'rouroustudy-backup'
export const BACKUP_VERSION = 1

/** logs 的自增 id 不进备份，恢复时由数据库重新分配，避免和新数据撞号 */
type LogEntry = Omit<LogRow, 'id'>

export interface BackupData {
  decks: Deck[]
  words: Word[]
  cards: CardRow[]
  logs: LogEntry[]
  meta: { key: string; value: unknown }[]
}

export interface BackupPayload {
  format: string
  version: number
  exportedAt: number
  user: { id: string; name: string }
  data: BackupData
}

/** replace：清空后整份恢复；merge：按 id 合并，保留现有数据 */
export type ImportMode = 'replace' | 'merge'

export interface ImportSummary {
  decks: number
  words: number
  cards: number
  logs: number
}

export type BackupCheck = { ok: true; payload: BackupPayload } | { ok: false; error: string }

/** 导出当前用户的全部学习数据 */
export async function exportBackup(): Promise<BackupPayload> {
  const d = await db()
  const [decks, words, cards, logs, meta] = await Promise.all([
    d.getAll('decks'),
    d.getAll('words'),
    d.getAll('cards'),
    d.getAll('logs'),
    d.getAll('meta'),
  ])
  const me = getCurrentUser()

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    user: { id: me.id, name: me.name },
    data: {
      decks,
      words,
      cards,
      logs: logs.map((l) => ({
        wordId: l.wordId,
        rating: l.rating,
        correct: l.correct,
        ts: l.ts,
      })),
      meta,
    },
  }
}

/**
 * JSON 不认识 Date，FSRS 卡片里的 due / last_review 序列化后会变成字符串。
 * 不还原成 Date 的话 `card.due <= now` 恒为假，导入后卡片再也不会到期。
 */
function reviveCard(raw: unknown): CardRow['card'] {
  const c = raw as Record<string, unknown>
  return {
    ...c,
    due: new Date(c.due as string),
    ...(c.last_review ? { last_review: new Date(c.last_review as string) } : {}),
  } as CardRow['card']
}

const STORES = ['decks', 'words', 'cards', 'logs', 'meta'] as const

/**
 * 把备份数据写回当前用户的数据库。
 *
 * merge 模式刻意不动 meta：发音音色、当前词库这类偏好属于"这台设备的设置"，
 * 不应该被备份文件里的旧设置覆盖掉。
 */
export async function applyBackup(
  payload: BackupPayload,
  mode: ImportMode,
): Promise<ImportSummary> {
  const d = await db()
  const { decks, words, cards, logs, meta } = payload.data
  const tx = d.transaction(STORES, 'readwrite')

  if (mode === 'replace') {
    await Promise.all(STORES.map((name) => tx.objectStore(name).clear()))
  }

  for (const deck of decks) await tx.objectStore('decks').put(deck)
  for (const word of words) await tx.objectStore('words').put(word)
  for (const row of cards) {
    await tx.objectStore('cards').put({ id: row.id, card: reviveCard(row.card) })
  }
  for (const log of logs) await tx.objectStore('logs').add(log)
  if (mode === 'replace') {
    for (const row of meta) await tx.objectStore('meta').put(row)
  }

  await tx.done
  return { decks: decks.length, words: words.length, cards: cards.length, logs: logs.length }
}

/** 校验备份文件结构，失败时给出能直接显示给用户看的原因 */
export function validateBackup(raw: unknown): BackupCheck {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '文件内容不是一个有效的备份对象' }
  }
  const o = raw as Record<string, unknown>

  if (o.format !== BACKUP_FORMAT) {
    return { ok: false, error: '这不是记词星的备份文件，请选择「导出备份」生成的 .json' }
  }
  if (typeof o.version !== 'number') {
    return { ok: false, error: '备份文件缺少版本信息' }
  }
  if (o.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `备份版本是 v${o.version}，比当前应用（v${BACKUP_VERSION}）新，请先更新应用`,
    }
  }

  const data = o.data as Record<string, unknown> | undefined
  if (!data) return { ok: false, error: '备份文件里没有数据' }
  for (const key of ['decks', 'words', 'cards', 'logs'] as const) {
    if (!Array.isArray(data[key])) {
      return { ok: false, error: `备份文件结构不完整：缺少 ${key}` }
    }
  }

  return { ok: true, payload: raw as BackupPayload }
}

/** 读取用户选中的备份文件 */
export async function readBackupFile(file: File): Promise<BackupCheck> {
  try {
    return validateBackup(JSON.parse(await file.text()))
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，可能已损坏' }
  }
}

/** 备份文件名：记词星备份-用户名-2026-09-06.json */
export function backupFileName(payload: BackupPayload): string {
  const day = new Date(payload.exportedAt).toISOString().slice(0, 10)
  return `记词星备份-${payload.user.name}-${day}.json`
}

/** 触发浏览器下载（不缩进，大词库能省不少体积） */
export function downloadBackup(payload: BackupPayload) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName(payload)
  a.click()
  URL.revokeObjectURL(url)
}
