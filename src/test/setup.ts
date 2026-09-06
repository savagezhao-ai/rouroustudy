// 测试环境准备：补上 node 缺失的浏览器 API（IndexedDB / localStorage）
// auto 负责注册 IDBRequest / IDBKeyRange 等一整套全局类
import 'fake-indexeddb/auto'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { beforeEach } from 'vitest'

const store = new Map<string, string>()

/** node 环境没有 localStorage，而 users.ts 依赖它存用户列表 */
const memoryStorage: Storage = {
  get length() {
    return store.size
  },
  clear: () => store.clear(),
  getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
  key: (index) => [...store.keys()][index] ?? null,
  removeItem: (key) => {
    store.delete(key)
  },
  setItem: (key, value) => {
    store.set(key, String(value))
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: memoryStorage,
  writable: true,
  configurable: true,
})

/**
 * 每个用例开跑前换一套全新的 IndexedDB 实例并清空 localStorage。
 *
 * 不用 deleteDatabase 清库：连接还开着时会触发 blocked 而迟迟不返回，
 * 直接换实例既彻底又没有等待。
 */
beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new FakeIDBFactory(),
    writable: true,
    configurable: true,
  })
})
