// 用户管理：localStorage 存用户列表，每个用户对应独立的 IndexedDB（学习进度天然隔离）
export interface User {
  id: string
  name: string
  createdAt: number
}

const USERS_KEY = 'wordmemo_users'
const CUR_KEY = 'wordmemo_current'
export const DEF_ID = 'def'

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function getUsers(): User[] {
  try {
    const list = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]') as User[]
    if (Array.isArray(list) && list.length > 0) return list
  } catch {
    /* 忽略损坏数据 */
  }
  // 初始化默认用户 def
  const def: User = { id: DEF_ID, name: 'def', createdAt: Date.now() }
  localStorage.setItem(USERS_KEY, JSON.stringify([def]))
  return [def]
}

export function getCurrentUser(): User {
  const users = getUsers()
  const cur = localStorage.getItem(CUR_KEY)
  const hit = users.find((u) => u.id === cur)
  if (hit) return hit
  // 默认落在 def
  const def = users.find((u) => u.id === DEF_ID) ?? users[0]
  localStorage.setItem(CUR_KEY, def.id)
  return def
}

export function setCurrentUser(id: string) {
  localStorage.setItem(CUR_KEY, id)
}

/** 新建用户并切换（不删除任何人） */
export function createUser(name: string): User {
  const users = getUsers()
  const user: User = { id: uid(), name, createdAt: Date.now() }
  users.push(user)
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
  localStorage.setItem(CUR_KEY, user.id)
  return user
}

/** 删除用户：移出列表并删除其 IndexedDB 数据。def 永不允许删除 */
export function deleteUser(id: string): boolean {
  if (id === DEF_ID) return false
  const users = getUsers()
  const rest = users.filter((u) => u.id !== id)
  if (rest.length === users.length) return false
  localStorage.setItem(USERS_KEY, JSON.stringify(rest))
  // 删除该用户的全部学习数据
  indexedDB.deleteDatabase(`wordmemo_u_${id}`)
  // 若删的是当前用户，切回 def
  if (localStorage.getItem(CUR_KEY) === id) {
    localStorage.setItem(CUR_KEY, DEF_ID)
  }
  return true
}
