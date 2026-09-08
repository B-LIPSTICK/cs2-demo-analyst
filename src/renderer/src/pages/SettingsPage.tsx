import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn, CustomSelect, IcFolder, IcPlus, IcRefresh, Panel, SectionHead, Tag, Toggle, useToast } from '@/components/ui'
import { useT, type Lang } from '@/i18n'
import type { Settings } from '@shared/types'
import { formatRootLabel } from './LibraryPage'

const OFFLINE_SOURCES = [
  {
    title: 'whisper.cpp 模型仓库（HuggingFace）',
    desc: '官方模型源：下载 ggml-base.bin / small.bin / medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
  },
  {
    title: 'HF-Mirror 国内镜像加速',
    desc: '国内直连免翻墙镜像：高速下载 whisper 语音模型',
    url: 'https://hf-mirror.com/ggerganov/whisper.cpp/tree/main'
  },
  {
    title: 'whisper.cpp Releases',
    desc: '官方程序包：下载 whisper-cli.exe（解压放入 whisper/ 根目录）',
    url: 'https://github.com/ggml-org/whisper.cpp/releases'
  },
  {
    title: 'csgove Releases',
    desc: '官方提取器：下载 csgove.exe（解压放入 csgove/ 根目录）',
    url: 'https://github.com/akiver/csgo-voice-extractor/releases'
  }
]

/** 弹窗：createPortal 到 body，fixed 相对视口居中（避免被 .page 的 transform 动画干扰） */
function Modal({
  title,
  body,
  onClose,
  onConfirm,
  confirmLabel,
  extraButton
}: {
  title: string
  body: ReactNode
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  extraButton?: ReactNode
}) {
  const t = useT()
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 14,
          padding: 24,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
          userSelect: 'text'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, userSelect: 'text' }}>{title}</div>
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.7,
            overflowY: 'auto',
            paddingRight: 4,
            userSelect: 'text'
          }}
        >
          {typeof body === 'string' ? (
            <div className="muted" style={{ whiteSpace: 'pre-line', userSelect: 'text' }}>
              {body}
            </div>
          ) : (
            body
          )}
        </div>
        <div
          className="flex"
          style={{
            gap: 8,
            marginTop: 20,
            justifyContent: 'flex-end',
            alignItems: 'center',
            userSelect: 'none',
            flexShrink: 0
          }}
        >
          {extraButton}
          <div style={{ flex: 1 }} />
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

  const cancelEngineDownload = async (kind: string) => {
    try {
      await window.api.engines.cancel(kind)
      toast.push(t.t('settings.cancelDownload'))
    } catch {
      /* ignore */
    } finally {
      refreshEngines()
    }
  }

  const openEnginesDir = async () => {
    try {
      await window.api.engines.openFolder()
      toast.push(t.t('settings.openEnginesDir'))
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const [showOfflineModal, setShowOfflineModal] = useState(false)

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.push('已复制链接到剪贴板', 'ok'),
      () => toast.push('复制失败，请手动选择复制', 'warn')
    )
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
          <CustomSelect
            width={220}
            value={draft.asr.language ?? 'auto'}
            options={[
              { value: 'auto', label: t.t('settings.langAuto'), sublabel: 'Auto' },
              { value: 'zh', label: '简体中文', sublabel: 'zh' },
              { value: 'en', label: 'English', sublabel: 'en' },
              { value: 'ja', label: '日本語', sublabel: 'ja' },
              { value: 'ko', label: '한국어', sublabel: 'ko' },
              { value: 'ru', label: 'Русский', sublabel: 'ru' },
              { value: 'fr', label: 'Français', sublabel: 'fr' },
              { value: 'de', label: 'Deutsch', sublabel: 'de' },
              { value: 'es', label: 'Español', sublabel: 'es' },
              { value: 'pt', label: 'Português', sublabel: 'pt' },
              { value: 'it', label: 'Italiano', sublabel: 'it' }
            ]}
            onChange={(v) => setAsr({ language: v })}
          />
        </div>

        {draft.asr.engine === 'local' ? (
          <div className="set-row">
            <div className="info">
              <div className="t">{t.t('settings.localModel')}</div>
              <div className="d">whisper.cpp · ggml-{draft.asr.localModel}.bin</div>
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
                <CustomSelect
                  width={280}
                  value={draft.ai.model}
                  options={[
                    ...(!aiModels.includes(draft.ai.model) ? [{ value: draft.ai.model, label: draft.ai.model }] : []),
                    ...aiModels.map((m) => ({ value: m, label: m }))
                  ]}
                  onChange={(v) => setAi({ model: v })}
                />
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
            <CustomSelect
              width={150}
              value={draft.cs2.playMode ?? 'auto'}
              options={[
                { value: 'auto', label: t.t('settings.playModeAuto') },
                { value: 'fullscreen', label: t.t('settings.playModeFullscreen') },
                { value: 'borderless', label: t.t('settings.playModeBorderless') },
                { value: 'windowed', label: t.t('settings.playModeWindowed') }
              ]}
              onChange={(v) => setCs2({ playMode: v as never })}
            />
            <CustomSelect
              width={145}
              value={draft.cs2.playResolution ?? 'auto'}
              options={[
                { value: 'auto', label: t.t('settings.playResAuto') },
                { value: '1920x1080', label: '1920×1080', sublabel: '16:9' },
                { value: '2560x1440', label: '2560×1440', sublabel: '16:9' },
                { value: '3840x2160', label: '3840×2160', sublabel: '16:9' },
                { value: '1280x720', label: '1280×720', sublabel: '16:9' },
                { value: '1280x960', label: '1280×960', sublabel: '4:3' },
                { value: '1024x768', label: '1024×768', sublabel: '4:3' },
                { value: '1440x1080', label: '1440×1080', sublabel: '4:3' },
                { value: '1280x1024', label: '1280×1024', sublabel: '5:4' },
                { value: '1920x1200', label: '1920×1200', sublabel: '16:10' },
                { value: '1680x1050', label: '1680×1050', sublabel: '16:10' },
                { value: '1280x800', label: '1280×800', sublabel: '16:10' },
                { value: '2560x1080', label: '2560×1080', sublabel: '21:9' },
                { value: '3440x1440', label: '3440×1440', sublabel: '21:9' }
              ]}
              onChange={(v) => setCs2({ playResolution: v })}
            />
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
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowOfflineModal(true)}>
              💡 {t.t('settings.offlineGuide')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={openEnginesDir}>
              <IcFolder size={12} />
              {t.t('settings.openEnginesDir')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={refreshEngines}>
              <IcRefresh size={12} />
              {t.t('common.refresh')}
            </Btn>
          </div>
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
                <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {prog !== null ? `${prog}%` : '准备中…'}
                  </span>
                  <Btn variant="ghost" size="sm" onClick={() => cancelEngineDownload(row.kind)}>
                    {t.t('settings.cancelDownload')}
                  </Btn>
                </div>
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

      {/* 离线模型安装说明弹窗 */}
      {showOfflineModal && (
        <Modal
          title={t.t('settings.offlineGuideTitle')}
          confirmLabel={t.t('common.confirm')}
          extraButton={
            <Btn variant="ghost" size="sm" onClick={openEnginesDir}>
              <IcFolder size={12} />
              {t.t('settings.openEnginesDir')}
            </Btn>
          }
          onClose={() => setShowOfflineModal(false)}
          onConfirm={() => setShowOfflineModal(false)}
          body={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-0)' }}>
                  【本地模型与引擎离线放置步骤】
                </div>
                <div style={{ color: 'var(--text-1)', lineHeight: 1.8 }}>
                  <div>
                    1. 点击下方「打开模型目录」按钮（或资源管理器直接进入{' '}
                    <code style={{ userSelect: 'text', background: 'var(--field-bg)', padding: '2px 6px', borderRadius: 4 }}>
                      %APPDATA%/cs2-demo-analyst/engines/
                    </code>
                    ）。
                  </div>
                  <div>2. 将下载好的对应文件放入子目录：</div>
                  <div style={{ paddingLeft: 12 }}>
                    <div>
                      • <b>whisper 语音模型</b>（<code>ggml-base.bin</code> / <code>ggml-small.bin</code> / <code>ggml-medium.bin</code>）<br />
                      👉 放入 <code>whisper/models/</code> 目录中
                    </div>
                    <div>
                      • <b>whisper-cli.exe</b>（本地转写执行程序）<br />
                      👉 放入 <code>whisper/</code> 根目录中
                    </div>
                    <div>
                      • <b>csgove.exe</b>（CS2 语音提取工具）<br />
                      👉 放入 <code>csgove/</code> 根目录中
                    </div>
                  </div>
                  <div style={{ marginTop: 4 }}>3. 放置完成后回到设置页，点击「刷新」按钮，对应项即刻显示为「就绪」！</div>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-0)' }}>
                  【下载源推荐（支持一键访问或复制链接）】
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {OFFLINE_SOURCES.map((s) => (
                    <div
                      key={s.url}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 12px',
                        background: 'var(--field-bg)',
                        border: '1px solid var(--line-1)',
                        borderRadius: 8
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-0)' }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>{s.desc}</div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--accent)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            userSelect: 'text'
                          }}
                        >
                          {s.url}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <Btn variant="ghost" size="sm" onClick={() => copyUrl(s.url)}>
                          复制
                        </Btn>
                        <Btn variant="primary" size="sm" onClick={() => window.api.app.openUrl(s.url)}>
                          访问
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
        />
      )}

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
