import { useEffect, useRef, useState } from 'react'
import { db, type Word } from '../lib/db'
import { scheduler, Rating, createEmptyCard } from '../lib/fsrs'
import { buildQueue, touchStreak, shuffle, type QueueItem } from '../lib/study'
import { speak } from '../lib/speech'
import type { Card } from 'ts-fsrs'

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
  const [options, setOptions] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [wrongLast, setWrongLast] = useState(false)
  const [result, setResult] = useState({ total: 0, right: 0 })
  const [practice, setPractice] = useState(initialPractice)
  const [allWords, setAllWords] = useState<Word[]>([])
  const startRef = useRef(Date.now())

  useEffect(() => {
    ;(async () => {
      const d = await db()
      setAllWords(await d.getAll('words'))
      setQueue(await buildQueue(deckId, initialPractice))
    })()
  }, [deckId, initialPractice])

  const item = queue?.[idx]
  const finished = queue !== null && idx >= queue.length

  // 生成四选一选项：优先用同词库的词做干扰项
  useEffect(() => {
    if (!item || !queue) return
    const inDeck = allWords.filter((w) => w.deckId === item.word.deckId).map((w) => w.translation)
    const global = allWords.map((w) => w.translation)
    const others = [...inDeck, ...global].filter((t) => t !== item.word.translation)
    const distractors = shuffle([...new Set(others)]).slice(0, 3)
    setOptions(shuffle([item.word.translation, ...distractors]))
    setPicked(null)
    startRef.current = Date.now()
  }, [idx, item, queue, allWords])

  async function answer(opt: string) {
    if (picked || !item) return
    const correct = opt === item.word.translation
    const seconds = (Date.now() - startRef.current) / 1000
    // 客观判定 → FSRS 评级：错=重来，慢=困难，正常=良好
    const rating = !correct ? Rating.Again : seconds > 8 ? Rating.Hard : Rating.Good

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
    await d.add('logs', { wordId: item.word.id, rating, correct, ts: Date.now() })
    await touchStreak()

    setPicked(opt)
    setWrongLast(!correct)
    setResult((r) => ({ total: r.total + 1, right: r.right + (correct ? 1 : 0) }))
    speak(item.word.word)
  }

  function next() {
    // 答错的词追加到队尾再练一次
    if (wrongLast && item) setQueue((q) => (q ? [...q, item] : q))
    setIdx((i) => i + 1)
  }

  // 循环练习：整个词库乱序再过一遍（仍记录 FSRS 评级，不占新词额度）
  async function startPractice() {
    setQueue(await buildQueue(deckId, true))
    setPractice(true)
    setIdx(0)
    setResult({ total: 0, right: 0 })
  }

  // 键盘 1-4 选答案，回车下一张（电脑上用）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (picked && (e.key === 'Enter' || e.key === ' ')) {
        next()
        return
      }
      const n = parseInt(e.key)
      if (n >= 1 && n <= 4 && options[n - 1]) answer(options[n - 1])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (queue === null) return <div className="loading">准备中…</div>

  if (finished) {
    const acc = result.total ? Math.round((result.right / result.total) * 100) : 0
    return (
      <div className="screen">
        <div className="summary">
          <h2>🎉 太棒了！</h2>
          <p>
            完成本轮 {result.total} 张 · 正确率 {acc}%
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

  if (!item || options.length === 0) return <div className="loading">…</div>

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

      <div className="word-card">
        <div className="word" onClick={() => speak(item.word.word)}>
          {item.word.word}
        </div>
        <button className="btn-speak" onClick={() => speak(item.word.word)} aria-label="播放发音">
          🔊
        </button>
        {item.word.phonetic && <div className="phonetic">{item.word.phonetic}</div>}
      </div>

      <div className="options">
        {options.map((opt, i) => {
          const isRight = opt === item.word.translation
          const isPicked = picked === opt
          let cls = 'option'
          if (picked) {
            if (isRight) cls += ' correct'
            else if (isPicked) cls += ' wrong'
            else cls += ' dim'
          }
          return (
            <button key={opt} className={cls} onClick={() => answer(opt)} disabled={!!picked}>
              <span className="option-num">{i + 1}</span>
              {opt}
            </button>
          )
        })}
      </div>

      {picked && (
        <button className="btn-primary btn-big" onClick={next}>
          {wrongLast ? '学会了，下一张' : '下一张'}
        </button>
      )}
    </div>
  )
}
