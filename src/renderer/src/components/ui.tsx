/**
 * HUD 原子组件 + 图标集 + Toast 系统
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SVGProps
} from 'react'
import { createPortal } from 'react-dom'

// ─── 图标（stroke 风格，与设计系统一致） ─────────────────────────────────────

type IcProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 14, children, ...rest }: IcProps & { children: ReactNode }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IcGithub = (p: IcProps) => (
  <svg
    className="ic"
    width={p.size ?? 14}
    height={p.size ?? 14}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
    {...p}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
)

export const IcLibrary = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
  </Base>
)

export const IcTranscript = (p: IcProps) => (
  <Base {...p}>
    <path d="M5 5h14M5 12h14M5 19h9" />
  </Base>
)

export const IcLive = (p: IcProps) => (
  <Base {...p}>
    <path d="M12 3v6M12 9l5-4M12 9L7 5" />
    <path d="M4 12a8 8 0 1 0 16 0" />
  </Base>
)

export const IcSettings = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </Base>
)

export const IcPlay = (p: IcProps) => (
  <Base {...p}>
    <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />
  </Base>
)

export const IcPause = (p: IcProps) => (
  <Base {...p}>
    <path d="M8 4v16M16 4v16" strokeWidth={2.4} />
  </Base>
)

export const IcJump = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 12h13M13 6l6 6-6 6" />
  </Base>
)

export const IcSearch = (p: IcProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Base>
)

export const IcFolder = (p: IcProps) => (
  <Base {...p}>
    <path d="M3 6.5h7l2 2.5h9v10.5H3z" />
  </Base>
)

export const IcRefresh = (p: IcProps) => (
  <Base {...p}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8M20 3v4h-4" />
  </Base>
)

export const IcPlus = (p: IcProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
)

export const IcClose = (p: IcProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
)

export const IcChevron = (p: IcProps) => (
  <Base {...p}>
    <path d="M9 5l7 7-7 7" />
  </Base>
)

export const IcChevronLeft = (p: IcProps) => (
  <Base {...p}>
    <path d="M15 19l-7-7 7-7" strokeWidth={2.4} />
  </Base>
)

export const IcChevronRight = (p: IcProps) => (
  <Base {...p}>
    <path d="M9 5l7 7-7 7" strokeWidth={2.4} />
  </Base>
)

export const IcMic = (p: IcProps) => (
  <Base {...p}>
    <rect x="9" y="3" width="6" height="11" rx="1" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Base>
)

export const IcChat = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 5h16v12H9l-5 4z" />
  </Base>
)

export const IcDownload = (p: IcProps) => (
  <Base {...p}>
    <path d="M12 4v11M7 11l5 5 5-5M4 20h16" />
  </Base>
)

export const IcTick = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 12.5l5.5 5.5L20 6.5" />
  </Base>
)

export const IcBack = (p: IcProps) => (
  <Base {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Base>
)

export const IcSpark = (p: IcProps) => (
  <Base {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Base>
)

export const IcSend = (p: IcProps) => (
  <Base {...p}>
    <path d="M4 12l16-8-5.5 16-3.5-6.5L4 12z" />
  </Base>
)

export const IcStop = (p: IcProps) => (
  <Base {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
  </Base>
)

export const IcRadar = (p: IcProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 12l4.5 -4.5" />
  </Base>
)

// ─── 面板 ───────────────────────────────────────────────────────────────────

export function Panel({
  hd,
  dot,
  children,
  className = '',
  raised,
  style
}: {
  hd?: ReactNode
  dot?: boolean
  children?: ReactNode
  className?: string
  raised?: boolean
  style?: React.CSSProperties
}) {
  return (
    <section className={`panel ${raised ? 'raised' : ''} ${className}`} style={style}>
      {hd && (
        <div className="panel-hd">
          {dot && <span className="dot" />}
          {hd}
        </div>
      )}
      {children !== undefined && <div className="panel-bd">{children}</div>}
    </section>
  )
}

export function SectionHead({
  idx,
  children,
  extra
}: {
  idx?: number | string
  children: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="section-head">
      {idx !== undefined && <span className="idx">{String(idx).padStart(2, '0')}</span>}
      {children}
      {extra && <span className="extra">{extra}</span>}
    </div>
  )
}

// ─── 按钮 ───────────────────────────────────────────────────────────────────

export function Btn({
  variant,
  size,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost' | ''
  size?: 'sm' | 'lg' | ''
}) {
  return (
    <button className={`btn ${variant ?? ''} ${size ?? ''} ${className}`} {...rest}>
      {children}
    </button>
  )
}

// ─── 徽标 ───────────────────────────────────────────────────────────────────

export function Tag({
  tone,
  dot,
  children,
  className = ''
}: {
  tone?: 't' | 'ct' | 'voice' | 'alert' | 'ghost' | ''
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`tag ${tone ?? ''} ${className}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

// ─── 状态灯 ─────────────────────────────────────────────────────────────────

export function Led({ state, label }: { state: 'on' | 'warn' | 'red' | 'off'; label: string }) {
  return <span className={`led ${state}`}>{label}</span>
}

// ─── 进度环 ─────────────────────────────────────────────────────────────────

export function Ring({ pct, size = 46, label }: { pct: number; size?: number; label?: string }) {
  const r = (size - 5) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, pct))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} />
        <circle
          className="bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          strokeLinecap="square"
        />
      </svg>
      <span className="val">{label ?? `${Math.round(v * 100)}%`}</span>
    </div>
  )
}

// ─── 开关 ───────────────────────────────────────────────────────────────────

export function Toggle({
  on,
  onChange,
  disabled
}: {
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onChange(!on)}
      aria-pressed={on}
      disabled={disabled}
    />
  )
}

// ─── 头像 ───────────────────────────────────────────────────────────────────

export function Avatar({
  name,
  team,
  size = 20,
  avatar
}: {
  name: string
  team: 'T' | 'CT' | 'SPEC' | 'NONE'
  size?: number
  avatar?: string
}) {
  const cls = team === 'T' ? 't' : team === 'CT' ? 'ct' : team
  return (
    <span
      className={`av ${cls}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.46), overflow: 'hidden' }}
    >
      {avatar ? (
        <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        (name[0] ?? '?').toUpperCase()
      )}
    </span>
  )
}

// ─── 空状态 ─────────────────────────────────────────────────────────────────

export function Empty({
  ghost,
  hint,
  children
}: {
  ghost: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="ghost">{ghost}</div>
      {hint && <div className="hint">{hint}</div>}
      {children}
    </div>
  )
}

// ─── Toast 系统 ─────────────────────────────────────────────────────────────

type ToastKind = 'ok' | 'warn' | 'err'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastCtx {
  push: (text: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastCtx>({ push: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3400)
  }, [])
  // ★value 必须稳定（useMemo）：否则 provider 每次渲染都下发新对象 → 所有 useToast
  //  消费者重渲染 → 依赖 toast 的 useCallback/useEffect 反复重建/重跑（曾导致
  //  资料库 load() 每 ~4s 重跑、SCANNING/卡片列表往返闪烁）
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastCtx {
  return useContext(ToastContext)
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtTick(tick: number, rate = 64): string {
  if (!isFinite(tick) || tick < 0) return '---'
  const m = Math.floor(tick / rate / 60)
  const s = Math.floor((tick / rate) % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}

export function fmtDate(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── 语音播放按钮（全局单 Audio，点播放 / 再点停止，换段自动切换） ─────────────

let voiceAudio: HTMLAudioElement | null = null
let voiceUrl: string | null = null
let voiceListener: ((playing: boolean) => void) | null = null

/** 停止当前播放（若有）并通知监听者 */
function stopVoice() {
  if (voiceAudio) {
    voiceAudio.pause()
    voiceAudio = null
  }
  if (voiceUrl) {
    URL.revokeObjectURL(voiceUrl)
    voiceUrl = null
  }
  voiceListener?.(false)
  voiceListener = null
}

/**
 * 语音片段播放按钮：点击 → 主进程切片返回小 WAV → Audio 播放。
 * 全局单实例：任何时刻只有一段在播，再次点击停止。
 */
export function VoicePlayButton({
  demoId,
  seg,
  size = 15
}: {
  demoId: string
  seg: { steamId?: string; playerName: string; startSec: number; endSec: number }
  size?: number
}) {
  const toast = useToast()
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    // 组件卸载/切换时若有播放，停止并清理
    return () => {
      if (voiceListener === setPlaying) stopVoice()
    }
  }, [])

  const toggle = async () => {
    if (playing) {
      stopVoice()
      return
    }
    let audio: HTMLAudioElement | null = null
    try {
      const b64 = await window.api.voice.play(demoId, seg)
      if (!b64) {
        toast.push('语音文件不存在（需先提取/转写语音）', 'warn')
        return
      }
      // base64 → Uint8Array → Blob（主进程传字符串，避免 Buffer 序列化失真）
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      // 切新段：先停旧的
      if (voiceAudio) stopVoice()
      const blob = new Blob([bytes as BlobPart], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      voiceUrl = url
      audio = new Audio(url)
      voiceAudio = audio
      voiceListener = setPlaying
      audio.onended = () => {
        voiceAudio = null
        if (voiceUrl) {
          URL.revokeObjectURL(voiceUrl)
          voiceUrl = null
        }
        setPlaying(false)
        voiceListener = null
      }
      // onerror 与 play() reject 会同时触发，用标志避免连弹两个错误
      let errShown = false
      const fail = (msg: string) => {
        if (errShown) return
        errShown = true
        stopVoice()
        toast.push(msg, 'err')
      }
      audio.onerror = () => fail('播放失败（语音文件可能已损坏）')
      try {
        await audio.play()
        setPlaying(true)
      } catch {
        fail('播放失败')
      }
    } catch {
      toast.push('播放失败', 'err')
    }
  }

  return (
    <button
      className={`icon-btn voice-play ${playing ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        void toggle()
      }}
      title={playing ? '停止' : '播放'}
    >
      {playing ? <IcPause size={size} /> : <IcPlay size={size} />}
    </button>
  )
}

// ─── 浮层定位 Hook（用于各类下拉选择器与弹出菜单，彻底摆脱卡片 overflow 与堆叠上下文限制） ─

export interface FloatingCoords {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
  openUp: boolean
}

export function useFloatingPosition(
  triggerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  options?: { minWidth?: number; defaultMaxHeight?: number; gap?: number }
) {
  const minWidth = options?.minWidth ?? 160
  const defaultMaxHeight = options?.defaultMaxHeight ?? 280
  const gap = options?.gap ?? 4

  const [coords, setCoords] = useState<FloatingCoords>({
    left: 0,
    top: 0,
    width: minWidth,
    maxHeight: defaultMaxHeight,
    openUp: false
  })

  const update = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const width = Math.max(rect.width, minWidth)

    // 若下方空间不足 220px 且上方空间更大，则向上弹出
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, Math.min(openUp ? spaceAbove - gap - 8 : spaceBelow - gap - 8, defaultMaxHeight))

    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))

    setCoords({
      left,
      width,
      maxHeight,
      openUp,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap })
    })
  }, [triggerRef, minWidth, defaultMaxHeight, gap])

  useLayoutEffect(() => {
    if (!open) return
    update()
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, update])

  return { coords, update }
}

// ─── 自定义高颜值亚克力下拉选择器 ──────────────────────────────────────────

export interface CustomSelectOption<T extends string = string> {
  value: T
  label: ReactNode
  sublabel?: string
  icon?: ReactNode
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  width,
  style,
  disabled
}: {
  value: T
  options: CustomSelectOption<T>[]
  onChange: (val: T) => void
  placeholder?: string
  width?: number | string
  style?: CSSProperties
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const minW = typeof width === 'number' ? width : 160
  const { coords } = useFloatingPosition(containerRef, open, { minWidth: minW, defaultMaxHeight: 280 })

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDocClick, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDocClick, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const cur = options.find((o) => o.value === value)

  return (
    <div
      ref={containerRef}
      className={`custom-select ${disabled ? 'disabled' : ''} ${open ? 'open' : ''}`}
      style={{ width: width ?? '100%', ...style }}
    >
      <button
        type="button"
        className="cs-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="cs-label">
          {cur ? (
            <span className="cs-val">
              {cur.icon && <span className="cs-icon">{cur.icon}</span>}
              <span>{cur.label}</span>
            </span>
          ) : (
            <span className="cs-placeholder">{placeholder ?? '请选择…'}</span>
          )}
        </span>
        <svg
          className={`cs-arrow ${open ? 'open' : ''}`}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="custom-select-menu"
            style={{
              position: 'fixed',
              left: coords.left,
              ...(coords.openUp ? { bottom: coords.bottom } : { top: coords.top }),
              width: coords.width,
              minWidth: 'unset',
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: coords.maxHeight,
              zIndex: 99999
            }}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value
              return (
                <div
                  key={opt.value}
                  className={`cs-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                >
                  <div className="cs-item-content">
                    {opt.icon && <span className="cs-icon">{opt.icon}</span>}
                    <span className="cs-item-label">{opt.label}</span>
                    {opt.sublabel && <span className="cs-item-sub">{opt.sublabel}</span>}
                  </div>
                  {isSelected && (
                    <svg className="cs-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                    </svg>
                  )}
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
