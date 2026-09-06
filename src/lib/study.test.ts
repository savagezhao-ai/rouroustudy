// 学习调度：复习队列生成、每日新词额度、连续打卡、词库统计
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type Db = Awaited<ReturnType<typeof import('./db')['db']>>

/** 同时 reload db 与 study，确保两者共享同一个模块实例（否则连接缓存不是同一份） */
async function env() {
  vi.resetModules()
  const dbLib = await import('./db')
  const studyLib = await import('./study')
  return { ...dbLib, ...studyLib }
}

/** 往某个词库塞若干个未学习过的单词 */
async function seedWords(d: Db, deckId: string, words: string[]) {
  const tx = d.transaction('words', 'readwrite')
  await Promise.all(
    words.map((w) =>
      tx.store.put({
        id: `${deckId}:${w}`,
        word: w,
        phonetic: '',
        translation: `${w} 的释义`,
        deckId,
      }),
    ),
  )
  await tx.done
}

/** 给单词写一张 FSRS 卡片，due 决定它是否到期 */
async function setDue(d: Db, deckId: string, word: string, due: Date) {
  await d.put('cards', {
    id: `${deckId}:${word}`,
    card: { due } as never,
  })
}

describe('shuffle', () => {
  it('不改动原数组', async () => {
    const { shuffle } = await env()
    const src = [1, 2, 3, 4, 5]
    shuffle(src)
    expect(src).toEqual([1, 2, 3, 4, 5])
  })

  it('元素一个不少也不多', async () => {
    const { shuffle } = await env()
    const src = Array.from({ length: 50 }, (_, i) => i)
    expect(shuffle(src).sort((a, b) => a - b)).toEqual(src)
  })
})

describe('buildQueue 正常模式', () => {
  it('到期的卡片进入队列，未到期的不进', async () => {
    const { db, buildQueue } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['due1', 'due2', 'future'])
    const past = new Date(Date.now() - 3600_000)
    const future = new Date(Date.now() + 3600_000)
    await setDue(d, 'd1', 'due1', past)
    await setDue(d, 'd1', 'due2', past)
    await setDue(d, 'd1', 'future', future)

    const q = await buildQueue('d1')

    expect(q.map((x) => x.word.word).sort()).toEqual(['due1', 'due2'])
  })

  it('到期卡标记为非新词', async () => {
    const { db, buildQueue } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['old'])
    await setDue(d, 'd1', 'old', new Date(Date.now() - 1000))

    const q = await buildQueue('d1')

    expect(q[0].isNew).toBe(false)
  })

  it('新词标记为新词，且排在到期卡之后', async () => {
    const { db, buildQueue } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['old', 'fresh'])
    await setDue(d, 'd1', 'old', new Date(Date.now() - 1000))

    const q = await buildQueue('d1')

    expect(q.map((x) => x.word.word)).toEqual(['old', 'fresh'])
    expect(q[1].isNew).toBe(true)
  })

  it('新词数量受每日上限约束', async () => {
    const { db, buildQueue, DAILY_NEW } = await env()
    const d = await db()
    await seedWords(d, 'd1', Array.from({ length: DAILY_NEW + 5 }, (_, i) => `w${i}`))

    const first = await buildQueue('d1')

    expect(first).toHaveLength(DAILY_NEW)
    expect(first.every((x) => x.isNew)).toBe(true)
  })

  // 注意：额度是在生成队列时就扣掉的，不是答完才扣。
  // 所以进了复习页又中途退出，当天额度不会退回。
  it('当天额度用满后不再发新词，即使上一批还没学', async () => {
    const { db, buildQueue, DAILY_NEW } = await env()
    const d = await db()
    await seedWords(d, 'd1', Array.from({ length: DAILY_NEW + 5 }, (_, i) => `w${i}`))

    await buildQueue('d1')
    const second = await buildQueue('d1')

    expect(second).toHaveLength(0)
  })

  it('换一天后新词额度重置', async () => {
    const { db, buildQueue, DAILY_NEW } = await env()
    const d = await db()
    await seedWords(d, 'd1', Array.from({ length: DAILY_NEW + 3 }, (_, i) => `w${i}`))

    // 第一天吃满额度
    expect(await buildQueue('d1')).toHaveLength(DAILY_NEW)
    expect(await buildQueue('d1')).toHaveLength(0)

    // 跳到第二天，额度重新发
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 86400_000 + 3600_000)
    try {
      expect(await buildQueue('d1')).toHaveLength(DAILY_NEW)
    } finally {
      vi.useRealTimers()
    }
  })

  it('只取当前词库的单词', async () => {
    const { db, buildQueue } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['mine'])
    await seedWords(d, 'd2', ['other'])

    const q = await buildQueue('d1')

    expect(q.map((x) => x.word.word)).toEqual(['mine'])
  })
})

describe('buildQueue 循环练习模式', () => {
  it('把整个词库都放进队列，不管是否到期', async () => {
    const { db, buildQueue } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['a', 'b', 'c'])
    await setDue(d, 'd1', 'a', new Date(Date.now() + 86400_000))

    const q = await buildQueue('d1', true)

    expect(q.map((x) => x.word.word).sort()).toEqual(['a', 'b', 'c'])
    expect(q.every((x) => !x.isNew)).toBe(true)
  })

  it('不消耗每日新词额度', async () => {
    const { db, buildQueue, DAILY_NEW } = await env()
    const d = await db()
    await seedWords(d, 'd1', ['a', 'b'])

    await buildQueue('d1', true)
    await buildQueue('d1', true)

    // 额度没被动过，正常模式依然能取满
    await seedWords(d, 'd1', Array.from({ length: DAILY_NEW }, (_, i) => `n${i}`))
    expect(await buildQueue('d1')).toHaveLength(DAILY_NEW)
  })
})

describe('touchStreak', () => {
  beforeEach(() => {
    // 只接管 Date：fake-indexeddb 内部靠定时器推进，连它一起冻结会把数据库操作挂死
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-01T09:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function readStreak(): Promise<{ last: string; streak: number }> {
    const { getMeta, db } = await env()
    await db()
    return getMeta('streak', { last: '', streak: 0 })
  }

  it('第一次学习记为 1 天', async () => {
    const { touchStreak } = await env()
    await touchStreak()
    expect((await readStreak()).streak).toBe(1)
  })

  it('同一天多次作答只算一天', async () => {
    const { touchStreak } = await env()
    await touchStreak()
    await touchStreak()
    await touchStreak()
    expect((await readStreak()).streak).toBe(1)
  })

  it('连续第二天累加', async () => {
    const { touchStreak } = await env()
    await touchStreak()

    vi.setSystemTime(new Date('2026-03-02T09:00:00'))
    await touchStreak()
    expect((await readStreak()).streak).toBe(2)

    vi.setSystemTime(new Date('2026-03-03T09:00:00'))
    await touchStreak()
    expect((await readStreak()).streak).toBe(3)
  })

  it('中断后重新从 1 开始', async () => {
    const { touchStreak } = await env()
    await touchStreak()
    vi.setSystemTime(new Date('2026-03-02T09:00:00'))
    await touchStreak()
    expect((await readStreak()).streak).toBe(2)

    // 跳过一天
    vi.setSystemTime(new Date('2026-03-04T09:00:00'))
    await touchStreak()
    expect((await readStreak()).streak).toBe(1)
  })
})

describe('deckStats', () => {
  it('分别统计总数、已学、到期和剩余新词额度', async () => {
    const { db, deckStats, DAILY_NEW } = await env()
    const d = await db()
    await d.put('decks', { id: 'd1', name: '词库一', createdAt: 1 })
    await seedWords(d, 'd1', ['learnedDue', 'learnedFuture', 'newA', 'newB'])
    await setDue(d, 'd1', 'learnedDue', new Date(Date.now() - 1000))
    await setDue(d, 'd1', 'learnedFuture', new Date(Date.now() + 86400_000))

    const stats = await deckStats()
    const s = stats.find((x) => x.deck.id === 'd1')

    expect(s).toMatchObject({
      total: 4,
      learned: 2,
      due: 1,
      newLeft: DAILY_NEW,
    })
  })

  it('多个词库的统计各自独立', async () => {
    const { db, deckStats } = await env()
    const d = await db()
    await d.put('decks', { id: 'x', name: 'X', createdAt: 1 })
    await d.put('decks', { id: 'y', name: 'Y', createdAt: 2 })
    await seedWords(d, 'x', ['a', 'b', 'c'])
    await seedWords(d, 'y', ['z'])

    const stats = await deckStats()
    const byId = Object.fromEntries(stats.map((s) => [s.deck.id, s]))

    expect(byId.x?.total).toBe(3)
    expect(byId.y?.total).toBe(1)
  })
})
