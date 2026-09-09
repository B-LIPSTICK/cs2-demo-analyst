import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { I18nProvider, useTKey, type Lang } from './i18n'
import { ToastProvider } from './components/ui'
import { TitleBar } from './components/TitleBar'
import { NavRail, type Page } from './components/NavRail'
import { LibraryPage } from './pages/LibraryPage'
import { TranscriptPage } from './pages/TranscriptPage'
import { AiPage } from './pages/AiPage'
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
            <div className="app-crash-stack">
              {String(this.state.error?.stack ?? '').split('\n').slice(0, 12).join('\n')}
            </div>
            <div className="flex" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => this.setState({ error: null })}>
                重试
              </button>
              <button className="btn ghost" onClick={() => window.api.app.revealInFolder('')}>
                打开数据目录
              </button>
            </div>
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
  if (page === 'library' || page === 'transcript' || page === 'ai' || page === 'settings') {
    return { page, demoId: demoId || undefined }
  }
  return { page: 'library' }
}

export default function App() {
  const t = useTKey()
  const [route, setRoute] = useState<Route>(initialRoute)
  // 导航序号（navigate 每次 +1）：页面常驻下重复跳转同一 demo 时目标页也能感知
  const [navSeq, setNavSeq] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [live, setLive] = useState<LiveStatus>({
    state: 'idle',
    cs2Running: false,
    vconsoleConnected: false,
    gsiActive: false
  })
  const [version, setVersion] = useState('1.0.0')
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null)

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
    const offUpd = window.api.onEvent('update:available', (e) =>
      setUpdate({ version: e.version, url: e.url })
    )
    return () => {
      offSettings()
      offLive()
      offUpd()
    }
  }, [])

  const navigate = useCallback((page: Page, demoId?: string) => {
    setRoute({ page, demoId })
    // 导航序号：同一 demo 重复导航时也递增，让目标页能感知「再次跳转」并重新同步选中
    setNavSeq((s) => s + 1)
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
            {update && (
              <div className="update-banner">
                <span className="ub-txt">{t('update.available').replace('{ver}', update.version)}</span>
                <button className="btn primary" style={{ height: 24, fontSize: 12 }} onClick={() => window.api.app.openUrl(update.url)}>
                  {t('update.go')}
                </button>
                <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setUpdate(null)} title={t('update.dismiss')}>
                  ✕
                </button>
              </div>
            )}
            <TitleBar
              status={live}
              version={version}
              theme={settings.ui.theme}
              onToggleTheme={onToggleTheme}
            />
            <div className="app-body">
              <NavRail page={route.page} onNavigate={(p) => navigate(p)} />
              <main className={`page-scroll ${route.page === 'ai' ? 'no-scroll' : ''}`}>
                {/* 页面常驻（display 显隐而非卸载）：切换页面后保留原页面状态
                    （选中的 demo、筛选、转写进度等不再丢失） */}
                <div style={{ display: route.page === 'library' ? undefined : 'none' }}>
                  <LibraryPage
                    demoId={route.demoId}
                    onOpenDemo={(id) => navigate('library', id)}
                    onGoTranscript={(id) => navigate('transcript', id)}
                  />
                </div>
                <div style={{ display: route.page === 'transcript' ? undefined : 'none' }}>
                  <TranscriptPage initialDemoId={route.demoId} navSeq={navSeq} onOpenDemo={(id) => navigate('transcript', id)} />
                </div>
                <div style={{ display: route.page === 'ai' ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
                  <AiPage onGoSettings={() => navigate('settings')} />
                </div>
                <div style={{ display: route.page === 'settings' ? undefined : 'none' }}>
                  <SettingsPage settings={settings} version={version} />
                </div>
              </main>
            </div>
          </div>
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  )
}
