import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Btn, IcFolder, IcPlus, IcRefresh, Panel, SectionHead, Tag, Toggle, useToast } from '@/components/ui'
import { useT, type Lang } from '@/i18n'
import type { Settings } from '@shared/types'
import { formatRootLabel } from './LibraryPage'

/** 弹窗：createPortal 到 body，fixed 相对视口居中（避免被 .page 的 transform 动画干扰） */
function Modal({
  title,
  body,
  onClose,
  onConfirm,
  confirmLabel
}: {
  title: string
  body: string
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
}) {
  const t = useT()
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 460,
          maxWidth: '92vw',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-1)',
          borderRadius: 12,
          padding: 20
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-line' }}>
          {body}
        </div>
        <div className="flex" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            {t.t('common.cancel')}
          </Btn>
          <Btn variant="accent" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>,
    document.body
  )
}

const ENGINE_ROWS: { kind: string; label: string }[] = [
  { kind: 'csgove', label: 'settings.engCsgove' },
  { kind: 'whisper', label: 'settings.engWhisper' },
  { kind: 'model-base', label: 'settings.engModelBase' },
  { kind: 'model-small', label: 'settings.engModelSmall' },
  { kind: 'model-medium', label: 'settings.engModelMedium' }
]

export function SettingsPage({ settings, version }: { settings: Settings; version?: string }) {
  const t = useT()
  const toast = useToast()
  const [draft, setDraft] = useState<Settings>(settings)
  const [engStatus, setEngStatus] = useState<Record<string, boolean>>({})
  const [engProgress, setEngProgress] = useState<{ what: string; received: number; total: number } | null>(null)
  const [downloadingKind, setDownloadingKind] = useState<string | null>(null)
  const [aiModels, setAiModels] = useState<string[] | null>(null)
  const [aiModelsLoading, setAiModelsLoading] = useState(false)

  useEffect(() => {
    window.api.engines.status().then(setEngStatus).catch(() => {})
    const off = window.api.onEvent('engine:progress', (e) => {
      setEngProgress({ what: e.what, received: e.received, total: e.total })
    })
    return off
  }, [])

  const refreshEngines = () => {
    window.api.engines.status().then(setEngStatus).catch(() => {})
    setEngProgress(null)
    setDownloadingKind(null)
  }

  const ensureEngine = async (kind: string) => {
    if (downloadingKind) return
    setDownloadingKind(kind)
    try {
      await window.api.engines.ensure(kind as never)
      refreshEngines()
      toast.push(t.t('settings.engInstalled'))
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
      refreshEngines()
    } finally {
      setDownloadingKind(null)
    }
  }

  const save = async (patch: Partial<Settings>) => {
    const next = await window.api.settings.set(patch)
    setDraft(next)
    toast.push(t.t('settings.save'))
  }

  const set = (patch: Partial<Settings>) => {
    const merged = { ...draft, ...patch } as Settings
    setDraft(merged)
    save(patch)
  }

  const setAsr = (patch: Partial<Settings['asr']>) => {
    set({ asr: { ...draft.asr, ...patch } })
  }

  // 推荐免费（Groq）声明弹窗
  const [showRecModal, setShowRecModal] = useState(false)
  const pickRecommended = () => {
    if (draft.asr.engine === 'cloud' && draft.asr.cloudBaseUrl.includes('groq.com')) {
      // 已选推荐：直接确认（弹窗已展示过）
      return
    }
    setShowRecModal(true)
  }
  const confirmRecommended = () => {
    setAsr({
      engine: 'cloud',
      cloudBaseUrl: 'https://api.groq.com/openai/v1',
      cloudModel: 'whisper-large-v3-turbo'
    })
    setShowRecModal(false)
    toast.push(t.t('settings.recommendedSet'))
  }

  // AI 推荐免费（Groq llama）声明弹窗
  const [showAiRecModal, setShowAiRecModal] = useState(false)
  const pickAiRecommended = () => {
    if (draft.ai.baseUrl.includes('groq.com')) return
    setShowAiRecModal(true)
  }
  const confirmAiRecommended = () => {
    setAi({
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile'
    })
    setShowAiRecModal(false)
    toast.push(t.t('settings.aiRecommendedSet'))
  }

  const setAi = (patch: Partial<Settings['ai']>) => {
    set({ ai: { ...draft.ai, ...patch } })
  }

  const pullModels = async () => {
    if (!draft.ai.apiKey) {
      toast.push(t.t('settings.aiKeyFirst'), 'warn')
      return
    }
    setAiModelsLoading(true)
    try {
      const list = await window.api.ai.listModels()
      setAiModels(list)
      toast.push(t.tf('settings.aiModelsFetched', { n: list.length }))
    } catch (err) {
      setAiModels(null)
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setAiModelsLoading(false)
    }
  }

  const setCs2 = (patch: Partial<Settings['cs2']>) => {
    set({ cs2: { ...draft.cs2, ...patch } })
  }

  const addRoot = async () => {
    const roots = await window.api.library.addRoot()
    if (roots && roots.length) {
      set({ libraryRoots: [...new Set([...draft.libraryRoots, ...roots])] })
    }
  }

  const autoDetectRoots = async () => {
    try {
      const res = await window.api.library.autoAddPlatformRoots()
      if (res.added.length > 0) {
        set({ libraryRoots: res.roots })
        toast.push(t.tf('library.autoDetectDone', { n: res.added.length }))
      } else {
        toast.push(t.t('library.autoDetectNone'))
      }
    } catch {
      toast.push(t.t('common.error'), 'err')
    }
  }

  const detectCs2 = async () => {
    const path = await window.api.live.locateInstall()
    if (path) {
      setCs2({ installPath: path })
      toast.push(t.t('settings.cs2Detected'))
    } else {
      toast.push(t.t('settings.cs2DetectFailed'), 'warn')
    }
  }

  const installGsi = async () => {
    const path = await window.api.live.installGsi()
    if (path) toast.push(t.tf('settings.gsiInstalled', { path }))
    else toast.push(t.t('settings.gsiInstallFailed'), 'warn')
  }

  const launchTools = async () => {
    const r = await window.api.live.launch({ toolsMode: draft.cs2.useToolsMode })
    if (r.ok) toast.push(t.t('settings.cs2Launched'))
    else toast.push(r.error ?? t.t('common.error'), 'warn')
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="title">
            {t.t('settings.title')}
          </div>
          <div className="sub">{t.t('settings.subtitle')}</div>
        </div>
      </div>

      <SectionHead idx={1}>{t.t('settings.general')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.theme')}</div>
            <div className="d">{t.t('settings.themeHint')}</div>
          </div>
          <div className="seg">
            {(['dark', 'light'] as const).map((th) => (
              <span
                key={th}
                className={`seg-item ${(draft.ui?.theme ?? 'dark') === th ? 'on' : ''}`}
                onClick={() => set({ ui: { ...(draft.ui ?? { theme: 'dark' }), theme: th } })}
              >
                {t.t(`settings.theme${th === 'dark' ? 'Dark' : 'Light'}` as never)}
              </span>
            ))}
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.language')}</div>
          </div>
          <div className="seg">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <span
                key={l}
                className={`seg-item ${draft.language === l ? 'on' : ''}`}
                onClick={() => set({ language: l })}
              >
                {l === 'zh' ? '中文' : 'EN'}
              </span>
            ))}
          </div>
        </div>
      </Panel>

      <SectionHead idx={2}>{t.t('settings.library')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.library')}</div>
            <div className="d">{t.t('settings.libraryHint')}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={autoDetectRoots}>
              ⚡ {t.t('library.autoDetect')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={addRoot}>
              <IcPlus size={12} />
              {t.t('library.addRoot')}
            </Btn>
          </div>
        </div>
        {draft.libraryRoots.length > 0 && (
          <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            {draft.libraryRoots.map((r) => {
              const info = formatRootLabel(r)
              return (
                <div key={r} className="flex between" style={{ gap: 10, alignItems: 'center' }}>
                  <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {info.badge && <span className={`root-platform-badge ${info.badgeClass}`}>{info.badge}</span>}
                      <span>{info.title}</span>
                    </div>
                    <span className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r}>
                      {r}
                    </span>
                  </div>
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => set({ libraryRoots: draft.libraryRoots.filter((x) => x !== r) })}
                  >
                    移除
                  </Btn>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <SectionHead idx={3}>{t.t('settings.asr')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.asrEngine')}</div>
            <div className="d">{t.t('settings.asrEngineHint')}</div>
          </div>
          <div className="seg">
            <span
              className={`seg-item ${draft.asr.engine === 'cloud' && draft.asr.cloudBaseUrl.includes('groq.com') ? 'on' : ''}`}
              onClick={() => pickRecommended()}
            >
              {t.t('settings.asrRecommended')}
            </span>
            <span
              className={`seg-item ${draft.asr.engine === 'local' ? 'on' : ''}`}
              onClick={() => setAsr({ engine: 'local' })}
            >
              {t.t('settings.asrLocal')}
            </span>
            <span
              className={`seg-item ${draft.asr.engine === 'cloud' && !draft.asr.cloudBaseUrl.includes('groq.com') ? 'on' : ''}`}
              onClick={() => setAsr({ engine: 'cloud', cloudBaseUrl: '' })}
            >
              {t.t('settings.asrCustom')}
            </span>
          </div>
        </div>

        {/* 转写语言（本地/云端通用）：中文 demo 选简体中文避免输出繁体 */}
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.asrLanguage')}</div>
            <div className="d">{t.t('settings.asrLanguageHint')}</div>
          </div>
          <select
            className="select"
            style={{ width: 220 }}
            value={draft.asr.language ?? 'auto'}
            onChange={(e) => setAsr({ language: e.target.value })}
          >
            <option value="auto">{t.t('settings.langAuto')}</option>
            <option value="zh">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="ru">Русский</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="es">Español</option>
            <option value="pt">Português</option>
            <option value="it">Italiano</option>
          </select>
        </div>

        {draft.asr.engine === 'local' ? (
          <div className="set-row">
            <div className="info">
              <div className="t">{t.t('settings.localModel')}</div>
              <div className="d">whisper.cpp 路 ggml-{draft.asr.localModel}.bin</div>
            </div>
            <div className="seg">
              {(['base', 'small', 'medium'] as const).map((m) => (
                <span
                  key={m}
                  className={`seg-item ${draft.asr.localModel === m ? 'on' : ''}`}
                  onClick={() => setAsr({ localModel: m })}
                >
                  {t.t(`settings.model${m[0].toUpperCase()}${m.slice(1)}` as never)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="set-row">
              <div className="info">
                <div className="t">{t.t('settings.cloudApiKey')}</div>
                <div className="d">
                  {draft.asr.cloudBaseUrl.includes('groq.com')
                    ? t.t('settings.groqKeyHint')
                    : t.t('settings.keyHint')}
                </div>
              </div>
              <input
                className="input"
                style={{ width: 300 }}
                type="password"
                placeholder="sk-…"
                value={draft.asr.cloudApiKey}
                onChange={(e) => setAsr({ cloudApiKey: e.target.value })}
              />
            </div>
            {draft.asr.cloudBaseUrl.includes('groq.com') && (
              <div className="set-row">
                <div className="info">
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {t.t('settings.getKey')} → console.groq.com/keys
                  </a>
                </div>
              </div>
            )}
            {!draft.asr.cloudBaseUrl.includes('groq.com') && (
              <>
                <div className="set-row">
                  <div className="info">
                    <div className="t">{t.t('settings.cloudBaseUrl')}</div>
                  </div>
                  <input
                    className="input"
                    style={{ width: 300 }}
                    value={draft.asr.cloudBaseUrl}
                    onChange={(e) => setAsr({ cloudBaseUrl: e.target.value })}
                  />
                </div>
                <div className="set-row">
                  <div className="info">
                    <div className="t">{t.t('settings.cloudModel')}</div>
                  </div>
                  <input
                    className="input"
                    style={{ width: 300 }}
                    value={draft.asr.cloudModel}
                    onChange={(e) => setAsr({ cloudModel: e.target.value })}
                  />
                </div>
              </>
            )}
          </>
        )}
      </Panel>

      <SectionHead idx={4}>{t.t('settings.ai')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.aiEngine')}</div>
            <div className="d">{t.t('settings.aiEngineHint')}</div>
          </div>
          <div className="seg">
            <span
              className={`seg-item ${draft.ai.baseUrl.includes('groq.com') ? 'on' : ''}`}
              onClick={() => pickAiRecommended()}
            >
              {t.t('settings.aiRecommended')}
            </span>
            <span
              className={`seg-item ${!draft.ai.baseUrl.includes('groq.com') ? 'on' : ''}`}
              onClick={() => setAi({ baseUrl: '' })}
            >
              {t.t('settings.aiCustom')}
            </span>
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.aiApiKey')}</div>
            <div className="d">
              {draft.ai.baseUrl.includes('groq.com')
                ? t.t('settings.groqKeyHint')
                : t.t('settings.aiHint')}
            </div>
          </div>
          <input
            className="input"
            style={{ width: 300 }}
            type="password"
            placeholder="sk-…"
            value={draft.ai.apiKey}
            onChange={(e) => setAi({ apiKey: e.target.value })}
          />
        </div>
        {draft.ai.baseUrl.includes('groq.com') && (
          <div className="set-row">
            <div className="info">
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}
              >
                {t.t('settings.getKey')} → console.groq.com/keys
              </a>
            </div>
          </div>
        )}
        {!draft.ai.baseUrl.includes('groq.com') && (
          <>
            <div className="set-row">
              <div className="info">
                <div className="t">{t.t('settings.aiBaseUrl')}</div>
                <div className="d">{t.t('settings.aiBaseUrlHint')}</div>
              </div>
              <input
                className="input"
                style={{ width: 300 }}
                value={draft.ai.baseUrl}
                onChange={(e) => setAi({ baseUrl: e.target.value })}
              />
            </div>
            <div className="set-row">
              <div className="info">
                <div className="t">{t.t('settings.aiModel')}</div>
                <div className="d">{t.t('settings.aiModelHint')}</div>
              </div>
              {aiModels ? (
                <select
                  className="input select"
                  style={{ width: 280 }}
                  value={draft.ai.model}
                  onChange={(e) => setAi({ model: e.target.value })}
                >
                  {!aiModels.includes(draft.ai.model) && (
                    <option value={draft.ai.model}>{draft.ai.model}</option>
                  )}
                  {aiModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  style={{ width: 280 }}
                  value={draft.ai.model}
                  onChange={(e) => setAi({ model: e.target.value })}
                />
              )}
              <Btn variant="ghost" size="sm" disabled={aiModelsLoading} onClick={pullModels}>
                {aiModelsLoading ? '…' : aiModels ? t.t('common.refresh') : t.t('settings.aiPullModels')}
              </Btn>
            </div>
          </>
        )}
      </Panel>

      <SectionHead idx={5}>{t.t('settings.cs2')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.cs2Path')}</div>
            <div className="d">{t.t('settings.cs2PathHint')}</div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              style={{ width: 300 }}
              placeholder="…\steamapps\common\Counter-Strike Global Offensive"
              value={draft.cs2.installPath ?? ''}
              onChange={(e) => setCs2({ installPath: e.target.value || undefined })}
            />
            <Btn
              variant="ghost"
              size="sm"
              onClick={async () => {
                const p = await window.api.app.pickDirectory()
                if (p) {
                  setCs2({ installPath: p })
                  toast.push(t.t('settings.cs2PathSet'))
                }
              }}
            >
              <IcFolder size={12} />
              {t.t('settings.cs2Browse')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={detectCs2}>
              <IcRefresh size={12} />
              {t.t('settings.cs2Detect')}
            </Btn>
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.cs2LaunchArgs')}</div>
            <div className="d">{t.t('settings.cs2LaunchArgsHint')}</div>
          </div>
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="-tools -insecure"
            value={draft.cs2.launchArgs ?? ''}
            onChange={(e) => setCs2({ launchArgs: e.target.value })}
          />
        </div>
        {/* 播放显示设置（tools 模式下生效） */}
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.playDisplay')}</div>
            <div className="d">{t.t('settings.playDisplayHint')}</div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="input select"
              style={{ width: 150 }}
              value={draft.cs2.playMode ?? 'auto'}
              onChange={(e) => setCs2({ playMode: e.target.value as never })}
            >
              <option value="auto">{t.t('settings.playModeAuto')}</option>
              <option value="fullscreen">{t.t('settings.playModeFullscreen')}</option>
              <option value="borderless">{t.t('settings.playModeBorderless')}</option>
              <option value="windowed">{t.t('settings.playModeWindowed')}</option>
            </select>
            <select
              className="input select"
              style={{ width: 130 }}
              value={draft.cs2.playResolution ?? 'auto'}
              onChange={(e) => setCs2({ playResolution: e.target.value })}
            >
              <option value="auto">{t.t('settings.playResAuto')}</option>
              <optgroup label="16:9">
                <option value="1280x720">1280×720</option>
                <option value="1920x1080">1920×1080</option>
                <option value="2560x1440">2560×1440</option>
                <option value="3840x2160">3840×2160</option>
              </optgroup>
              <optgroup label="16:10">
                <option value="1280x800">1280×800</option>
                <option value="1680x1050">1680×1050</option>
                <option value="1920x1200">1920×1200</option>
              </optgroup>
              <optgroup label="4:3">
                <option value="1024x768">1024×768</option>
                <option value="1280x960">1280×960</option>
                <option value="1440x1080">1440×1080</option>
              </optgroup>
              <optgroup label="5:4">
                <option value="1280x1024">1280×1024</option>
              </optgroup>
              <optgroup label="21:9">
                <option value="2560x1080">2560×1080</option>
                <option value="3440x1440">3440×1440</option>
              </optgroup>
            </select>
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.cs2Setup')}</div>
            <div className="d">{t.t('settings.cs2SetupHint')}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.7 }}>
              {t.t('settings.gsiWhat')}
            </div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="ghost" size="sm" onClick={installGsi}>
              {t.t('settings.gsiInstall')}
            </Btn>
            <Btn variant="accent" size="sm" onClick={launchTools}>
              {t.t('settings.cs2Launch')}
            </Btn>
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.vconsolePort')}</div>
            <div className="d">127.0.0.1:{draft.cs2.vconsolePort}</div>
          </div>
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            value={draft.cs2.vconsolePort}
            onChange={(e) => setCs2({ vconsolePort: Number(e.target.value) || 29000 })}
          />
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.gsiPort')}</div>
            <div className="d">127.0.0.1:{draft.cs2.gsiPort}</div>
          </div>
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            value={draft.cs2.gsiPort}
            onChange={(e) => setCs2({ gsiPort: Number(e.target.value) || 30070 })}
          />
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.playMode')}</div>
            <div className="d">{t.t('settings.playModeHint')}</div>
          </div>
          <div className="seg">
            <span
              className={`seg-item ${!draft.cs2.useToolsMode ? 'on' : ''}`}
              onClick={() => setCs2({ useToolsMode: false })}
            >
              {t.t('settings.playModeNormal')}
            </span>
            <span
              className={`seg-item ${draft.cs2.useToolsMode ? 'on' : ''}`}
              onClick={() => setCs2({ useToolsMode: true })}
            >
              {t.t('settings.playModeTools')}
            </span>
          </div>
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.voiceHud')}</div>
            <div className="d">{t.t('settings.voiceHudHint')}</div>
          </div>
          <Toggle
            on={!!draft.cs2.voiceHud}
            onChange={(v) => setCs2({ voiceHud: v })}
            disabled={draft.cs2.useToolsMode}
          />
        </div>
      </Panel>

      <SectionHead idx={6}>{t.t('settings.engines')}</SectionHead>
      <Panel>
        <div className="set-row">
          <div className="info">
            <div className="d">{t.t('settings.enginesHint')}</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={refreshEngines}>
            {t.t('common.refresh')}
          </Btn>
        </div>
        {ENGINE_ROWS.map((row) => {
          const installed = engStatus[row.kind]
          const isThisDownloading =
            engProgress &&
            (engProgress.what === row.kind ||
              (row.kind === 'whisper' && (engProgress.what === 'whisper-cli' || engProgress.what === 'whisper')) ||
              (row.kind.startsWith('model-') && engProgress.what.includes(row.kind.replace('model-', ''))))
          const prog =
            isThisDownloading && engProgress
              ? Math.min(100, Math.round((engProgress.received / Math.max(1, engProgress.total)) * 100))
              : null
          const receivedMB = isThisDownloading && engProgress ? (engProgress.received / 1024 / 1024).toFixed(1) : '0'
          const totalMB = isThisDownloading && engProgress && engProgress.total > 0 ? (engProgress.total / 1024 / 1024).toFixed(1) : '?'

          return (
            <div key={row.kind} className="set-row">
              <div className="info" style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{t.t(row.label as never)}</div>
                {prog !== null && (
                  <div style={{ marginTop: 6, maxWidth: 360 }}>
                    <div className="flex" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)', marginBottom: 3 }}>
                      <span>{t.tf('settings.engDownloading', { pct: prog })}</span>
                      <span className="mono">{receivedMB} MB / {totalMB} MB</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-3)', position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${prog}%`,
                          background: 'linear-gradient(90deg, var(--green), var(--ct))',
                          transition: 'width .2s var(--ease-out)'
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
              {installed ? (
                <Tag tone="voice" dot>
                  {t.t('settings.engInstalled')}
                </Tag>
              ) : prog !== null || downloadingKind === row.kind ? (
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {prog !== null ? `${prog}%` : '准备中…'}
                </span>
              ) : (
                <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                  <Tag tone="ghost">{t.t('settings.engMissing')}</Tag>
                  <Btn variant="accent" size="sm" disabled={!!downloadingKind} onClick={() => ensureEngine(row.kind)}>
                    {t.t('settings.engDownload')}
                  </Btn>
                </div>
              )}
            </div>
          )
        })}
      </Panel>

      <SectionHead idx={8}>{t.t('settings.about')}</SectionHead>
      <Panel>
        <div className="panel-bd">
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            {t.t('settings.aboutText')}
          </div>
          <div className="flex" style={{ gap: 8, marginTop: 10 }}>
            <Tag tone="ghost">v{version ?? '1.0.0'}</Tag>
            <Tag tone="ghost">MIT</Tag>
          </div>
        </div>
      </Panel>

      {/* 推荐免费（Groq）声明弹窗 */}
      {showRecModal && (
        <Modal
          title={t.t('settings.recTitle')}
          body={t.t('settings.recBody')}
          confirmLabel={t.t('settings.recConfirm')}
          onClose={() => setShowRecModal(false)}
          onConfirm={confirmRecommended}
        />
      )}
      {/* AI 推荐免费（Groq llama）声明弹窗 */}
      {showAiRecModal && (
        <Modal
          title={t.t('settings.aiRecTitle')}
          body={t.t('settings.aiRecBody')}
          confirmLabel={t.t('settings.aiRecConfirm')}
          onClose={() => setShowAiRecModal(false)}
          onConfirm={confirmAiRecommended}
        />
      )}
    </div>
  )
}
