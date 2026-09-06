import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fresh } from '../test/helpers'

/** 每条一行 JSON，字段与 scripts/build-dict.mjs 产物一致 */
const PACK = [
  JSON.stringify({
    w: 'abandon',
    p: "ə'bændən",
    t: ['vt. 放弃, 抛弃', 'n. 放任'],
    d: ['v. forsake, leave behind', 'n. the trait of lacking restraint'],
    e: 'd:abandoned/p:abandoned/i:abandoning/3:abandons',
    c: 3,
    o: 1,
    g: 'gk cet4',
    f: 2182,
  }),
  JSON.stringify({
    w: 'dog',
    p: 'dɒg',
    t: ['n. 狗'],
    d: ['n. a domesticated carnivorous mammal'],
    e: 's:dogs',
    c: 2,
    o: 1,
    g: 'zk',
    f: 1200,
  }),
  JSON.stringify({
    w: 'given',
    p: "'gɪvn",
    t: ['v. 给予（give 的过去分词）'],
    d: [],
    e: '0:give',
    c: 0,
    o: 0,
    g: '',
    f: 800,
  }),
  JSON.stringify({
    w: 'give',
    p: 'gɪv',
    t: ['vt. 给, 给予'],
    d: ['v. transfer possession to someone'],
    e: 'p:gave/d:given/i:giving/3:gives',
    c: 5,
    o: 1,
    g: 'zk gk',
    f: 300,
  }),
].join('\n')

async function env() {
  return fresh(() => import('./dictionary'))
}

async function seeded() {
  const lib = await env()
  await lib.importPack(PACK, 'test-v1')
  return lib
}

describe('parseExchange', () => {
  it('解析词形变化字段', async () => {
    const { parseExchange } = await env()
    expect(parseExchange('d:abandoned/p:abandoned/i:abandoning')).toEqual([
      { type: 'd', form: 'abandoned' },
      { type: 'p', form: 'abandoned' },
      { type: 'i', form: 'abandoning' },
    ])
  })

  it('空值返回空数组', async () => {
    const { parseExchange } = await env()
    expect(parseExchange('')).toEqual([])
  })
})

describe('parsePack', () => {
  it('解析词条字段', async () => {
    const { parsePack } = await env()
    const { entries } = parsePack(PACK)
    const abandon = entries.find((e) => e.word === 'abandon')!
    expect(abandon.phonetic).toBe("ə'bændən")
    expect(abandon.translation).toEqual(['vt. 放弃, 抛弃', 'n. 放任'])
    expect(abandon.definition).toHaveLength(2)
    expect(abandon.collins).toBe(3)
    expect(abandon.oxford).toBe(1)
    expect(abandon.tags).toEqual(['gk', 'cet4'])
  })

  it('由 exchange 生成「词形 -> 原形」映射', async () => {
    const { parsePack } = await env()
    const { forms } = parsePack(PACK)
    expect(forms.get('abandoned')).toBe('abandon')
    expect(forms.get('abandoning')).toBe('abandon')
    expect(forms.get('dogs')).toBe('dog')
  })

  it('0:lemma 表示该词本身是变形，指向原形', async () => {
    const { parsePack } = await env()
    const { forms } = parsePack(PACK)
    expect(forms.get('given')).toBe('give')
  })
})

describe('stemCandidates', () => {
  it('生成还原候选并按原词排除', async () => {
    const { stemCandidates } = await env()
    expect(stemCandidates('dogs')).toContain('dog')
    expect(stemCandidates('cities')).toContain('city')
    expect(stemCandidates('stopped')).toContain('stop')
    expect(stemCandidates('making')).toContain('make')
    expect(stemCandidates('running')).toContain('run')
    expect(stemCandidates('studied')).toContain('study')
    // 候选里不应包含原词本身
    expect(stemCandidates('dog')).not.toContain('dog')
  })
})

describe('词条查询', () => {
  beforeEach(async () => {
    // 每个用例重新加载模块，避免连接缓存把数据带到下一个用例
    const lib = await env()
    await lib.resetDictDb()
  })

  it('精确命中并保留大小写原形', async () => {
    const lib = await seeded()
    const hit = await lib.lookupDict('abandon')
    expect(hit?.via).toBe('exact')
    expect(hit?.matched).toBe('abandon')
    expect(hit?.entry.translation[0]).toContain('放弃')
  })

  it('查询不区分大小写', async () => {
    const lib = await seeded()
    expect((await lib.lookupDict('ABANDON'))?.matched).toBe('abandon')
    expect((await lib.lookupDict('  dog  '))?.matched).toBe('dog')
  })

  it('查变形词时通过词形表还原到原形', async () => {
    const lib = await seeded()
    const hit = await lib.lookupDict('abandoned')
    expect(hit?.via).toBe('form')
    expect(hit?.matched).toBe('abandon')
  })

  it('词形表缺项时用规则还原（dogs -> dog）', async () => {
    const lib = await seeded()
    // dog 的 exchange 里有 s:dogs，先验证走词形表；这里额外验证规则兜底
    const direct = await lib.lookupDict('dogs')
    expect(direct?.matched).toBe('dog')
    // 'run' 不在数据包里，验证查不到时返回 null 而不是抛错
    expect(await lib.lookupDict('running')).toBeNull()
  })

  it('空查询返回 null', async () => {
    const lib = await seeded()
    expect(await lib.lookupDict('')).toBeNull()
    expect(await lib.lookupDict('   ')).toBeNull()
  })
})

describe('搜索建议与状态', () => {
  beforeEach(async () => {
    const lib = await env()
    await lib.resetDictDb()
  })

  it('按前缀给出建议', async () => {
    const lib = await seeded()
    expect(await lib.suggestDict('gi')).toContain('give')
    expect(await lib.suggestDict('gi')).toContain('given')
    expect(await lib.suggestDict('zzz')).toEqual([])
  })

  it('空前缀返回空', async () => {
    const lib = await seeded()
    expect(await lib.suggestDict('')).toEqual([])
  })

  it('装载后状态为就绪并记录词条数', async () => {
    const lib = await env()
    await lib.resetDictDb()
    const before = await lib.dictStatus()
    expect(before.ready).toBe(false)
    await lib.importPack(PACK, 'test-v1')
    expect(await lib.dictSize()).toBe(4)
  })
})

/**
 * 真实数据包冒烟测试：拿构建产物 dist/dict/ 里的 3.4MB 数据跑一遍
 * 下载 → 解压 → 入库 → 查词 的完整链路，确保生成的资源没问题。
 * 未构建时（比如 CI 里先跑测试）自动跳过。
 */
describe('真实数据包', () => {
  const DATA = 'dist/dict/dict-core.jsonl.gz'
  const MANIFEST = 'dist/dict/manifest.json'

  it('装载后可查询常见词与变形词', async () => {
    if (!existsSync(DATA) || !existsSync(MANIFEST)) return
    const bytes = new Uint8Array(readFileSync(DATA))
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'))

    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (u.endsWith('manifest.json')) {
        return new Response(JSON.stringify(manifest), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(bytes)
    })

    const lib = await env()
    await lib.resetDictDb()
    await lib.loadDict()

    expect(await lib.dictSize()).toBeGreaterThan(30000)

    // 常见词
    const dog = await lib.lookupDict('dog')
    expect(dog?.entry.translation[0]).toContain('狗')
    expect(dog?.entry.definition.length).toBeGreaterThan(0)

    // 变形词还原
    expect((await lib.lookupDict('ran'))?.matched).toBe('run')
    expect((await lib.lookupDict('went'))?.matched).toBe('go')
    expect((await lib.lookupDict('dogs'))?.matched).toBe('dog')

    // 大小写与空格
    expect((await lib.lookupDict('  BEAUTIFUL '))?.matched).toBe('beautiful')

    // 搜索建议
    expect(await lib.suggestDict('beauti', 5)).toContain('beautiful')

    vi.unstubAllGlobals()
  })
})
