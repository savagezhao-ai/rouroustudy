// 数据层：IndexedDB 读写、元信息、以及两版数据迁移
import { describe, it, expect } from 'vitest'
import { fresh } from '../test/helpers'

async function dbLib() {
  return fresh(() => import('./db'))
}

describe('wordId', () => {
  it('由词库 id 和小写单词拼成', async () => {
    const { wordId } = await dbLib()
    expect(wordId('d1', 'Cat')).toBe('d1:cat')
  })

  it('首尾空格和大小写不影响 id', async () => {
    const { wordId } = await dbLib()
    expect(wordId('d1', '  Apple  ')).toBe('d1:apple')
  })

  it('同一单词在不同词库里 id 不同', async () => {
    const { wordId } = await dbLib()
    expect(wordId('d1', 'cat')).not.toBe(wordId('d2', 'cat'))
  })
})

describe('newId', () => {
  it('连续生成不会重复', async () => {
    const { newId } = await dbLib()
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
  })
})

describe('getMeta / setMeta', () => {
  it('没存过的值返回兜底值', async () => {
    const { getMeta } = await dbLib()
    expect(await getMeta('nope', { a: 1 })).toEqual({ a: 1 })
  })

  it('能存能读复杂对象', async () => {
    const { getMeta, setMeta } = await dbLib()
    await setMeta('speech', { voiceURI: 'x', rate: 1.1 })
    expect(await getMeta('speech', null)).toEqual({ voiceURI: 'x', rate: 1.1 })
  })

  it('覆盖写入后读到的新值', async () => {
    const { getMeta, setMeta } = await dbLib()
    await setMeta('k', 1)
    await setMeta('k', 2)
    expect(await getMeta('k', 0)).toBe(2)
  })
})

describe('migrateLegacyWords', () => {
  it('把没有 deckId 的旧单词归入入门词库', async () => {
    const { db, migrateLegacyWords } = await dbLib()
    const d = await db()
    await d.put('words', {
      id: 'cat',
      word: 'cat',
      phonetic: '',
      translation: '猫',
      deckId: '' as string,
    })

    await migrateLegacyWords()

    const all = await d.getAll('words')
    expect(all).toHaveLength(1)
    expect(all[0].deckId).toBe('starter')
  })

  it('已经有 deckId 的单词不受影响', async () => {
    const { db, migrateLegacyWords } = await dbLib()
    const d = await db()
    await d.put('words', {
      id: 'mine:cat',
      word: 'cat',
      phonetic: '',
      translation: '猫',
      deckId: 'mine',
    })

    await migrateLegacyWords()

    expect((await d.getAll('words'))[0].deckId).toBe('mine')
  })
})

describe('migrateWordIds', () => {
  it('把裸单词 id 迁移成 词库:单词，卡片跟着一起迁', async () => {
    const { db, migrateWordIds } = await dbLib()
    const d = await db()
    await d.put('words', {
      id: 'cat',
      word: 'cat',
      phonetic: '',
      translation: '猫',
      deckId: 'starter',
    })
    await d.put('cards', { id: 'cat', card: { due: new Date() } as never })

    await migrateWordIds()

    const words = await d.getAll('words')
    const cards = await d.getAll('cards')
    expect(words.map((w) => w.id)).toEqual(['starter:cat'])
    expect(cards.map((c) => c.id)).toEqual(['starter:cat'])
  })

  it('重复执行不会产生重复数据', async () => {
    const { db, migrateWordIds } = await dbLib()
    const d = await db()
    await d.put('words', {
      id: 'cat',
      word: 'cat',
      phonetic: '',
      translation: '猫',
      deckId: 'starter',
    })

    await migrateWordIds()
    await migrateWordIds()

    const words = await d.getAll('words')
    expect(words).toHaveLength(1)
    expect(words[0].id).toBe('starter:cat')
  })
})

describe('数据库按用户隔离', () => {
  it('切换到另一个用户后读不到上一个用户的单词', async () => {
    const { db } = await dbLib()
    const d = await db()
    await d.put('words', {
      id: 'starter:cat',
      word: 'cat',
      phonetic: '',
      translation: '猫',
      deckId: 'starter',
    })
    expect(await d.get('words', 'starter:cat')).toBeDefined()

    // 新建并切换到另一个用户
    const { createUser } = await fresh(() => import('./users'))
    createUser('小明')

    const { db: db2 } = await dbLib()
    const d2 = await db2()
    expect(await d2.get('words', 'starter:cat')).toBeUndefined()
  })
})

describe('数据库初始化', () => {
  it('新建的数据库自带入门词库', async () => {
    const { db } = await dbLib()
    const d = await db()
    const decks = await d.getAll('decks')

    expect(decks.map((x) => x.id)).toContain('starter')
  })
})
