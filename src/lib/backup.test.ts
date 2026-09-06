// 备份导出 / 导入恢复
import { describe, it, expect, vi } from 'vitest'

type Db = Awaited<ReturnType<typeof import('./db')['db']>>

async function env() {
  vi.resetModules()
  const dbLib = await import('./db')
  const backupLib = await import('./backup')
  return { ...dbLib, ...backupLib }
}

async function seed(d: Db, deckId: string, word: string, due: Date) {
  await d.put('decks', { id: deckId, name: `词库 ${deckId}`, createdAt: 1 })
  await d.put('words', {
    id: `${deckId}:${word}`,
    word,
    phonetic: '',
    translation: `${word} 的释义`,
    deckId,
  })
  await d.put('cards', {
    id: `${deckId}:${word}`,
    card: { due, state: 2, last_review: due } as never,
  })
}

/** 走一遍真实的「写文件 → 读文件」，JSON 里的 Date 会退化成字符串 */
function throughDisk(payload: unknown) {
  return JSON.parse(JSON.stringify(payload))
}

const DUE = new Date('2026-01-01T00:00:00Z')

describe('exportBackup', () => {
  it('把词库、单词、卡片、复习记录、设置全部带上', async () => {
    const { db, exportBackup, setMeta } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', DUE)
    await d.add('logs', { wordId: 'd1:cat', rating: 3, correct: true, ts: 123 })
    await setMeta('speech', { voiceURI: 'v', rate: 1.2 })

    const p = await exportBackup()

    expect(p.format).toBe('rouroustudy-backup')
    // 新建的库自带 starter 词库，所以这里只断言目标词库被带上
    expect(p.data.decks.some((x) => x.id === 'd1')).toBe(true)
    expect(p.data.words.map((w) => w.word)).toEqual(['cat'])
    expect(p.data.cards.map((c) => c.id)).toEqual(['d1:cat'])
    expect(p.data.logs).toHaveLength(1)
    expect(p.data.meta.some((m) => m.key === 'speech')).toBe(true)
  })

  it('带上导出者的用户名，方便认出是谁的备份', async () => {
    const { exportBackup } = await env()
    const p = await exportBackup()

    expect(p.user.name).toBe('def')
    expect(typeof p.exportedAt).toBe('number')
  })

  it('复习记录不带自增 id', async () => {
    const { db, exportBackup } = await env()
    const d = await db()
    await d.add('logs', { wordId: 'x', rating: 1, correct: false, ts: 1 })

    const p = await exportBackup()

    expect(Object.keys(p.data.logs[0])).not.toContain('id')
  })

  it('空用户也能导出，不报错', async () => {
    const { exportBackup } = await env()
    const p = await exportBackup()

    expect(p.data.words).toEqual([])
    expect(p.data.cards).toEqual([])
  })
})

describe('applyBackup 覆盖模式', () => {
  it('清空现有数据后整份恢复', async () => {
    const { db, applyBackup } = await env()
    const d = await db()
    await seed(d, 'old', 'toremove', DUE)

    const backup = throughDisk({
      format: 'rouroustudy-backup',
      version: 1,
      exportedAt: Date.now(),
      user: { id: 'def', name: 'def' },
      data: {
        decks: [{ id: 'new', name: '新词库', createdAt: 2 }],
        words: [
          { id: 'new:dog', word: 'dog', phonetic: '', translation: '狗', deckId: 'new' },
        ],
        cards: [],
        logs: [],
        meta: [],
      },
    })

    const summary = await applyBackup(backup, 'replace')

    expect(summary.words).toBe(1)
    const words = await d.getAll('words')
    expect(words.map((w) => w.word)).toEqual(['dog'])
    expect((await d.getAll('decks')).map((x) => x.id)).toEqual(['new'])
  })

  it('恢复设置项', async () => {
    const { db, applyBackup, getMeta } = await env()
    const d = await db()
    await d.put('meta', { key: 'speech', value: { voiceURI: 'old', rate: 2 } })

    await applyBackup(
      {
        format: 'rouroustudy-backup',
        version: 1,
        exportedAt: Date.now(),
        user: { id: 'def', name: 'def' },
        data: {
          decks: [],
          words: [],
          cards: [],
          logs: [],
          meta: [{ key: 'speech', value: { voiceURI: 'new', rate: 0.8 } }],
        },
      },
      'replace',
    )

    expect(await getMeta('speech', null)).toEqual({ voiceURI: 'new', rate: 0.8 })
  })

  it('导入后复习记录重新分配 id', async () => {
    const { db, applyBackup } = await env()
    const d = await db()
    await d.add('logs', { wordId: 'existing', rating: 3, correct: true, ts: 1 })

    await applyBackup(
      {
        format: 'rouroustudy-backup',
        version: 1,
        exportedAt: Date.now(),
        user: { id: 'def', name: 'def' },
        data: {
          decks: [],
          words: [],
          cards: [],
          logs: [
            { wordId: 'a', rating: 3, correct: true, ts: 10 },
            { wordId: 'b', rating: 1, correct: false, ts: 11 },
          ],
          meta: [],
        },
      },
      'replace',
    )

    const logs = await d.getAll('logs')
    expect(logs).toHaveLength(2)
    // 自增主键重新发号，不会和导入前的记录撞上
    expect(new Set(logs.map((l) => l.id)).size).toBe(2)
  })
})

describe('applyBackup 合并模式', () => {
  it('保留现有数据，只把备份里的内容并进来', async () => {
    const { db, applyBackup } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', DUE)

    await applyBackup(
      {
        format: 'rouroustudy-backup',
        version: 1,
        exportedAt: Date.now(),
        user: { id: 'def', name: 'def' },
        data: {
          decks: [{ id: 'd2', name: '第二个词库', createdAt: 2 }],
          words: [
            { id: 'd2:dog', word: 'dog', phonetic: '', translation: '狗', deckId: 'd2' },
          ],
          cards: [],
          logs: [],
          meta: [],
        },
      },
      'merge',
    )

    expect((await d.getAll('words')).map((w) => w.word).sort()).toEqual(['cat', 'dog'])
    expect(await d.getAll('decks')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'd1' }), expect.objectContaining({ id: 'd2' })]),
    )
  })

  it('同 id 的单词以备份内容为准', async () => {
    const { db, applyBackup } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', DUE)

    await applyBackup(
      {
        format: 'rouroustudy-backup',
        version: 1,
        exportedAt: Date.now(),
        user: { id: 'def', name: 'def' },
        data: {
          decks: [],
          words: [
            { id: 'd1:cat', word: 'cat', phonetic: '/kæt/', translation: '猫（修订版）', deckId: 'd1' },
          ],
          cards: [],
          logs: [],
          meta: [],
        },
      },
      'merge',
    )

    const w = await d.get('words', 'd1:cat')
    expect(w?.translation).toBe('猫（修订版）')
  })

  it('不动本机设置（发音音色这类偏好属于设备，不该被旧备份覆盖）', async () => {
    const { db, applyBackup, getMeta } = await env()
    const d = await db()
    await d.put('meta', { key: 'speech', value: { voiceURI: '本机音色', rate: 1.3 } })

    await applyBackup(
      {
        format: 'rouroustudy-backup',
        version: 1,
        exportedAt: Date.now(),
        user: { id: 'def', name: 'def' },
        data: {
          decks: [],
          words: [],
          cards: [],
          logs: [],
          meta: [{ key: 'speech', value: { voiceURI: '备份里的音色', rate: 0.1 } }],
        },
      },
      'merge',
    )

    expect(await getMeta('speech', null)).toEqual({ voiceURI: '本机音色', rate: 1.3 })
  })
})

describe('卡片到期时间在往返之后不丢', () => {
  // 这是最容易踩的坑：JSON 不认识 Date，序列化后 due 变成字符串，
  // 不还原的话 `card.due <= now` 恒为假，导入的卡片永远不会再出现。
  it('导出再导入后，due 仍然是 Date 且时刻一致', async () => {
    const { db, exportBackup, applyBackup } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', DUE)

    const payload = await exportBackup()
    await applyBackup(throughDisk(payload), 'replace')

    const row = await d.get('cards', 'd1:cat')
    expect(row?.card.due).toBeInstanceOf(Date)
    expect(row?.card.due.getTime()).toBe(DUE.getTime())
  })

  it('last_review 也一样被还原成 Date', async () => {
    const { db, exportBackup, applyBackup } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', DUE)

    const payload = await exportBackup()
    await applyBackup(throughDisk(payload), 'replace')

    const row = await d.get('cards', 'd1:cat')
    expect(row?.card.last_review).toBeInstanceOf(Date)
  })

  it('还原后的到期卡片能被复习队列正常捞出来', async () => {
    const { db, exportBackup, applyBackup } = await env()
    const d = await db()
    await seed(d, 'd1', 'cat', new Date(Date.now() - 60_000))

    const payload = await exportBackup()
    await applyBackup(throughDisk(payload), 'replace')

    // 导入后回到正常的复习流程里，这张卡应该算到期
    const studyLib = await import('./study')
    const q = await studyLib.buildQueue('d1')
    expect(q.map((x) => x.word.word)).toEqual(['cat'])
  })
})

describe('validateBackup', () => {
  const validPayload = {
    format: 'rouroustudy-backup',
    version: 1,
    exportedAt: 1,
    user: { id: 'def', name: 'def' },
    data: { decks: [], words: [], cards: [], logs: [], meta: [] },
  }

  it('接受合法的备份', async () => {
    const { validateBackup, BACKUP_VERSION } = await env()
    expect(validateBackup({ ...validPayload, version: BACKUP_VERSION }).ok).toBe(true)
  })

  it('拒绝不是备份文件的 JSON', async () => {
    const { validateBackup } = await env()
    const r = validateBackup({ hello: 'world' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/记词星的备份/)
  })

  it('拒绝新版本应用产出的备份', async () => {
    const { validateBackup } = await env()
    const r = validateBackup({ ...validPayload, version: 999 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/更新应用/)
  })

  it('拒绝结构残缺的备份', async () => {
    const { validateBackup } = await env()
    const r = validateBackup({ ...validPayload, data: { decks: [] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/结构不完整/)
  })

  it('拒绝 null 与基本类型', async () => {
    const { validateBackup } = await env()
    expect(validateBackup(null).ok).toBe(false)
    expect(validateBackup('字符串').ok).toBe(false)
    expect(validateBackup(42).ok).toBe(false)
  })
})

describe('readBackupFile', () => {
  it('读出合法文件内容', async () => {
    const { readBackupFile } = await env()
    const payload = {
      format: 'rouroustudy-backup',
      version: 1,
      exportedAt: 1,
      user: { id: 'def', name: 'def' },
      data: { decks: [], words: [], cards: [], logs: [], meta: [] },
    }
    const file = new File([JSON.stringify(payload)], 'b.json')

    const r = await readBackupFile(file)
    expect(r.ok).toBe(true)
  })

  it('内容不是 JSON 时给出可读的提示', async () => {
    const { readBackupFile } = await env()
    const file = new File(['这不是 JSON', ], 'b.json')

    const r = await readBackupFile(file)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/)
  })
})

describe('backupFileName', () => {
  it('带上用户名和日期', async () => {
    const { backupFileName } = await env()
    const name = backupFileName({
      format: 'x',
      version: 1,
      exportedAt: new Date('2026-09-06T10:00:00Z').getTime(),
      user: { id: 'def', name: '小明' },
      data: { decks: [], words: [], cards: [], logs: [], meta: [] },
    })

    expect(name).toBe('记词星备份-小明-2026-09-06.json')
  })
})
