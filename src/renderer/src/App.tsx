import { useCallback, useEffect, useState } from 'react'
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
  const [maximized, setMaximized] = useState(false)
  const [version, setVersion] = useState('0.1.0')

  // 初始数据
  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.app.version().then(setVersion)
    window.api.live.getStatus().then(setLive)
    window.api.window.isMaximized().then(setMaximized)
  }, [])

  // 事件订阅
  useEffect(() => {
    const offSettings = window.api.onEvent('settings:changed', (e) => setSettings(e.settings))
    const offLive = window.api.onEvent('live:status', (e) => setLive(e.status))
    const offMax = window.api.onEvent('window:maximized', (e) => setMaximized(e.maximized))
    return () => {
      offSettings()
      offLive()
      offMax()
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

  if (!settings) return null // 等待设置加载

  return (
    <I18nProvider lang={settings.language} onLangChange={onLangChange}>
      <ToastProvider>
        <div className="app">
          <TitleBar status={live} version={version} />
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
          {maximized && null}
        </div>
      </ToastProvider>
    </I18nProvider>
  )
}
