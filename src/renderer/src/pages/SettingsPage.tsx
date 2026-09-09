import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

type AiProviderKey = 'siliconflow' | 'zhipu' | 'groq' | 'custom'

interface AiProviderDef {
  key: AiProviderKey
  name: string
  labelKey: string
  baseUrl: string
  defaultModel: string
  keyUrl: string
  keyUrlText: string
  presetModels: string[]
  badge: string
  descKey: string
}

const AI_PROVIDERS: AiProviderDef[] = [
  {
    key: 'siliconflow',
    name: '硅基流动',
    labelKey: 'settings.aiProviderSiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyUrlText: 'cloud.siliconflow.cn/account/ak',
    presetModels: [
      'Qwen/Qwen2.5-7B-Instruct',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
      'deepseek-ai/DeepSeek-V3',
      'THUDM/glm-4-9b-chat',
      'internlm/internlm2_5-7b-chat'
    ],
    badge: '国内免翻 · 永久免费模型',
    descKey: 'settings.aiSiliconFlowHint'
  },
  {
    key: 'zhipu',
    name: '智谱 AI',
    labelKey: 'settings.aiProviderZhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyUrlText: 'open.bigmodel.cn/usercenter/apikeys',
    presetModels: ['glm-4-flash', 'glm-4-flashx', 'glm-4-plus', 'glm-4-air', 'glm-4-long'],
    badge: '国内免翻 · GLM-4-Flash 免费',
    descKey: 'settings.aiZhipuHint'
  },
  {
    key: 'groq',
    name: 'Groq',
    labelKey: 'settings.aiProviderGroq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    keyUrl: 'https://console.groq.com/keys',
    keyUrlText: 'console.groq.com/keys',
    presetModels: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    badge: '海外高速 · 需梯子/代理',
    descKey: 'settings.aiGroqHint'
  },
  {
    key: 'custom',
    name: '自定义 API',
    labelKey: 'settings.aiProviderCustom',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
    keyUrlText: '',
    presetModels: [],
    badge: '兼容 OpenAI 规范',
    descKey: 'settings.aiBaseUrlHint'
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

/** 可编辑 + 下拉快速挑选的 AI 模型选择器（Combobox） */
function ModelCombobox({
  value,
  onChange,
  presets,
  pulledModels,
  loading,
  onPull,
  t
}: {
  value: string
  onChange: (val: string) => void
  presets: string[]
  pulledModels: string[] | null
  loading: boolean
  onPull: () => void
  t: (key: any) => string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDocClick, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDocClick, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 聚合拉取模型与推荐预设（自动去重并分组）
  const modelGroups = useMemo(() => {
    const set = new Set<string>()
    const groups: { title: string; items: string[] }[] = []
    if (pulledModels && pulledModels.length > 0) {
      groups.push({ title: `在线拉取模型 (${pulledModels.length})`, items: pulledModels })
      for (const m of pulledModels) set.add(m)
    }
    const filteredPresets = presets.filter((p) => !set.has(p))
    if (filteredPresets.length > 0) {
      groups.push({ title: '推荐预设模型', items: filteredPresets })
    }
    return groups
  }, [pulledModels, presets])

  const hasOptions = modelGroups.length > 0

  return (
    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', width: 280 }}>
        <input
          className="input"
          style={{ width: '100%', paddingRight: hasOptions ? 30 : 10 }}
          placeholder="例如: Qwen/Qwen2.5-7B-Instruct"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (hasOptions) setOpen(true)
          }}
        />
        {hasOptions && (
          <button
            type="button"
            className="cs-trigger"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 30,
              padding: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={() => setOpen((v) => !v)}
            title="展开候选模型列表"
          >
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
        )}
        {open && hasOptions && (
          <div
            className="custom-select-menu"
            style={{
              maxHeight: 280,
              overflowY: 'auto',
              top: 'calc(100% + 4px)',
              width: '100%',
              zIndex: 100
            }}
          >
            {modelGroups.map((g) => (
              <div key={g.title}>
                <div
                  style={{
                    padding: '8px 10px 4px',
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: 'var(--accent)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}
                >
                  {g.title}
                </div>
                {g.items.map((m) => {
                  const isSelected = m === value
                  return (
                    <div
                      key={m}
                      className={`cs-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        onChange(m)
                        setOpen(false)
                      }}
                      title={m}
                    >
                      <div className="cs-item-content">
                        <span className="cs-item-label" style={{ fontSize: 12 }}>{m}</span>
                      </div>
                      {isSelected && (
                        <svg className="cs-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                        </svg>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <Btn variant="ghost" size="sm" disabled={loading} onClick={onPull}>
        {loading ? '…' : pulledModels ? t('common.refresh') : t('settings.aiPullModels')}
      </Btn>
    </div>
  )
}

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

  const setAi = (patch: Partial<Settings['ai']>) => {
    set({ ai: { ...draft.ai, ...patch } })
  }

  const currentAiProviderKey: AiProviderKey = useMemo(() => {
    const url = draft.ai?.baseUrl || ''
    if (url.includes('siliconflow.cn')) return 'siliconflow'
    if (url.includes('bigmodel.cn')) return 'zhipu'
    if (url.includes('groq.com')) return 'groq'
    return 'custom'
  }, [draft.ai?.baseUrl])

  const currentAiProvider = AI_PROVIDERS.find((p) => p.key === currentAiProviderKey) ?? AI_PROVIDERS[3]

  const switchAiProvider = (key: AiProviderKey) => {
    const target = AI_PROVIDERS.find((p) => p.key === key)
    if (!target) return
    if (target.key === 'custom') {
      setAi({ baseUrl: draft.ai.baseUrl || 'https://api.openai.com/v1' })
    } else {
      setAi({
        baseUrl: target.baseUrl,
        model: target.defaultModel
      })
    }
    toast.push(t.tf('settings.aiProviderSwitched', { name: target.name }))
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

  const launchCs2 = async () => {
    const r = await window.api.live.launch({
      toolsMode: (draft.cs2.playMode ?? 'tools') !== 'native'
    })
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
          <CustomSelect
            width={280}
            value={currentAiProviderKey}
            options={AI_PROVIDERS.map((p) => ({
              value: p.key,
              label: t.t(p.labelKey as never)
            }))}
            onChange={(v) => switchAiProvider(v as AiProviderKey)}
          />
        </div>

        {/* 快捷 Key 获取与说明卡片 */}
        {currentAiProvider.keyUrl && (
          <div
            style={{
              margin: '6px 0 14px',
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--line-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-0)' }}>
                  {currentAiProvider.name}
                </span>
                <Tag tone="voice">{currentAiProvider.badge}</Tag>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>
                {t.t(currentAiProvider.descKey as never)}
              </div>
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
                {currentAiProvider.keyUrlText}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <Btn variant="ghost" size="sm" onClick={() => copyUrl(currentAiProvider.keyUrl)}>
                复制
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                onClick={() => window.api.app.openUrl(currentAiProvider.keyUrl)}
              >
                前往获取 Key
              </Btn>
            </div>
          </div>
        )}

        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.aiApiKey')}</div>
            <div className="d">
              {currentAiProvider.key === 'siliconflow'
                ? '填入以 sk- 开头的硅基流动 API Key'
                : currentAiProvider.key === 'groq'
                  ? '填入以 gsk_ 开头的 Groq API Key'
                  : '填入对应服务商的 API 密钥'}
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

        {/* 自定义 API 或 Base URL 修改 */}
        {(currentAiProvider.key === 'custom' || !currentAiProvider.baseUrl) && (
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
        )}

        {/* 模型选择 */}
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.aiModel')}</div>
            <div className="d">{t.t('settings.aiModelHint')}</div>
          </div>
          <ModelCombobox
            value={draft.ai.model}
            onChange={(m) => setAi({ model: m })}
            presets={currentAiProvider.presetModels}
            pulledModels={aiModels}
            loading={aiModelsLoading}
            onPull={pullModels}
            t={t.t}
          />
        </div>
      </Panel>

      <SectionHead idx={5}>{t.t('settings.cs2')}</SectionHead>
      <Panel>
        {/* Demo 播放模式 */}
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.cs2PlayMode')}</div>
            <div className="d">{t.t('settings.cs2PlayModeHint')}</div>
          </div>
          <div className="seg">
            <span
              className={`seg-item ${(draft.cs2.playMode ?? 'tools') === 'tools' ? 'on' : ''}`}
              onClick={() => setCs2({ playMode: 'tools' })}
            >
              ⚡ {t.t('settings.cs2PlayModeTools')}
            </span>
            <span
              className={`seg-item ${(draft.cs2.playMode ?? 'tools') === 'native' ? 'on' : ''}`}
              onClick={() => setCs2({ playMode: 'native' })}
            >
              {t.t('settings.cs2PlayModeNative')}
            </span>
          </div>
        </div>

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
            placeholder="-novid"
            value={draft.cs2.launchArgs ?? ''}
            onChange={(e) => setCs2({ launchArgs: e.target.value })}
          />
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.voiceHud')}</div>
            <div className="d">{t.t('settings.voiceHudHint')}</div>
          </div>
          <Toggle
            on={!!draft.cs2.voiceHud}
            onChange={(v) => setCs2({ voiceHud: v })}
          />
        </div>
        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.cs2Setup')}</div>
            <div className="d">{t.t('settings.cs2SetupHint')}</div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="accent" size="sm" onClick={launchCs2}>
              {t.t('settings.cs2Launch')}
            </Btn>
          </div>
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

      <SectionHead idx={7}>{t.t('settings.about')}</SectionHead>
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

    </div>
  )
}
