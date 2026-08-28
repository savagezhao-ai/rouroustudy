// 用 anki21 验证字段解析：模拟前端的 guessFieldIndexes + clean 逻辑
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'

const wasmBinary = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')
const SQL = await initSqlJs({ wasmBinary })

const buf = readFileSync('primary-school.apkg')
const zip = unzipSync(buf)
const db = new SQL.Database(zip['collection.anki21'])

console.log('=== 模板 ===')
const colRes = db.exec('SELECT models FROM col LIMIT 1')
const models = JSON.parse(String(colRes[0].values[0][0]))
for (const [mid, m] of Object.entries(models)) {
  console.log(`模板 ${mid}: ${m.name}, 字段:`, m.flds.map((f) => f.name))
}

console.log('\n=== 各模板笔记数量 ===')
const cntRes = db.exec('SELECT mid, COUNT(*) FROM notes GROUP BY mid')
for (const [mid, n] of cntRes[0].values) {
  console.log(`  ${mid}: ${n} 条 (${models[String(mid)]?.name})`)
}

console.log('\n=== 每种模板的前 2 条笔记原文 ===')
for (const [mid] of cntRes[0].values) {
  const res = db.exec(`SELECT flds FROM notes WHERE mid=${mid} LIMIT 2`)
  console.log(`\n--- 模板 ${mid} (${models[String(mid)]?.name}) ---`)
  for (const row of res[0].values) {
    const fields = String(row[0]).split('\x1f')
    fields.forEach((f, i) => {
      const v = f.replace(/\n/g, '\\n').slice(0, 100)
      console.log(`  字段${i}: ${JSON.stringify(v)}`)
    })
    console.log('  ---')
  }
}

console.log('\n=== cards 表结构（卡组名在 deck 列）===')
try {
  const deckRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='deck'")
  console.log('deck 表存在')
} catch {}
const cardsInfo = db.exec('SELECT did, COUNT(*) FROM cards GROUP BY did')
console.log('卡组分布:', cardsInfo[0]?.values)

db.close()
