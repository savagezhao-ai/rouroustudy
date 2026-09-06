// 应用内对话框：替代浏览器原生 prompt/confirm/alert
// （在 PWA 沙箱/iframe 环境里原生弹窗会被拦截导致点击无效）
import { useEffect, useRef, useState } from 'react'

type Mode = 'prompt' | 'confirm' | 'alert' | 'choose'

export interface DialogChoice {
  label: string
  value: string
  desc?: string
  danger?: boolean
}

interface DialogSpec {
  mode: Mode
  title: string
  value?: string // prompt 的默认值
  danger?: boolean // 确认按钮显示红色
  confirmText?: string
  choices?: DialogChoice[] // choose 模式的可选项
}

let listener: ((spec: DialogSpec | null) => void) | null = null
let resolver: ((v: string | boolean | null) => void) | null = null

function open(spec: DialogSpec): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    resolver?.(spec.mode === 'prompt' ? null : false)
    resolver = resolve
    listener?.(spec)
  })
}

/** 输入框对话框：确认返回输入内容，取消返回 null */
export function uiPrompt(title: string, value = ''): Promise<string | null> {
  return open({ mode: 'prompt', title, value }) as Promise<string | null>
}

/** 确认对话框：确定 true / 取消 false */
export function uiConfirm(title: string, opts?: { danger?: boolean; confirmText?: string }): Promise<boolean> {
  return open({ mode: 'confirm', title, ...opts }) as Promise<boolean>
}

/** 提示对话框（只有一个确定按钮） */
export function uiAlert(title: string): Promise<boolean> {
  return open({ mode: 'alert', title }) as Promise<boolean>
}

/** 选择对话框：返回所选项的 value，取消返回 null */
export function uiChoose(title: string, choices: DialogChoice[]): Promise<string | null> {
  return open({ mode: 'choose', title, choices }) as Promise<string | null>
}

function close(v: string | boolean | null) {
  listener?.(null)
  resolver?.(v)
  resolver = null
}

export function Dialog() {
  const [spec, setSpec] = useState<DialogSpec | null>(null)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listener = setSpec
    return () => {
      listener = null
    }
  }, [])

  useEffect(() => {
    if (spec?.mode === 'prompt') {
      setText(spec.value ?? '')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [spec])

  if (!spec) return null

  const isPrompt = spec.mode === 'prompt'
  const isChoose = spec.mode === 'choose'
  const cancelValue = isPrompt || isChoose ? null : false

  return (
    <div className="dialog-mask" onClick={() => close(cancelValue)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <p className="dialog-title">{spec.title}</p>
        {isChoose && (
          <div className="dialog-choices">
            {(spec.choices ?? []).map((c) => (
              <button
                key={c.value}
                className={`dialog-choice${c.danger ? ' danger' : ''}`}
                onClick={() => close(c.value)}
              >
                <strong>{c.label}</strong>
                {c.desc && <em>{c.desc}</em>}
              </button>
            ))}
          </div>
        )}
        {isPrompt && (
          <input
            ref={inputRef}
            className="dialog-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') close(text)
              if (e.key === 'Escape') close(null)
            }}
          />
        )}
        <div className="dialog-actions">
          {spec.mode !== 'alert' && !isChoose && (
            <button className="dialog-btn ghost" onClick={() => close(cancelValue)}>
              取消
            </button>
          )}
          <button
            className={`dialog-btn ${spec.danger ? 'danger' : 'primary'}`}
            onClick={() => close(isPrompt ? text : true)}
          >
            {spec.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}
