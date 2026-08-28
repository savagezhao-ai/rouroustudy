// 生成测试用 .apkg（与 Anki 导出结构一致：zip 内含 collection.anki2 SQLite + media）
import initSqlJs from 'sql.js'
import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const wasmBinary = require('fs').readFileSync('node_modules/sql.js/dist/sql-wasm.wasm')
const SQL = await initSqlJs({ wasmBinary })

const db = new SQL.Database()
// 模拟 Anki collection 结构（只建我们读取的部分）
db.run(`CREATE TABLE col (models TEXT);
CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);
INSERT INTO col VALUES ('{"1001":{"name":"小学英语词汇","flds":[{"name":"单词"},{"name":"音标"},{"name":"释义"}]},"1002":{"name":"Front-Back 卡组","flds":[{"name":"Front"},{"name":"Back"}]}}');`)

const words = [
  ['apple', '/ˈæpl/', 'n. 苹果'],
  ['banana', '/bəˈnɑːnə/', 'n. 香蕉'],
  ['cat', '/kæt/', 'n. 猫'],
  ['dog', '/dɒɡ/', 'n. 狗'],
  ['elephant', '/ˈelɪfənt/', 'n. 大象'],
  ['flower', '/ˈflaʊə/', 'n. 花'],
  ['garden', '/ˈɡɑːdn/', 'n. 花园'],
  ['house', '/haʊs/', 'n. 房子'],
]
let i = 1
for (const [w, p, t] of words) {
  db.run('INSERT INTO notes VALUES (?, 1001, ?)', [i++, [w, p, t].join('\x1f')])
}
// Front/Back 模板 + HTML 标签，测试启发式解析
db.run('INSERT INTO notes VALUES (?, 1002, ?)', [
  i++,
  ['<b>water</b>', 'n. 水<br>'].join('\x1f'),
])
db.run('INSERT INTO notes VALUES (?, 1002, ?)', [
  i++,
  ['tree', '[sound:tree.mp3] n. 树'].join('\x1f'),
])

const data = db.export()
const zip = zipSync({
  'collection.anki2': data,
  media: strToU8('{}'),
})
writeFileSync('public/test.apkg', zip)
console.log(`已生成 public/test.apkg（${zip.length} 字节，10 个单词）`)
