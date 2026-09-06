// 词典面板：底部弹层形式，复习中途查词不会打断当前进度。
// 数据来自 ECDICT，首次使用需下载约 3.4MB，之后完全离线。
import { useEffect, useRef, useState } from 'react'
import {
  dictStatus,
  loadDict,
  lookupDict,
  suggestDict,
  type DictEntry,
  type DictHit,
  type DictStatus,
} from '../lib/dictionary'
import { speak } from '../lib/speech'

/** 考试/级别标签的中文名 */
const EXAM_LABELS: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
}

/** 词形变化类型 -> 中文说明 */
const FORM_LABELS: Record<string, string> = {
  0: '原形',
  1: '变形',
  p: '过去式',
  d: '过去分词',
  i: '现在分词',
  3: '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数',
}

/** 去掉释义前面的词性前缀（"vt. 放弃" -> 词性 vt / 释义 放弃），用于分行展示 */
function splitPos(line: string): { pos: string; text: string } {
  const m = /^([a-z]{1,5})\.\s*(.*)$/i.exec(line.trim())
  return m ? { pos: m[1], text: m[2] } : { pos: '', text: line.trim() }
}

function formatBytes(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.round(n / 1000)}KB`
}

export default function DictSheet({
  word = '',
  onClose,
}: {
  word?: string
  onClose: () => void
}) {
  const [status, setStatus] = useState<DictStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ phase: 'download', ratio: 0 })
  const [error, setError] = useState('')
  const [query, setQuery] = useState(word)
  const [hit, setHit] = useState<DictHit | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    dictStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // 传入单词且词典就绪时自动查词
  useEffect(() => {
    if (!status?.ready || !word) return
    void search(word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.ready, word])

  async function handleDownload() {
    setBusy(true)
    setError('')
    try {
      await loadDict((p) => setProgress(p))
      setStatus(await dictStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败，请检查网络后重试')
    } finally {
      setBusy(false)
    }
  }

  async function search(w: string) {
    const q = w.trim()
    if (!q) return
    setSearched(true)
    setSuggestions([])
    setQuery(q)
    const res = await lookupDict(q)
    setHit(res)
  }

  async function onInput(v: string) {
    setQuery(v)
    setSearched(false)
    if (!status?.ready) return
    setSuggestions(await suggestDict(v.trim(), 10))
  }

  const entry: DictEntry | null = hit?.entry ?? null
  const senses = entry
    ? entry.translation.map((t, i) => ({
        trans: splitPos(t),
        def: entry.definition[i] ? splitPos(entry.definition[i]) : null,
      }))
    : []

  return (
    <div className="dialog-mask dict-mask" onClick={onClose}>
      <div className="dict-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="dict-head">
          <h3>📖 词典</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        {status === null && <p className="hint">正在检查词典数据…</p>}

        {status && !status.ready && (
          <div className="dict-download">
            <p className="dict-dl-title">首次使用需要下载词典数据</p>
            <p className="hint">
              约 {formatBytes(status.bytes || 3.4e6)}，下载一次后离线可用。
              收录 3.8 万词条，含音标、中英双解释义、词形变化与考试级别标记。
            </p>
            {busy ? (
              <div className="dict-progress">
                <div className="dict-progress-bar">
                  <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                </div>
                <span className="hint">
                  {progress.phase === 'download' && '下载中'}
                  {progress.phase === 'parse' && '解压中'}
                  {progress.phase === 'store' && '存入本地'}
                  {' '}
                  {Math.round(progress.ratio * 100)}%
                </span>
              </div>
            ) : (
              <button className="btn-primary" onClick={handleDownload}>
                下载词典（{formatBytes(status.bytes || 3.4e6)}）
              </button>
            )}
            {error && <p className="msg">{error}</p>}
          </div>
        )}

        {status?.ready && (
          <>
            <div className="dict-search">
              <input
                ref={inputRef}
                className="input"
                value={query}
                placeholder="输入要查的单词"
                onChange={(e) => void onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void search(query)
                }}
                enterKeyHint="search"
              />
              <button className="btn-primary" onClick={() => void search(query)}>
                查询
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className="dict-suggest">
                {suggestions.map((s) => (
                  <button key={s} className="dict-suggest-item" onClick={() => void search(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {searched && !entry && (
              <p className="hint dict-empty">
                没查到「{query}」，换个拼写试试（词典收录 3.8 万常用词）
              </p>
            )}

            {entry && (
              <div className="dict-entry">
                <div className="dict-word-row">
                  <div>
                    <span className="dict-word">{entry.word}</span>
                    {entry.phonetic && <span className="phonetic">{entry.phonetic}</span>}
                  </div>
                  <button
                    className="btn-speak"
                    onClick={() => void speak(entry.word)}
                    aria-label="朗读单词"
                  >
                    🔊
                  </button>
                </div>

                {hit?.via !== 'exact' && (
                  <p className="dict-via">
                    「{query}」是 {entry.word} 的变形，已为你还原
                  </p>
                )}

                <div className="dict-badges">
                  {entry.oxford === 1 && <span className="dict-badge ox">牛津3000</span>}
                  {entry.collins > 0 && (
                    <span className="dict-badge col">柯林斯 {'★'.repeat(entry.collins)}</span>
                  )}
                  {entry.tags.map((t) => (
                    <span key={t} className="dict-badge exam">
                      {EXAM_LABELS[t] ?? t}
                    </span>
                  ))}
                </div>

                <div className="dict-senses">
                  {senses.map((s, i) => (
                    <div key={i} className="dict-sense">
                      <div className="dict-sense-main">
                        {s.trans.pos && <em className="dict-pos">{s.trans.pos}</em>}
                        <span className="dict-sense-text">{s.trans.text}</span>
                        <button
                          className="dict-speak"
                          onClick={() => void speak(s.def?.text || entry.word)}
                          aria-label="朗读英文释义"
                        >
                          🔊
                        </button>
                      </div>
                      {s.def && <div className="dict-sense-en">{s.def.text}</div>}
                    </div>
                  ))}
                </div>

                {entry.forms.length > 0 && (
                  <div className="dict-forms">
                    <span className="dict-forms-label">词形变化</span>
                    {entry.forms.map((f, i) => (
                      <span key={i} className="dict-form-chip">
                        {FORM_LABELS[f.type] ?? f.type} {f.form}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
