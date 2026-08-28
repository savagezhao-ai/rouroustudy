import { useEffect, useState } from 'react'
import {
  db,
  getMeta,
  setMeta,
  newId,
  wordId,
  type Deck,
  type Word,
} from '../lib/db'
import { englishVoices, DEFAULT_SPEECH, speak, type SpeechSettings } from '../lib/speech'
import { importApkg } from '../lib/apkg'

export default function Manage({
  onBack,
  onChanged,
}: {
  onBack: () => void
  onChanged: () => void
}) {
  const [level, setLevel] = useState<'decks' | 'words'>('decks')
  const [decks, setDecks] = useState<Deck[]>([])
  const [current, setCurrent] = useState<Deck | null>(null)
  const [words, setWords] = useState<Word[]>([])
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<Word | null>(null)
  const [adding, setAdding] = useState({ word: '', phonetic: '', translation: '' })
  const [importing, setImporting] = useState(false)

  async function loadDecks() {
    const d = await db()
    setDecks(await d.getAll('decks'))
  }

  async function loadWords(deck: Deck) {
    const d = await db()
    const all = await d.getAll('words')
    setWords(all.filter((w) => w.deckId === deck.id))
  }

  useEffect(() => {
    loadDecks()
  }, [])

  /* ---------- 词库操作 ---------- */

  async function createDeck() {
    const name = prompt('新词库名称：')?.trim()
    if (!name) return
    const d = await db()
    const deck: Deck = { id: newId(), name, createdAt: Date.now() }
    await d.put('decks', deck)
    await loadDecks()
    onChanged()
    setMsg(`已创建词库「${name}」`)
  }

  async function renameDeck(deck: Deck) {
    const name = prompt('重命名词库：', deck.name)?.trim()
    if (!name) return
    const d = await db()
    await d.put('decks', { ...deck, name })
    await loadDecks()
    onChanged()
  }

  async function deleteDeck(deck: Deck) {
    if (!confirm(`确定删除词库「${deck.name}」吗？其中的单词和学习进度会一起删除。`)) return
    const d = await db()
    const all = await d.getAll('words')
    const mine = all.filter((w) => w.deckId === deck.id)
    for (const w of mine) {
      await d.delete('words', w.id)
      await d.delete('cards', w.id)
    }
    await d.delete('decks', deck.id)
    await loadDecks()
    onChanged()
    setMsg(`已删除词库「${deck.name}」`)
  }

  /* ---------- Anki .apkg 导入：自动新建词库 ---------- */

  async function importApkgFile(file: File) {
    setImporting(true)
    setMsg(`正在解析 ${file.name} …`)
    try {
      const result = await importApkg(file)
      if (result.words.length === 0) {
        setMsg('❌ 这个卡组里没有解析出有效的单词（可能字段结构特殊）')
        return
      }
      const d = await db()
      // 重名词库自动加序号
      const existing = await d.getAll('decks')
      let name = result.deckName
      let n = 2
      while (existing.some((x) => x.name === name)) {
        name = `${result.deckName} (${n++})`
      }
      const deck: Deck = { id: newId(), name, createdAt: Date.now() }
      await d.put('decks', deck)
      const tx = d.transaction('words', 'readwrite')
      await Promise.all(
        result.words.map((w) =>
          tx.store.put({
            id: wordId(deck.id, w.word),
            word: w.word,
            phonetic: w.phonetic,
            translation: w.translation,
            deckId: deck.id,
          }),
        ),
      )
      await tx.done
      await loadDecks()
      onChanged()
      setMsg(`✅ 已导入「${name}」：${result.words.length} 个单词`)
    } catch (err) {
      setMsg(`❌ 导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
    }
  }

  /* ---------- 单词操作 ---------- */

  async function addWord() {
    if (!current) return
    const word = adding.word.trim().toLowerCase()
    const translation = adding.translation.trim()
    if (!word || !translation) {
      setMsg('单词和释义不能为空')
      return
    }
    const d = await db()
    await d.put('words', {
      id: wordId(current.id, word),
      word,
      phonetic: adding.phonetic.trim(),
      translation,
      deckId: current.id,
    })
    setAdding({ word: '', phonetic: '', translation: '' })
    await loadWords(current)
    onChanged()
    setMsg(`已添加 ${word}`)
  }

  async function saveEdit() {
    if (!current || !editing) return
    const d = await db()
    const newWord = editing.word.trim().toLowerCase()
    const newWid = wordId(current.id, newWord)
    // 单词本身改了，id 跟着变，学习卡片也要迁移
    if (editing.id !== newWid) {
      const card = await d.get('cards', editing.id)
      if (card) {
        await d.put('cards', { ...card, id: newWid })
        await d.delete('cards', editing.id)
      }
      await d.delete('words', editing.id)
    }
    await d.put('words', { ...editing, id: newWid, word: newWord })
    setEditing(null)
    await loadWords(current)
    onChanged()
    setMsg(`已保存 ${newWord}`)
  }

  async function deleteWord(w: Word) {
    if (!current || !confirm(`删除单词 ${w.word}？`)) return
    const d = await db()
    await d.delete('words', w.id)
    await d.delete('cards', w.id)
    await loadWords(current)
    onChanged()
  }

  async function importFile(file: File) {
    if (!current) return
    try {
      const data = JSON.parse(await file.text())
      const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : []
      if (list.length === 0) {
        setMsg('❌ 格式不对：需要 JSON 数组，每项含 word 和 translation 字段')
        return
      }
      const d = await db()
      let ok = 0
      const tx = d.transaction('words', 'readwrite')
      for (const it of list) {
        const o = it as Record<string, unknown>
        const word = String(o.word ?? o.headWord ?? '').trim().toLowerCase()
        const translation = String(o.translation ?? o.trans ?? '').trim()
        if (!word || !translation) continue
        const phonetic = String(o.phonetic ?? o.usphone ?? o.ukphone ?? '').trim()
        await tx.store.put({ id: wordId(current.id, word), word, phonetic, translation, deckId: current.id })
        ok++
      }
      await tx.done
      await loadWords(current)
      onChanged()
      setMsg(`✅ 成功导入 ${ok} 个单词到「${current.name}」`)
    } catch {
      setMsg('❌ 文件解析失败，请确认是合法 JSON')
    }
  }

  const filtered = words.filter(
    (w) =>
      !search ||
      w.word.toLowerCase().includes(search.toLowerCase()) ||
      w.translation.includes(search),
  )

  return (
    <div className="screen">
      {level === 'decks' ? (
        <>
          <header className="review-header">
            <button className="btn-link" onClick={onBack}>
              ← 返回
            </button>
            <span>词库管理</span>
          </header>

          <button className="btn-primary" onClick={createDeck} disabled={importing}>
            ＋ 新建词库
          </button>

          <label className="btn-primary file-btn" style={{ textAlign: 'center' }}>
            {importing ? '导入中，请稍候…' : '📥 导入 Anki 词库（.apkg）'}
            <input
              type="file"
              accept=".apkg,.colpkg,application/octet-stream"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importApkgFile(f)
                e.target.value = ''
              }}
            />
          </label>

          <div className="deck-list">
            {decks.map((deck) => (
              <div key={deck.id} className="deck-row manage">
                <div className="deck-info">
                  <div className="deck-name">{deck.name}</div>
                </div>
                <button
                  className="icon-btn"
                  onClick={async () => {
                    setCurrent(deck)
                    setSearch('')
                    await loadWords(deck)
                    setLevel('words')
                  }}
                >
                  管理
                </button>
                <button className="icon-btn" onClick={() => renameDeck(deck)}>
                  重命名
                </button>
                <button className="icon-btn danger" onClick={() => deleteDeck(deck)}>
                  删除
                </button>
              </div>
            ))}
          </div>

          <SpeechSettingsCard />

          {msg && <p className="msg">{msg}</p>}
        </>
      ) : (
        current && (
          <>
            <header className="review-header">
              <button
                className="btn-link"
                onClick={() => {
                  setLevel('decks')
                  setMsg('')
                }}
              >
                ← 词库
              </button>
              <span>{current.name}（{words.length} 词）</span>
            </header>

            <div className="manage-card">
              <h3>添加单词</h3>
              <input
                className="input"
                placeholder="单词，如 cat"
                value={adding.word}
                onChange={(e) => setAdding({ ...adding, word: e.target.value })}
              />
              <input
                className="input"
                placeholder="音标（可选），如 /kæt/"
                value={adding.phonetic}
                onChange={(e) => setAdding({ ...adding, phonetic: e.target.value })}
              />
              <input
                className="input"
                placeholder="释义，如 n. 猫"
                value={adding.translation}
                onChange={(e) => setAdding({ ...adding, translation: e.target.value })}
              />
              <button className="btn-primary" onClick={addWord}>
                保存
              </button>
            </div>

            <label className="btn-ghost file-btn" style={{ textAlign: 'center', display: 'block' }}>
              导入 JSON 词表
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importFile(f)
                }}
              />
            </label>

            <input
              className="input"
              placeholder="🔍 搜索单词或释义…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="word-list">
              {filtered.map((w) => (
                <div key={w.id} className="word-row">
                  {editing?.id === w.id ? (
                    <div className="word-edit">
                      <input
                        className="input"
                        value={editing.word}
                        onChange={(e) => setEditing({ ...editing, word: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="音标"
                        value={editing.phonetic}
                        onChange={(e) => setEditing({ ...editing, phonetic: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="释义"
                        value={editing.translation}
                        onChange={(e) => setEditing({ ...editing, translation: e.target.value })}
                      />
                      <div className="row-actions">
                        <button className="btn-primary" onClick={saveEdit}>
                          保存
                        </button>
                        <button className="btn-ghost" onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="word-main">
                        <div className="word-title">
                          {w.word}
                          {w.phonetic && <span className="word-ph">{w.phonetic}</span>}
                        </div>
                        <div className="word-sub">{w.translation}</div>
                      </div>
                      <button className="icon-btn" onClick={() => setEditing({ ...w })}>
                        编辑
                      </button>
                      <button className="icon-btn danger" onClick={() => deleteWord(w)}>
                        删除
                      </button>
                    </>
                  )}
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="hint">{words.length === 0 ? '这个词库还没有单词' : '没有匹配的结果'}</p>
              )}
            </div>

            {msg && <p className="msg">{msg}</p>}
          </>
        )
      )}
    </div>
  )
}

/* ---------- 发音设置 ---------- */

function SpeechSettingsCard() {
  const [settings, setSettings] = useState<SpeechSettings>(DEFAULT_SPEECH)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => setSettings(await getMeta<SpeechSettings>('speech', DEFAULT_SPEECH)))()
    // 音色列表异步加载，轮询刷新
    const t = setInterval(() => {
      const v = englishVoices()
      if (v.length > 0) {
        setVoices(v)
        clearInterval(t)
      }
    }, 400)
    return () => clearInterval(t)
  }, [])

  // 即改即存，保证"试听"用的就是当前选择的值
  async function update(patch: Partial<SpeechSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    await setMeta('speech', next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="manage-card">
      <h3>发音设置{saved && <span className="saved-tag">已自动保存 ✓</span>}</h3>
      <p className="hint">选好音色或调完语速立即生效，点"试听"验证</p>
      <select
        className="input"
        value={settings.voiceURI}
        onChange={(e) => update({ voiceURI: e.target.value })}
      >
        <option value="">自动（推荐）</option>
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name}（{v.lang}）
          </option>
        ))}
      </select>
      <div className="rate-row">
        <span className="hint">语速 {settings.rate.toFixed(2)}x</span>
        <input
          type="range"
          min="0.5"
          max="1.3"
          step="0.05"
          value={settings.rate}
          onChange={(e) => update({ rate: parseFloat(e.target.value) })}
          style={{ flex: 1 }}
        />
      </div>
      <div className="row-actions">
        <button className="btn-ghost" onClick={() => speak('apple')}>
          🔊 试听
        </button>
        <button
          className="btn-ghost"
          onClick={() => update({ voiceURI: '', rate: DEFAULT_SPEECH.rate })}
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}
