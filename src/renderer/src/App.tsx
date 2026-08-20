import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { I18nProvider, type Lang } from './i18n'
import { ToastProvider } from './components/ui'
import { TitleBar } from './components/TitleBar'
import { NavRail, type Page } from './components/NavRail'
import { LibraryPage } from './pages/LibraryPage'
import { TranscriptPage } from './pages/TranscriptPage'
import { LivePage } from './pages/LivePage'
import { SettingsPage } from './pages/SettingsPage'
import type { LiveStatus, Settings } from '@shared/types'

interface Route {
  page: Page
  demoId?: string
}

/** 渲染错误兜底：任何组件抛错都显示可见信息，而不是黑屏 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[ui] render error', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="app-crash">
          <div className="app-crash-box">
            <div className="app-crash-title">UI 渲染异常</div>
            <div className="app-crash-msg">{String(this.state.error?.message ?? this.state.error)}</div>
            <button className="btn primary" onClick={() => this.setState({ error: null })}>
              重试
            </button>
            <button className="btn ghost" onClick={() => window.api.app.revealInFolder('')}>
              打开数据目录
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** 开发辅助：从 location.hash 读取初始路由（#library/demoId 等） */
function initialRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  const [page, demoId] = hash.split('/')
  if (page === 'library' || page === 'transcript' || page === 'live' || page === 'settings') {
    return { page, demoId: demoId || undefined }
  }
  return { page: 'library' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [live, setLive] = useState<LiveStatus>({
    state: 'idle',
    cs2Running: false,
    vconsoleConnected: false,
    gsiActive: false
  })
  const [version, setVersion] = useState('0.1.0')

  // 初始数据
  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.app.version().then(setVersion)
    window.api.live.getStatus().then(setLive)
    window.api.window.isMaximized()
  }, [])

  // 主题应用到根节点（明暗切换）
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.ui?.theme ?? 'dark'
  }, [settings?.ui?.theme])

  // 事件订阅
  useEffect(() => {
    // 防御：载荷异常时保持原设置（曾经因主进程发裸对象导致 e.settings=undefined → 黑屏）
    const offSettings = window.api.onEvent('settings:changed', (e) => {
      setSettings((s) => e.settings ?? s)
    })
    const offLive = window.api.onEvent('live:status', (e) => setLive(e.status))
    return () => {
      offSettings()
      offLive()
    }
  }, [])

  // 实况状态轮询（Phase 3 后由主进程事件驱动）
  useEffect(() => {
    const timer = setInterval(() => {
      window.api.live.getStatus().then(setLive).catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  const navigate = useCallback((page: Page, demoId?: string) => {
    setRoute({ page, demoId })
  }, [])

  const onLangChange = useCallback((lang: Lang) => {
    setSettings((s) => (s ? { ...s, language: lang } : s))
    window.api.settings.set({ language: lang }).catch(() => {})
  }, [])

  const onToggleTheme = useCallback(() => {
    setSettings((s) => {
      if (!s) return s
      const theme: 'dark' | 'light' = s.ui.theme === 'dark' ? 'light' : 'dark'
      const next = { ...s, ui: { ...s.ui, theme } }
      window.api.settings.set({ ui: { theme } }).catch(() => {})
      return next
    })
  }, [])

  // 设置未就绪时显示加载壳（而不是 return null 导致黑屏）
  if (!settings) {
    return (
      <div className="app-loading">
        <span className="app-loading-dot" />
        <span>CS2 Demo Analyst</span>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <I18nProvider lang={settings.language} onLangChange={onLangChange}>
        <ToastProvider>
          <div className="app">
            <TitleBar
              status={live}
              version={version}
              theme={settings.ui.theme}
              onToggleTheme={onToggleTheme}
            />
            <div className="app-body">
              <NavRail page={route.page} onNavigate={(p) => navigate(p)} version={version} />
              <main className="page-scroll">
                {route.page === 'library' && (
                  <LibraryPage
                    demoId={route.demoId}
                    onOpenDemo={(id) => navigate('library', id)}
                    onGoTranscript={(id) => navigate('transcript', id)}
                  />
                )}
                {route.page === 'transcript' && (
                  <TranscriptPage initialDemoId={route.demoId} onOpenDemo={(id) => navigate('transcript', id)} />
                )}
                {route.page === 'live' && <LivePage />}
                {route.page === 'settings' && <SettingsPage settings={settings} />}
              </main>
            </div>
          </div>
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}
