import { useEffect, useState } from 'react'
import { db, type Word, type WordField } from '../lib/db'
import { scheduler, Rating, createEmptyCard } from '../lib/fsrs'
import { buildQueue, touchStreak, type QueueItem } from '../lib/study'
import { speak } from '../lib/speech'
import type { Card, Grade } from 'ts-fsrs'

/** 翻面后要跳过的字段：正面已显示的单词/音标、释义原文、以及统计类字段 */
function sectionFields(w: Word): WordField[] {
  if (!w.fields) return []
  const translationFlat = w.translation.replace(/\s+/g, ' ')
  return w.fields.filter((f) => {
    if (!f.value) return false
    const v = f.value.replace(/\s+/g, ' ')
    if (v === w.word || v === translationFlat) return false
    if (/^(单词|音标|phonetic|ipa|pronunciation)$/i.test(f.name)) return false
    // 统计/文件类字段对查词没意义
    if (/^(flags|图片|编号|ID|Lesson)$/i.test(f.name)) return false
    if (v === w.phonetic) return false
    return true
  })
}

/** 把 FSRS 到期时间转成人话：10分钟 / 3天 / 2月 */
function fmtInterval(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime()
  if (ms <= 0) return '现在'
  const min = ms / 60000
  if (min < 1) return '<1分'
  if (min < 60) return `${Math.round(min)}分`
  const h = min / 60
  if (h < 24) return `${Math.round(h)}时`
  const d = h / 24
  if (d < 31) return `${Math.round(d)}天`
  if (d < 365) return `${Math.round(d / 30)}月`
  return `${(d / 365).toFixed(1)}年`
}

const RATINGS: { key: Grade; label: string; cls: string }[] = [
  { key: Rating.Again, label: '忘记', cls: 'rate-again' },
  { key: Rating.Hard, label: '困难', cls: 'rate-hard' },
  { key: Rating.Good, label: '良好', cls: 'rate-good' },
  { key: Rating.Easy, label: '简单', cls: 'rate-easy' },
]

export default function Review({
  deckId,
  practice: initialPractice = false,
  onExit,
}: {
  deckId: string
  practice?: boolean
  onExit: () => void
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false) // 卡片是否已翻面
  const [result, setResult] = useState({ total: 0, again: 0 })
  const [practice, setPractice] = useState(initialPractice)
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      setQueue(await buildQueue(deckId, initialPractice))
    })()
  }, [deckId, initialPractice])

  const item = queue?.[idx]
  const finished = queue !== null && idx >= queue.length

  // 换卡时：复位翻面、自动读单词、计算四档的下次间隔预览
  useEffect(() => {
    if (!item) return
    setRevealed(false)
    speak(item.word.word)

    // 间隔预览（Anki 同款体验：按钮上直接看到"忘记=10分"这样的提示）
    ;(async () => {
      const d = await db()
      const existing = await d.get('cards', item.word.id)
      const card: Card = existing ? existing.card : createEmptyCard(new Date())
      const now2 = new Date()
      setPreviews(
        RATINGS.map((r) => fmtInterval(scheduler.repeat(card, now2)[r.key].card.due, now2)),
      )
    })()
  }, [idx, item])

  async function rate(rating: Grade) {
    if (!revealed || !item) return
    const d = await db()
    const existing = await d.get('cards', item.word.id)
    let card: Card
    if (existing) {
      card = existing.card
    } else {
      card = createEmptyCard(new Date())
    }
    const rec = scheduler.repeat(card, new Date())[rating]
    await d.put('cards', { id: item.word.id, card: rec.card })
    await d.add('logs', {
      wordId: item.word.id,
      rating,
      correct: rating !== Rating.Again,
      ts: Date.now(),
    })
    await touchStreak()

    setResult((r) => ({ total: r.total + 1, again: r.again + (rating === Rating.Again ? 1 : 0) }))
    // 忘记的词追加到队尾再练（Anki 行为）
    if (rating === Rating.Again) setQueue((q) => (q ? [...q, item] : q))
    setIdx((i) => i + 1)
  }

  // 循环练习：整个词库乱序再过一遍（仍记录 FSRS 评级，不占新词额度）
  async function startPractice() {
    setQueue(await buildQueue(deckId, true))
    setPractice(true)
    setIdx(0)
    setResult({ total: 0, again: 0 })
  }

  // 键盘：空格/回车翻面，1-4 自评（电脑上用）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!item) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (revealed) {
        const n = parseInt(e.key)
        if (n >= 1 && n <= 4) rate(RATINGS[n - 1].key)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (queue === null) return <div className="loading">准备中…</div>

  if (finished) {
    return (
      <div className="screen">
        <div className="summary">
          <h2>🎉 本轮完成</h2>
          <p>
            共复习 {result.total} 张 · 忘记 {result.again} 张
            {result.total > 0 &&
              ` · 掌握率 ${Math.round(((result.total - result.again) / result.total) * 100)}%`}
          </p>
          <button className="btn-primary btn-big" onClick={onExit}>
            回到首页
          </button>
          <button className="btn-ghost" onClick={startPractice}>
            🔁 整库循环练一轮
          </button>
        </div>
      </div>
    )
  }

  if (!item) return <div className="loading">…</div>

  const sections = revealed ? sectionFields(item.word) : []

  return (
    <div className="screen">
      <header className="review-header">
        <button className="btn-link" onClick={onExit}>
          退出
        </button>
        <span className="progress">
          {idx + 1} / {queue.length}
          {practice && <em className="badge-new">循环练习</em>}
          {!practice && item.isNew && <em className="badge-new">新词</em>}
        </span>
      </header>

      <div
        className="anki-card"
        onClick={() => {
          if (!revealed) setRevealed(true)
          else speak(item.word.word)
        }}
      >
        <div className="anki-front">
          <div className="word">{item.word.word}</div>
          {item.word.phonetic && <div className="phonetic">{item.word.phonetic}</div>}
          <button
            className="btn-speak"
            onClick={(e) => {
              e.stopPropagation()
              speak(item.word.word)
            }}
            aria-label="播放发音"
          >
            🔊
          </button>
        </div>

        {revealed && (
          <div className="anki-back">
            <div className="dict-sections">
              <div className="dict-section main">
                <h4>释义</h4>
                <pre>{item.word.translation}</pre>
              </div>
              {sections.map((f, i) => (
                <details key={i} className="dict-section" open={i < 5}>
                  <summary>{f.name}</summary>
                  <pre>{f.value}</pre>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>

      {!revealed ? (
        <button className="btn-primary btn-big" onClick={() => setRevealed(true)}>
          显示答案（点击卡片或按空格）
        </button>
      ) : (
        <div className="rating-row">
          {RATINGS.map((r, i) => (
            <button
              key={r.key}
              className={`rate-btn ${r.cls}`}
              onClick={() => rate(r.key)}
              disabled={previews.length === 0}
            >
              <span className="rate-label">{r.label}</span>
              {previews[i] && <span className="rate-due">{previews[i]}</span>}
            </button>
          ))}
        </div>
      )}

      <p className="hint">键盘：空格翻面 · 1忘记 2困难 3良好 4简单</p>
    </div>
  )
}
