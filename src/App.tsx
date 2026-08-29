import { useCallback, useEffect, useState } from 'react'
import Home from './views/Home'
import Review from './views/Review'
import Manage from './views/Manage'
import { db, getMeta, setMeta, migrateLegacyWords, migrateWordIds, wordId } from './lib/db'
import { deckStats, type DeckStat } from './lib/study'
import { starterDeck } from './data/starterDeck'
import { loadVoices } from './lib/speech'
import { getCurrentUser, getUsers, setCurrentUser, createUser, deleteUser, DEF_ID, type User } from './lib/users'
import { Dialog, uiPrompt, uiConfirm, uiAlert } from './components/Dialog'

type View = 'home' | 'review' | 'manage'
type Mode = 'normal' | 'practice'

export default function App() {
  const [view, setView] = useState<View>('home')
  const [ready, setReady] = useState(false)
  const [decks, setDecks] = useState<DeckStat[]>([])
  const [streak, setStreak] = useState(0)
  const [activeDeckId, setActiveDeckId] = useState('')
  const [sessionKey, setSessionKey] = useState(0)
  const [mode, setMode] = useState<Mode>('normal')
  const [me] = useState<User>(() => getCurrentUser())
  const [users] = useState<User[]>(() => getUsers())

  useEffect(() => {
    loadVoices()
  }, [])

  const refresh = useCallback(async () => {
    const [ds, s] = await Promise.all([
      deckStats(),
      getMeta('streak', { last: '', streak: 0 }),
    ])
    setDecks(ds)
    setStreak(s.streak)
    return ds
  }, [])

  useEffect(() => {
    ;(async () => {
      const d = await db()
      await migrateLegacyWords()
      await migrateWordIds()
      // 首次启动：导入内置词库（幂等）
      if ((await d.count('words')) === 0) {
        const tx = d.transaction('words', 'readwrite')
        await Promise.all(
          starterDeck.map((w) =>
            tx.store.put({ ...w, id: wordId('starter', w.word), deckId: 'starter' }),
          ),
        )
        await tx.done
      }
      const active = await getMeta('activeDeck', '')
      setActiveDeckId(active || 'starter')
      await refresh()
      setReady(true)
    })()
  }, [refresh])

  async function selectDeck(id: string) {
    setActiveDeckId(id)
    await setMeta('activeDeck', id)
  }

  async function handleManageChanged() {
    const ds = await refresh()
    // 当前词库被删则切到第一个
    if (ds.length > 0 && !ds.some((x) => x.deck.id === activeDeckId)) {
      await selectDeck(ds[0].deck.id)
    }
  }

  /* ---------- 用户操作 ---------- */

  function switchUser(id: string) {
    if (id === me.id) return
    setCurrentUser(id)
    location.reload() // 切换数据库连接，整页重载最稳妥
  }

  async function handleCreateUser() {
    const name = (await uiPrompt('新用户的名字：'))?.trim()
    if (!name) return
    if (!(await uiConfirm(`确认创建用户「${name}」？TA 将拥有全新的独立学习进度。`))) return
    createUser(name)
    location.reload()
  }

  async function handleDeleteUser() {
    if (me.id === DEF_ID) {
      await uiAlert('默认用户 def 不能删除')
      return
    }
    if (!(await uiConfirm(`确定删除当前用户「${me.name}」吗？TA 的全部词库和学习进度都会被删除。`, { danger: true })))
      return
    if (!(await uiConfirm(`再次确认：删除「${me.name}」后数据无法恢复，真的删除吗？`, { danger: true, confirmText: '仍然删除' })))
      return
    if (deleteUser(me.id)) {
      location.reload()
    }
  }

  if (!ready) {
    return <div className="loading">正在加载…</div>
  }

  return (
    <div className="app">
      {view === 'home' && (
        <Home
          decks={decks}
          activeDeckId={activeDeckId}
          streak={streak}
          me={me}
          users={users}
          onSelectDeck={selectDeck}
          onStart={() => {
            setMode('normal')
            setSessionKey((k) => k + 1)
            setView('review')
          }}
          onPractice={() => {
            setMode('practice')
            setSessionKey((k) => k + 1)
            setView('review')
          }}
          onManage={() => setView('manage')}
          onSwitchUser={switchUser}
          onCreateUser={handleCreateUser}
          onDeleteUser={handleDeleteUser}
        />
      )}
      {view === 'review' && (
        <Review
          key={sessionKey}
          deckId={activeDeckId}
          practice={mode === 'practice'}
          onExit={async () => {
            await refresh()
            setView('home')
          }}
        />
      )}
      {view === 'manage' && (
        <Manage
          onBack={async () => {
            await refresh()
            setView('home')
          }}
          onChanged={handleManageChanged}
        />
      )}
      <Dialog />
    </div>
  )
}
