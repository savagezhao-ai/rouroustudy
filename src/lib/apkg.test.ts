// Anki .apkg 导入：zip 解包 → SQLite 读取 → 字段启发式推断
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { describe, it, expect, vi } from 'vitest'
import { fresh } from '../test/helpers'

// apkg.ts 里的 getSql 用 locateFile 从 BASE_URL 拉 wasm，node 环境取不到，
// 这里把初始化好的实例直接塞给模块用。
const wasmBinary = readFileSync(
  path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
)
const initSqlJs = (await vi.importActual<typeof import('sql.js')>('sql.js')).default
const SQL = await initSqlJs({ wasmBinary })

vi.doMock('sql.js', () => ({ default: () => Promise.resolve(SQL) }))

async function apkgLib() {
  return fresh(() => import('./apkg'))
}

interface NoteSpec {
  mid: number
  fields: string[]
}

/** 在内存里拼一个结构合法的 .apkg */
function buildApkg(opts: {
  models: string
  decks?: string
  notes: NoteSpec[]
  dbName?: 'collection.anki2' | 'collection.anki21'
}): Uint8Array {
  const db = new SQL.Database()
  db.run('CREATE TABLE col (models TEXT, decks TEXT);')
  db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);')
  db.run('INSERT INTO col VALUES (?, ?)', [opts.models, opts.decks ?? '{}'])
  let i = 1
  for (const n of opts.notes) {
    db.run('INSERT INTO notes VALUES (?, ?, ?)', [i++, n.mid, n.fields.join('\x1f')])
  }
  const data = db.export()
  return zipSync({
    [opts.dbName ?? 'collection.anki2']: new Uint8Array(data),
    media: strToU8('{}'),
  })
}

function toFile(buf: Uint8Array, name = '我的词库.apkg'): File {
  // TS 6 的 ArrayBuffer 泛型较严，这里明确断言成 BlobPart
  return new File([buf as unknown as BlobPart], name)
}

const CN_MODELS = JSON.stringify({
  '1001': {
    name: '小学英语词汇',
    flds: [{ name: '单词' }, { name: '音标' }, { name: '释义' }],
  },
})

const FB_MODELS = JSON.stringify({
  '1002': { name: 'Front-Back 卡组', flds: [{ name: 'Front' }, { name: 'Back' }] },
})

describe('importApkg 基本解析', () => {
  it('按模板字段名提取单词、音标、释义', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [{ mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words).toHaveLength(1)
    expect(r.words[0].word).toBe('apple')
    expect(r.words[0].phonetic).toBe('/ˈæpl/')
    expect(r.words[0].translation).toBe('n. 苹果')
  })

  it('保留模板的全部字段，供翻面后分区展示', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: JSON.stringify({
        '1001': {
          name: 'X',
          flds: [{ name: '单词' }, { name: '音标' }, { name: '释义' }, { name: '牛津双解' }],
        },
      }),
      notes: [
        { mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果', '苹果：一种水果\n常见水果'] },
      ],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].fields.map((f) => f.name)).toEqual([
      '单词',
      '音标',
      '释义',
      '牛津双解',
    ])
    expect(r.words[0].fields[3].value).toContain('苹果：一种水果')
  })

  it('认识 Front / Back 这种英文模板', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: FB_MODELS,
      notes: [{ mid: 1002, fields: ['water', 'n. 水'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].word).toBe('water')
    expect(r.words[0].translation).toBe('n. 水')
  })
})

describe('importApkg 内容清洗', () => {
  it('剥掉 HTML 标签与 Anki 富文本标记', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [{ mid: 1001, fields: ['<b>water</b>', '/ˈwɔːtə/', '<div>n. 水</div>'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].word).toBe('water')
    expect(r.words[0].translation).toBe('n. 水')
  })

  it('去掉 [sound:xxx] 音频标记', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [{ mid: 1001, fields: ['tree', '/triː/', '[sound:tree.mp3] n. 树'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].translation).toBe('n. 树')
  })

  it('把 KK / DJ 双音标规整成单一音标', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [{ mid: 1001, fields: ['about', 'KK:[ǝˈbaʊt]  DJ:[ǝˈbaut]', 'prep. 关于'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].phonetic).toBe('/ǝˈbaʊt/')
  })

  it('转义过的 HTML 实体还原成正常字符', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [{ mid: 1001, fields: ['a&amp;b', '/eɪ/', 'n. A &amp; B'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].word).toBe('a&b')
    expect(r.words[0].translation).toBe('n. A & B')
  })
})

describe('importApkg 容错', () => {
  it('同一单词重复出现只保留一个（忽略大小写）', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [
        { mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] },
        { mid: 1001, fields: ['Apple', '/ˈæpl/', 'n. 苹果'] },
        { mid: 1001, fields: ['APPLE', '/ˈæpl/', 'n. 苹果'] },
      ],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words).toHaveLength(1)
  })

  it('没有释义的笔记被跳过', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      notes: [
        { mid: 1001, fields: ['lonely', '', ''] },
        { mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] },
      ],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words.map((w) => w.word)).toEqual(['apple'])
  })

  it('优先读取新版 collection.anki21', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      dbName: 'collection.anki21',
      notes: [{ mid: 1001, fields: ['newer', '/njuː/', 'adj. 更新的'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].word).toBe('newer')
  })

  it('包里没有 collection 时报错而不是静默返回', async () => {
    const { importApkg } = await apkgLib()
    const buf = zipSync({ media: strToU8('{}') })

    await expect(importApkg(toFile(buf))).rejects.toThrow(/Anki/)
  })

  it('卡组里一条笔记都没有时报错', async () => {
    const { importApkg } = await apkgLib()
    const db = new SQL.Database()
    db.run('CREATE TABLE col (models TEXT, decks TEXT);')
    db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);')
    db.run('INSERT INTO col VALUES (?, ?)', ['{}', '{}'])
    const buf = zipSync({
      'collection.anki2': new Uint8Array(db.export()),
      media: strToU8('{}'),
    })

    await expect(importApkg(toFile(buf))).rejects.toThrow(/笔记/)
  })

  it('col 表缺 models 定义时不崩，退化为按位置推断', async () => {
    const { importApkg } = await apkgLib()
    const db = new SQL.Database()
    db.run('CREATE TABLE col (decks TEXT);')
    db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);')
    db.run('INSERT INTO col VALUES (?)', ['{}'])
    db.run('INSERT INTO notes VALUES (?, ?, ?)', [1, 999, ['cat', 'n. 猫'].join('\x1f')])
    const buf = zipSync({
      'collection.anki2': new Uint8Array(db.export()),
      media: strToU8('{}'),
    })

    const r = await importApkg(toFile(buf))

    expect(r.words[0].word).toBe('cat')
    expect(r.words[0].translation).toBe('n. 猫')
  })
})

describe('importApkg 词库命名', () => {
  it('卡组名优先于模板名', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      decks: JSON.stringify({ '1': { name: '三年级上册' } }),
      notes: [{ mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.deckName).toBe('三年级上册')
  })

  it('卡组名是 Default 时退回模板名', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: CN_MODELS,
      decks: JSON.stringify({ '1': { name: 'Default' } }),
      notes: [{ mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] }],
    })

    const r = await importApkg(toFile(buf))

    expect(r.deckName).toBe('小学英语词汇')
  })

  it('都没有时退回文件名', async () => {
    const { importApkg } = await apkgLib()
    const buf = buildApkg({
      models: JSON.stringify({ '1001': { name: '' } }),
      notes: [{ mid: 1001, fields: ['apple', '/ˈæpl/', 'n. 苹果'] }],
    })

    const r = await importApkg(toFile(buf, '我的词库.apkg'))

    expect(r.deckName).toBe('我的词库')
  })
})
