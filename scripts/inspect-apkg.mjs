// 检查真实 apkg 的内部结构：表结构、模板字段名、前几条笔记内容
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'

const wasmBinary = readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')
const SQL = await initSqlJs({ wasmBinary })

const buf = readFileSync('primary-school.apkg')
const zip = unzipSync(buf)
const nonNumeric = Object.keys(zip).filter((k) => !/^\d+$/.test(k))
console.log('zip 内非数字文件:', nonNumeric)
for (const k of nonNumeric) {
  const head = Buffer.from(zip[k].slice(0, 16))
  console.log(`  ${k}: ${zip[k].length} 字节, 头部:`, head.toString('hex'))
}

const dbFile = zip['collection.anki2'] ?? zip['collection.anki21']
console.log('数据库文件:', dbFile ? `${dbFile.length} 字节` : '无')

const db = new SQL.Database(dbFile)
console.log('\n=== 表结构 ===')
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
console.log(tables[0].values.flat())

console.log('\n=== col.models（前 500 字）===')
try {
  const colRes = db.exec('SELECT models FROM col LIMIT 1')
  const models = JSON.parse(String(colRes[0].values[0][0]))
  for (const [mid, m] of Object.entries(models)) {
    console.log(`模板 ${mid}: ${m.name}, 字段:`, m.flds.map((f) => f.name))
  }
} catch (e) {
  console.log('解析 models 失败:', e.message)
}

console.log('\n=== notes 前三条原始 flds（\\x1f 分隔）===')
const notes = db.exec('SELECT mid, flds FROM notes LIMIT 3')
for (const row of notes[0].values) {
  console.log('mid:', row[0])
  const fields = String(row[1]).split('\x1f')
  fields.forEach((f, i) => console.log(`  字段${i}: ${JSON.stringify(f.slice(0, 120))}`))
}

console.log('\n=== notes 总数 ===')
const cnt = db.exec('SELECT COUNT(*) FROM notes')
console.log(cnt[0].values[0][0])
db.close()
