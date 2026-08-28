import type { DeckStat } from '../lib/study'
import type { User } from '../lib/users'
import { DEF_ID } from '../lib/users'

export default function Home({
  decks,
  activeDeckId,
  streak,
  me,
  users,
  onSelectDeck,
  onStart,
  onPractice,
  onManage,
  onSwitchUser,
  onCreateUser,
  onDeleteUser,
}: {
  decks: DeckStat[]
  activeDeckId: string
  streak: number
  me: User
  users: User[]
  onSelectDeck: (id: string) => void
  onStart: () => void
  onPractice: () => void
  onManage: () => void
  onSwitchUser: (id: string) => void
  onCreateUser: () => void
  onDeleteUser: () => void
}) {
  const active = decks.find((d) => d.deck.id === activeDeckId)
  const nothing = !active || (active.due === 0 && active.newLeft === 0 && active.total > 0)

  return (
    <div className="screen">
      <div className="user-bar">
        <button className="user-add" onClick={onCreateUser} title="新建账号">
          ＋新建账号
        </button>
        <div className="user-chips">
          {users.map((u) => (
            <button
              key={u.id}
              className={`user-chip${u.id === me.id ? ' current' : ''}`}
              onClick={() => onSwitchUser(u.id)}
              title={u.id === me.id ? '当前用户' : `点击切换到 ${u.name}`}
            >
              {u.name}
            </button>
          ))}
        </div>
        <button
          className={`user-del${me.id === DEF_ID ? ' disabled' : ''}`}
          onClick={onDeleteUser}
          title={me.id === DEF_ID ? '默认用户 def 不能删除' : '删除当前账户'}
        >
          删除账户
        </button>
      </div>

      <header className="home-header">
        <h1>记词星</h1>
        <p className="streak">
          🔥 连续学习 {streak} 天 · 当前用户：{me.name}
        </p>
      </header>

      <div className="section-label">选择词库（点击切换）</div>
      <div className="deck-list">
        {decks.length === 0 && (
          <p className="hint">还没有词库，去词库管理新建一个吧</p>
        )}
        {decks.map((d) => (
          <div
            key={d.deck.id}
            className={`deck-row${d.deck.id === activeDeckId ? ' active' : ''}`}
            onClick={() => onSelectDeck(d.deck.id)}
          >
            <div className="deck-info">
              <div className="deck-name">{d.deck.name}</div>
              <div className="deck-meta">
                待复习 {d.due} · 新词 {d.newLeft} · 已学 {d.learned}/{d.total}
              </div>
            </div>
            {d.deck.id === activeDeckId && <span className="check">✓</span>}
          </div>
        ))}
      </div>

      {active && active.total === 0 ? (
        <div className="done-banner">这个词库还是空的，去词库管理里添加单词</div>
      ) : nothing ? (
        <>
          <div className="done-banner">🎉 今天任务全部完成，明天再来！</div>
          <button className="btn-ghost" onClick={onPractice}>
            🔁 循环练习 · 再学一轮
          </button>
        </>
      ) : (
        <>
          <button className="btn-primary btn-big" onClick={onStart}>
            开始复习{active ? ` · ${active.deck.name}` : ''}
          </button>
          <button className="btn-ghost" onClick={onPractice}>
            🔁 循环练习（整库乱序，不限次数）
          </button>
        </>
      )}

      <button className="btn-ghost" onClick={onManage}>
        词库管理
      </button>
      <p className="hint">数据保存在本机浏览器，无需联网</p>
    </div>
  )
}
