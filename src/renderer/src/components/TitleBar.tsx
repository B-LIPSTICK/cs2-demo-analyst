import { Led } from './ui'
import type { LiveStatus } from '@shared/types'
import { useTKey } from '@/i18n'

function ledFor(status: LiveStatus, kind: 'cs2' | 'vcon' | 'gsi'): 'on' | 'warn' | 'red' | 'off' {
  if (kind === 'cs2') {
    return status.cs2Running ? 'on' : 'off'
  }
  if (kind === 'vcon') {
    if (status.vconsoleConnected) return 'on'
    return status.cs2Running ? 'warn' : 'off'
  }
  return status.gsiActive ? 'on' : 'off'
}

export function TitleBar({ status, version }: { status: LiveStatus; version: string }) {
  const t = useTKey()
  return (
    <header className="titlebar">
      {/* macOS 风格红绿灯（左） */}
      <div className="win-btns">
        <button className="win-btn close" onClick={() => window.api.window.close()} title="Close">
          <svg viewBox="0 0 12 12">
            <path d="M3 3l6 6M9 3L3 9" />
          </svg>
        </button>
        <button
          className="win-btn min"
          onClick={() => window.api.window.minimize()}
          title="Minimize"
        >
          <svg viewBox="0 0 12 12">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button
          className="win-btn max"
          onClick={() => window.api.window.toggleMaximize()}
          title="Maximize"
        >
          <svg viewBox="0 0 12 12">
            <path d="M4 4l4 4M5 4h3v3" />
          </svg>
        </button>
      </div>
      <div className="brand">
        <span className="logo">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="11" r="7" stroke="#3f9cff" strokeWidth="1.6" />
            <path
              d="M12 4.5v3M12 14.5v3M4.5 11h3M14.5 11h3"
              stroke="#e5b567"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="12" cy="11" r="1.4" fill="#3f9cff" />
            <path
              d="M6.5 19.5c1.8 1 3.5 1.5 5.5 1.5s3.7-.5 5.5-1.5"
              stroke="#e5b567"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="wordmark">
          Demo<span className="slash">//</span>Analyst
          <span className="ver">{t('titlebar.version')}{version}</span>
        </div>
      </div>
      <div className="spacer" />
      <div className="status-cluster">
        <Led state={ledFor(status, 'cs2')} label={t('status.cs2')} />
        <Led state={ledFor(status, 'vcon')} label={t('status.vcon')} />
        <Led state={ledFor(status, 'gsi')} label={t('status.gsi')} />
      </div>
    </header>
  )
}
