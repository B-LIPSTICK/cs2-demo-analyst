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

export function TitleBar({
  status,
  version,
  theme,
  onToggleTheme
}: {
  status: LiveStatus
  version: string
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}) {
  const t = useTKey()
  return (
    <header className="titlebar">
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
          Demo Analyst
          <span className="ver">{t('titlebar.version')}{version}</span>
        </div>
      </div>
      <div className="spacer" />
      <div className="status-cluster">
        <Led state={ledFor(status, 'cs2')} label={t('status.cs2')} />
        <Led state={ledFor(status, 'vcon')} label={t('status.vcon')} />
        <Led state={ledFor(status, 'gsi')} label={t('status.gsi')} />
        <button
          className="theme-btn"
          onClick={onToggleTheme}
          title={t('titlebar.themeToggle')}
          aria-label={t('titlebar.themeToggle')}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
        </button>
      </div>
      {/* 窗口控制（右上角） */}
      <div className="win-btns">
        <button className="win-btn min" onClick={() => window.api.window.minimize()} title="Minimize">
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
        <button className="win-btn close" onClick={() => window.api.window.close()} title="Close">
          <svg viewBox="0 0 12 12">
            <path d="M3 3l6 6M9 3L3 9" />
          </svg>
        </button>
      </div>
    </header>
  )
}
