// 多用户管理：用户列表存在 localStorage，每个用户对应独立 IndexedDB
import { describe, it, expect } from 'vitest'
import { fresh } from '../test/helpers'

async function usersLib() {
  return fresh(() => import('./users'))
}

describe('getUsers', () => {
  it('首次使用时自动创建默认用户 def', async () => {
    const { getUsers } = await usersLib()
    const list = getUsers()

    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('def')
    expect(list[0].id).toBe('def')
  })

  it('localStorage 里是损坏的 JSON 时回退到默认用户', async () => {
    localStorage.setItem('wordmemo_users', '{ 这不是 JSON')
    const { getUsers } = await usersLib()

    expect(getUsers()).toHaveLength(1)
    expect(getUsers()[0].id).toBe('def')
  })

  it('localStorage 里是合法 JSON 但不是数组时回退到默认用户', async () => {
    localStorage.setItem('wordmemo_users', '{"a":1}')
    const { getUsers } = await usersLib()

    expect(getUsers()).toHaveLength(1)
  })
})

describe('getCurrentUser', () => {
  it('没有选择过用户时落在 def', async () => {
    const { getCurrentUser } = await usersLib()
    expect(getCurrentUser().id).toBe('def')
  })

  it('记住上次选择的用户', async () => {
    const { createUser } = await usersLib()
    const u = createUser('小明')

    // 模拟重新打开页面
    const next = await usersLib()
    expect(next.getCurrentUser().id).toBe(u.id)
  })

  it('记录的用户已被删除时回退到 def', async () => {
    localStorage.setItem('wordmemo_current', 'some-gone-id')
    const { getCurrentUser } = await usersLib()

    expect(getCurrentUser().id).toBe('def')
  })
})

describe('createUser', () => {
  it('新建用户后自动切换到该用户', async () => {
    const { createUser, getUsers, getCurrentUser } = await usersLib()
    const u = createUser('小明')

    expect(getUsers()).toHaveLength(2)
    expect(getCurrentUser().id).toBe(u.id)
    expect(u.name).toBe('小明')
  })

  it('新建的用户 id 互不相同', async () => {
    const { createUser } = await usersLib()
    const a = createUser('a')
    const b = createUser('b')

    expect(a.id).not.toBe(b.id)
  })
})

describe('deleteUser', () => {
  it('默认用户 def 不可删除', async () => {
    const { deleteUser, getUsers, DEF_ID } = await usersLib()

    expect(deleteUser(DEF_ID)).toBe(false)
    expect(getUsers()).toHaveLength(1)
  })

  it('删除其他用户后数据被移除', async () => {
    const { createUser, deleteUser, getUsers } = await usersLib()
    const u = createUser('小明')

    expect(deleteUser(u.id)).toBe(true)
    expect(getUsers().map((x) => x.id)).toEqual(['def'])
  })

  it('删除当前用户后自动切回 def', async () => {
    const { createUser, deleteUser, getCurrentUser } = await usersLib()
    const u = createUser('小明')
    deleteUser(u.id)

    expect(getCurrentUser().id).toBe('def')
  })

  it('删除不存在的用户返回 false', async () => {
    const { deleteUser } = await usersLib()
    expect(deleteUser('never-existed')).toBe(false)
  })
})
