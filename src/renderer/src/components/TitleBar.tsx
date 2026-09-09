import { Led, IcGithub } from './ui'
import type { LiveStatus } from '@shared/types'
import { useTKey } from '@/i18n'

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
        <div className="wordmark">
          Demo Analyst
          <span className="ver">{t('titlebar.version')}{version}</span>
        </div>
      </div>
      <div className="spacer" />
      <div className="status-cluster">
        <Led state={status.cs2Running ? 'on' : 'off'} label={t('status.cs2')} />
        <button
          className="theme-btn"
          onClick={() => window.api.app.openUrl('https://github.com/B-LIPSTICK')}
          title="GitHub: B-LIPSTICK"
          aria-label="GitHub: B-LIPSTICK"
        >
          <IcGithub size={15} />
        </button>
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
        <button className="win-btn min" onClick={() => window.api.window.minimize()} title="最小化 (Minimize)">
          <span className="dot">
            <svg viewBox="0 0 12 12">
              <path d="M2 6h8" />
            </svg>
          </span>
        </button>
        <button
          className="win-btn max"
          onClick={() => window.api.window.toggleMaximize()}
          title="最大化 / 还原 (Maximize)"
        >
          <span className="dot">
            <svg viewBox="0 0 12 12">
              <path d="M4 4l4 4M5 4h3v3" />
            </svg>
          </span>
        </button>
        <button className="win-btn close" onClick={() => window.api.window.close()} title="关闭 (Close)">
          <span className="dot">
            <svg viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3L3 9" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  )
}
