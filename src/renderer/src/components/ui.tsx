/**
 * HUD 原子组件 + 图标集 + Toast 系统
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
  type SVGProps
} from 'react'

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
      strokeLinecap="square"
      {...rest}
    >
      {children}
    </svg>
  )
}

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

// ─── 面板 ───────────────────────────────────────────────────────────────────

export function Panel({
  hd,
  dot,
  children,
  className = '',
  raised,
  style
}: {
  hd?: string
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
  variant?: 'primary' | 'accent' | 'danger' | 'ghost' | ''
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

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    />
  )
}

// ─── 头像 ───────────────────────────────────────────────────────────────────

export function Avatar({
  name,
  team,
  size = 20
}: {
  name: string
  team: 'T' | 'CT' | 'SPEC' | 'NONE'
  size?: number
}) {
  const cls = team === 'T' ? 't' : team === 'CT' ? 'ct' : team
  return (
    <span
      className={`av ${cls}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.46) }}
    >
      {(name[0] ?? '?').toUpperCase()}
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
  return (
    <ToastContext.Provider value={{ push }}>
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
