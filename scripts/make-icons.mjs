// 生成 PWA 图标（紫底白色卡片图案），原型阶段够用，后续可替换成正式设计图
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function makePng(size, path) {
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const o = 1 + x * 4
      const cx = size / 2
      const cy = size / 2
      const r = size * 0.3
      const inCard = Math.abs(x - cx) < r && Math.abs(y - cy) < r * 0.72
      if (inCard) {
        row[o] = 255; row[o + 1] = 255; row[o + 2] = 255; row[o + 3] = 255
      } else {
        row[o] = 75; row[o + 1] = 63; row[o + 2] = 227; row[o + 3] = 255
      }
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
  console.log(`生成 ${path} (${size}x${size})`)
}

makePng(192, 'public/pwa-192.png')
makePng(512, 'public/pwa-512.png')

// 复制 sql.js 的 wasm（Anki apkg 解析依赖），保证离线可用
// 浏览器构建请求 sql-wasm-browser.wasm，Node 构建请求 sql-wasm.wasm，两个都带上
import { copyFileSync } from 'node:fs'
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'public/sql-wasm.wasm')
console.log('已复制 public/sql-wasm.wasm')
copyFileSync('node_modules/sql.js/dist/sql-wasm-browser.wasm', 'public/sql-wasm-browser.wasm')
console.log('已复制 public/sql-wasm-browser.wasm')
