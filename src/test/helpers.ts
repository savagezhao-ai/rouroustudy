import { vi } from 'vitest'

/**
 * 重新加载模块，拿到干净的实例。
 *
 * db.ts 用模块级 Map 缓存「用户 → 数据库连接」，用例之间必须重置，
 * 否则上一个用例写入的数据会漏到下一个用例里。
 */
export async function fresh<T>(load: () => Promise<T>): Promise<T> {
  vi.resetModules()
  return load()
}
