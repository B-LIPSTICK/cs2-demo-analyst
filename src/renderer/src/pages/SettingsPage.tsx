import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn, CustomSelect, IcFolder, IcMicOff, IcPlus, IcRadar, IcRefresh, Led, Panel, SectionHead, Tag, useFloatingPosition, useToast } from '@/components/ui'
import { useT, type Lang } from '@/i18n'
import type { Settings, SteamSafetyReport } from '@shared/types'
import { formatRootLabel } from './LibraryPage'

const OFFLINE_SOURCES = [
  {
    titleKey: 'settings.offlineSourceWhisperTitle',
    descKey: 'settings.offlineSourceWhisperDesc',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'
  },
  {
    titleKey: 'settings.offlineSourceMirrorTitle',
    descKey: 'settings.offlineSourceMirrorDesc',
    url: 'https://hf-mirror.com/ggerganov/whisper.cpp/tree/main'
  },
  {
    titleKey: 'settings.offlineSourceWhisperCliTitle',
    descKey: 'settings.offlineSourceWhisperCliDesc',
    url: 'https://github.com/ggml-org/whisper.cpp/releases'
  },
  {
    titleKey: 'settings.offlineSourceCsgoveTitle',
    descKey: 'settings.offlineSourceCsgoveDesc',
    url: 'https://github.com/akiver/csgo-voice-extractor/releases'
  }
]

type AiProviderKey = 'siliconflow' | 'zhipu' | 'groq' | 'custom'

interface AiProviderDef {
  key: AiProviderKey
  nameKey: string
  labelKey: string
  baseUrl: string
  defaultModel: string
  keyUrl: string
  keyUrlText: string
  presetModels: string[]
  badgeKey: string
  descKey: string
}

const AI_PROVIDERS: AiProviderDef[] = [
  {
    key: 'siliconflow',
    nameKey: 'settings.aiProviderSiliconFlowShort',
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
    badgeKey: 'settings.aiBadgeSiliconFlow',
    descKey: 'settings.aiSiliconFlowHint'
  },
  {
    key: 'zhipu',
    nameKey: 'settings.aiProviderZhipuShort',
    labelKey: 'settings.aiProviderZhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    keyUrl: 'https://open.bigmodel.cn/apikey/platform',
    keyUrlText: 'open.bigmodel.cn/apikey/platform',
    presetModels: ['glm-4-flash', 'glm-4-flashx', 'glm-4-plus', 'glm-4-air', 'glm-4-long'],
    badgeKey: 'settings.aiBadgeZhipu',
    descKey: 'settings.aiZhipuHint'
  },
  {
    key: 'groq',
    nameKey: 'settings.aiProviderGroqShort',
    labelKey: 'settings.aiProviderGroq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    keyUrl: 'https://console.groq.com/keys',
    keyUrlText: 'console.groq.com/keys',
    presetModels: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    badgeKey: 'settings.aiBadgeGroq',
    descKey: 'settings.aiGroqHint'
  },
  {
    key: 'custom',
    nameKey: 'settings.aiProviderCustomShort',
    labelKey: 'settings.aiProviderCustom',
    baseUrl: '',
    defaultModel: '',
    keyUrl: '',
    keyUrlText: '',
    presetModels: [],
    badgeKey: 'settings.aiBadgeCustom',
    descKey: 'settings.aiBaseUrlHint'
  }
]

const SETTINGS_SAVE_DEBOUNCE_MS = 300

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 合并设置补丁：普通对象递归合并，数组整体替换 */
function mergeRecord(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const cur = out[key]
    if (isPlainObject(cur) && isPlainObject(value)) {
      out[key] = mergeRecord(cur, value)
    } else {
      out[key] = value
    }
  }
  return out
}

function mergeSettingsPatch(base: Partial<Settings>, patch: Partial<Settings>): Partial<Settings> {
  return mergeRecord(
    base as Record<string, unknown>,
    patch as Record<string, unknown>
  ) as Partial<Settings>
}

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
  onSelect,
  onFocus,
  onBlur,
  presets,
  pulledModels,
  loading,
  onPull,
  t
}: {
  value: string
  onChange: (val: string) => void
  onSelect?: (val: string) => void
  onFocus?: () => void
  onBlur?: () => void
  presets: string[]
  pulledModels: string[] | null
  loading: boolean
  onPull: () => void
  t: (key: any) => string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { coords } = useFloatingPosition(containerRef, open, { minWidth: 280, defaultMaxHeight: 320 })

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDocClick, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDocClick, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // 拉取到新模型列表后自动展开，方便用户直接查看和选择
  useEffect(() => {
    if (pulledModels && pulledModels.length > 0) {
      setOpen(true)
    }
  }, [pulledModels])

  // 聚合拉取模型与推荐预设（自动去重并分组）
  const modelGroups = useMemo(() => {
    const set = new Set<string>()
    const groups: { title: string; items: string[] }[] = []
    if (pulledModels && pulledModels.length > 0) {
      groups.push({ title: t('settings.aiGroupPulled').replace('{n}', String(pulledModels.length)), items: pulledModels })
      for (const m of pulledModels) set.add(m)
    }
    const filteredPresets = presets.filter((p) => !set.has(p))
    if (filteredPresets.length > 0) {
      groups.push({ title: t('settings.aiGroupPreset'), items: filteredPresets })
    }
    return groups
  }, [pulledModels, presets, t])

  const hasOptions = modelGroups.length > 0

  return (
    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', width: 280 }}>
        <input
          className="input"
          style={{ width: '100%', paddingRight: hasOptions ? 30 : 10 }}
          placeholder={t('settings.aiModelPlaceholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            onFocus?.()
            if (hasOptions) setOpen(true)
          }}
          onBlur={onBlur}
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
            title={t('settings.aiModelExpand')}
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
        {open &&
          hasOptions &&
          createPortal(
            <div
              ref={menuRef}
              className="custom-select-menu"
              style={{
                position: 'fixed',
                left: coords.left,
                ...(coords.openUp ? { bottom: coords.bottom } : { top: coords.top }),
                width: coords.width,
                minWidth: 'unset',
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: coords.maxHeight,
                zIndex: 99999,
                overflowY: 'auto'
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
                          if (onSelect) onSelect(m)
                          else onChange(m)
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
            </div>,
            document.body
          )}
      </div>
      <Btn variant="ghost" size="sm" disabled={loading} onClick={onPull} title={t('settings.aiPullHint')}>
        <IcRefresh size={13} className={loading ? 'spin' : ''} />
        <span style={{ marginLeft: 4 }}>
          {loading ? t('settings.aiModelsFetching') : pulledModels ? t('common.refresh') : t('settings.aiPullModels')}
        </span>
      </Btn>
    </div>
  )
}

export function SettingsPage({ settings, version }: { settings: Settings; version?: string }) {
  const t = useT()
  const toast = useToast()
  const [draft, setDraft] = useState<Settings>(settings)
  const draftRef = useRef<Settings>(settings)
  const settingsRef = useRef<Settings>(settings)
  const pendingPatchRef = useRef<Partial<Settings> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isEditingRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const saveAgainRef = useRef(false)
  const saveFailedRef = useRef(false)
  const saveWaitersRef = useRef<Array<() => void>>([])
  const mountedRef = useRef(true)
  const pageRef = useRef<HTMLDivElement>(null)
  const [engStatus, setEngStatus] = useState<Record<string, boolean>>({})
  const [engProgress, setEngProgress] = useState<{ what: string; received: number; total: number } | null>(null)
  const [downloadingKind, setDownloadingKind] = useState<string | null>(null)
  const [aiModels, setAiModels] = useState<string[] | null>(null)
  const [aiModelsLoading, setAiModelsLoading] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const [steamSafety, setSteamSafety] = useState<SteamSafetyReport | null>(null)
  const [safetyLoading, setSafetyLoading] = useState(false)
  const [showInjectConfirm, setShowInjectConfirm] = useState(false)

  // 外部 settings 变化：仅在非编辑、无待保存/在途请求时同步 draft，
  // 避免自己保存后的 settings:changed 覆盖正在输入的内容。
  useEffect(() => {
    settingsRef.current = settings
    // 条件渲染可能让输入框直接卸载而不触发 blur，这里以真实焦点兜底。
    const active = document.activeElement
    const editingText =
      isEditingRef.current &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      pageRef.current?.contains(active) === true
    if (editingText || pendingPatchRef.current || saveInFlightRef.current) return
    draftRef.current = settings
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    window.api.app.dataDir().then(setDataDir).catch(() => {})
    window.api.engines.status().then(setEngStatus).catch(() => {})
    // 设置页打开时做一次只读自检，不修改游戏文件。
    window.api.live.steamSafety().then(setSteamSafety).catch(() => {})
    const off = window.api.onEvent('engine:progress', (e) => {
      setEngProgress({ what: e.what, received: e.received, total: e.total })
    })
    return off
  }, [])

  // 本地 draft 同步更新 ref，保证连续快速输入时合并的是最新值而不是旧闭包。
  const applyDraft = (next: Settings): Settings => {
    draftRef.current = next
    setDraft(next)
    return next
  }

  // 待保存补丁：同一轮防抖内的多个字段修改会合并成一次 settings:set。
  const enqueuePending = (patch: Partial<Settings>) => {
    pendingPatchRef.current = mergeSettingsPatch(pendingPatchRef.current ?? {}, patch)
  }

  // 保存队列空闲时唤醒等待者；失败且补丁已回填时也唤醒，由调用方判断结果。
  const notifySaveIdle = () => {
    if (saveInFlightRef.current) return
    if (pendingPatchRef.current && !saveFailedRef.current) return
    const waiters = saveWaitersRef.current
    saveWaitersRef.current = []
    for (const resolve of waiters) resolve()
  }

  // 真正发送保存请求；同一时刻只允许一个在途请求，期间的新修改合并后再发。
  async function flushPending(): Promise<void> {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (saveInFlightRef.current) {
      saveAgainRef.current = true
      return
    }
    const patch = pendingPatchRef.current
    if (!patch) {
      notifySaveIdle()
      return
    }
    pendingPatchRef.current = null
    saveInFlightRef.current = true
    saveAgainRef.current = false
    try {
      const saved = await window.api.settings.set(patch)
      settingsRef.current = saved
      saveFailedRef.current = false
      if (mountedRef.current) toast.push(t.t('settings.save'))
    } catch (err) {
      // 写失败：把补丁合并回待保存区（较新的输入优先），本地 draft 保持不变。
      pendingPatchRef.current = mergeSettingsPatch(patch, pendingPatchRef.current ?? {})
      saveFailedRef.current = true
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.push(`${t.t('common.error')}: ${msg}`, 'err')
      }
    } finally {
      saveInFlightRef.current = false
      const shouldRetry = saveAgainRef.current && !saveFailedRef.current && pendingPatchRef.current
      saveAgainRef.current = false
      if (shouldRetry) void flushPending()
      notifySaveIdle()
    }
  }

  // 动作前等待待保存内容真正落盘（例如启动 CS2、拉取模型都由主进程读 settings.json）。
  const waitForPendingSave = async (): Promise<boolean> => {
    if (!pendingPatchRef.current && !saveInFlightRef.current) return !saveFailedRef.current
    await new Promise<void>((resolve) => {
      saveWaitersRef.current.push(resolve)
      void flushPending()
    })
    if (pendingPatchRef.current && !saveFailedRef.current) {
      return waitForPendingSave()
    }
    return !saveFailedRef.current && !pendingPatchRef.current
  }

  // 文本输入：本地立即更新，300ms 防抖后保存；失焦时立即 flush。
  const queueTextPatch = (patch: Partial<Settings>) => {
    enqueuePending(patch)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void flushPending()
    }, SETTINGS_SAVE_DEBOUNCE_MS)
  }

  // 开关/选择：立即保存；若此时还有文本防抖待保存，合并成一次写入。
  const saveImmediate = (patch: Partial<Settings>) => {
    enqueuePending(patch)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    void flushPending()
  }

  const beginTextEdit = () => {
    isEditingRef.current = true
  }

  const endTextEdit = () => {
    isEditingRef.current = false
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (pendingPatchRef.current) {
      void flushPending()
    } else if (!saveInFlightRef.current) {
      // 聚焦期间可能跳过了外部 settings:changed，失焦后补一次同步。
      draftRef.current = settingsRef.current
      setDraft(settingsRef.current)
    }
  }

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
      () => toast.push(t.t('settings.copyOk'), 'ok'),
      () => toast.push(t.t('settings.copyFail'), 'warn')
    )
  }

  const set = (patch: Partial<Settings>) => {
    applyDraft(mergeSettingsPatch(draftRef.current, patch) as Settings)
    saveImmediate(patch)
  }

  const setUi = (patch: Partial<Settings['ui']>) => {
    const nextUi: Settings['ui'] = { ...draftRef.current.ui, ...patch }
    applyDraft({ ...draftRef.current, ui: nextUi })
    saveImmediate({ ui: nextUi })
  }

  const setAsr = (patch: Partial<Settings['asr']>) => {
    const nextAsr: Settings['asr'] = { ...draftRef.current.asr, ...patch }
    applyDraft({ ...draftRef.current, asr: nextAsr })
    saveImmediate({ asr: nextAsr })
  }

  const setAsrText = (field: 'cloudApiKey' | 'cloudBaseUrl' | 'cloudModel', value: string) => {
    const nextAsr: Settings['asr'] = { ...draftRef.current.asr, [field]: value }
    applyDraft({ ...draftRef.current, asr: nextAsr })
    queueTextPatch({ asr: nextAsr })
  }

  // 推荐免费（Groq）声明弹窗
  const [showRecModal, setShowRecModal] = useState(false)
  const pickRecommended = () => {
    if (draftRef.current.asr.engine === 'cloud' && draftRef.current.asr.cloudBaseUrl.includes('groq.com')) {
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
    const nextAi: Settings['ai'] = { ...draftRef.current.ai, ...patch }
    applyDraft({ ...draftRef.current, ai: nextAi })
    saveImmediate({ ai: nextAi })
  }

  const setAiText = (field: 'apiKey' | 'baseUrl' | 'model', value: string) => {
    const nextAi: Settings['ai'] = { ...draftRef.current.ai, [field]: value }
    applyDraft({ ...draftRef.current, ai: nextAi })
    queueTextPatch({ ai: nextAi })
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
      setAi({ baseUrl: draftRef.current.ai.baseUrl || 'https://api.openai.com/v1' })
    } else {
      setAi({
        baseUrl: target.baseUrl,
        model: target.defaultModel
      })
    }
    toast.push(t.tf('settings.aiProviderSwitched', { name: t.t(target.nameKey as never) }))
  }

  const pullModels = async () => {
    if (!draftRef.current.ai.apiKey) {
      toast.push(t.t('settings.aiKeyFirst'), 'warn')
      return
    }
    setAiModelsLoading(true)
    try {
      // 主进程按已落盘配置拉取模型，先确保防抖中的输入已经保存。
      if (!(await waitForPendingSave())) return
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
    const nextCs2: Settings['cs2'] = { ...draftRef.current.cs2, ...patch }
    applyDraft({ ...draftRef.current, cs2: nextCs2 })
    saveImmediate({ cs2: nextCs2 })
  }

  const setCs2Text = (field: 'installPath' | 'launchArgs', value: string | undefined) => {
    const nextCs2: Settings['cs2'] = { ...draftRef.current.cs2, [field]: value }
    applyDraft({ ...draftRef.current, cs2: nextCs2 })
    queueTextPatch({ cs2: nextCs2 })
  }

  const setOverlay = (patch: Partial<NonNullable<Settings['overlay']>>) => {
    const nextOverlay: NonNullable<Settings['overlay']> = { ...draftRef.current.overlay, ...patch }
    applyDraft({ ...draftRef.current, overlay: nextOverlay })
    saveImmediate({ overlay: nextOverlay })
  }

  const [newMutedInput, setNewMutedInput] = useState('')

  const addMutedPlayer = () => {
    const val = newMutedInput.trim()
    if (!val) return
    const cur = draftRef.current.overlay?.mutedPlayers ?? []
    if (cur.includes(val)) {
      toast.push(t.t('settings.mutedExists'), 'warn')
      return
    }
    setOverlay({ mutedPlayers: [...cur, val] })
    setNewMutedInput('')
    toast.push(t.tf('settings.mutedAdded', { name: val }))
  }

  const removeMutedPlayer = (nameOrId: string) => {
    const cur = draftRef.current.overlay?.mutedPlayers ?? []
    setOverlay({ mutedPlayers: cur.filter((x) => x !== nameOrId) })
    toast.push(t.tf('settings.mutedRemoved', { name: nameOrId }))
  }

  const clearAllMutedPlayers = () => {
    setOverlay({ mutedPlayers: [] })
    toast.push(t.t('settings.mutedCleared'))
  }

  const addRoot = async () => {
    const roots = await window.api.library.addRoot()
    if (roots && roots.length) {
      set({ libraryRoots: [...new Set([...draftRef.current.libraryRoots, ...roots])] })
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
    // 主进程从 settings.json 读取安装路径/启动项，先确保防抖中的输入已经保存。
    if (!(await waitForPendingSave())) return
    const r = await window.api.live.launch({
      toolsMode: (draftRef.current.cs2.playMode ?? 'native') === 'tools'
    })
    if (r.ok) toast.push(t.t('settings.cs2Launched'))
    else toast.push(r.error ?? t.t('common.error'), 'warn')
  }

  const refreshSteamSafety = async () => {
    setSafetyLoading(true)
    try {
      const report = await window.api.live.steamSafety()
      setSteamSafety(report)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSafetyLoading(false)
    }
  }

  const cleanSteamSafety = async () => {
    setSafetyLoading(true)
    try {
      const res = await window.api.live.restoreCleanFiles()
      toast.push(res.message, res.ok ? 'ok' : 'err')
      const report = await window.api.live.steamSafety()
      setSteamSafety(report)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSafetyLoading(false)
    }
  }

  const hudMode = draft.cs2.hudMode ?? 'addon'
  const muteHudMode = draft.overlay?.muteHudMode ?? 'badge'

  return (
    <div className="page" ref={pageRef} style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
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
                onClick={() => setUi({ theme: th })}
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
                {l === 'zh' ? t.t('settings.langZhCN') : 'EN'}
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
            <Btn variant="secondary" size="sm" onClick={autoDetectRoots}>
              <IcRadar size={13} />
              {t.t('library.autoDetect')}
            </Btn>
            <Btn variant="secondary" size="sm" onClick={addRoot}>
              <IcPlus size={12} />
              {t.t('library.addRoot')}
            </Btn>
          </div>
        </div>
        {draft.libraryRoots.length > 0 && (
          <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            {draft.libraryRoots.map((r) => {
              const info = formatRootLabel(r, t.lang)
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
                    onClick={() => set({ libraryRoots: draftRef.current.libraryRoots.filter((x) => x !== r) })}
                  >
                    {t.t('common.remove')}
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
              { value: 'zh', label: t.t('settings.langZhCN'), sublabel: 'zh' },
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
                onChange={(e) => setAsrText('cloudApiKey', e.target.value)}
                onFocus={beginTextEdit}
                onBlur={endTextEdit}
              />
            </div>
            {draft.asr.cloudBaseUrl.includes('groq.com') && (
              <div className="set-row">
                <div className="info">
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => window.api.app.openUrl('https://console.groq.com/keys')}
                    style={{ color: 'var(--accent)', padding: 0, height: 'auto' }}
                  >
                    {t.t('settings.getKey')} → console.groq.com/keys
                  </Btn>
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
                    onChange={(e) => setAsrText('cloudBaseUrl', e.target.value)}
                    onFocus={beginTextEdit}
                    onBlur={endTextEdit}
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
                    onChange={(e) => setAsrText('cloudModel', e.target.value)}
                    onFocus={beginTextEdit}
                    onBlur={endTextEdit}
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
                  {t.t(currentAiProvider.nameKey as never)}
                </span>
                <Tag tone="voice">{t.t(currentAiProvider.badgeKey as never)}</Tag>
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
                {t.t('common.copy')}
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                onClick={() => window.api.app.openUrl(currentAiProvider.keyUrl)}
              >
                {t.t('settings.aiGetKey')}
              </Btn>
            </div>
          </div>
        )}

        <div className="set-row">
          <div className="info">
            <div className="t">{t.t('settings.aiApiKey')}</div>
            <div className="d">
              {currentAiProvider.key === 'siliconflow'
                ? t.t('settings.aiKeyHintSiliconFlow')
                : currentAiProvider.key === 'groq'
                  ? t.t('settings.aiKeyHintGroq')
                  : t.t('settings.aiKeyHintGeneric')}
            </div>
          </div>
          <input
            className="input"
            style={{ width: 300 }}
            type="password"
            placeholder="sk-…"
            value={draft.ai.apiKey}
            onChange={(e) => setAiText('apiKey', e.target.value)}
            onFocus={beginTextEdit}
            onBlur={endTextEdit}
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
              onChange={(e) => setAiText('baseUrl', e.target.value)}
              onFocus={beginTextEdit}
              onBlur={endTextEdit}
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
            onChange={(m) => setAiText('model', m)}
            onSelect={(m) => setAi({ model: m })}
            onFocus={beginTextEdit}
            onBlur={endTextEdit}
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
              className={`seg-item ${(draft.cs2.playMode ?? 'native') === 'native' ? 'on' : ''}`}
              onClick={() => setCs2({ playMode: 'native' })}
            >
              {t.t('settings.cs2PlayModeNative')}
            </span>
            <span
              className={`seg-item ${(draft.cs2.playMode ?? 'native') === 'tools' ? 'on' : ''}`}
              onClick={() => setCs2({ playMode: 'tools' })}
            >
              {t.t('settings.cs2PlayModeTools')}
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
              onChange={(e) => setCs2Text('installPath', e.target.value || undefined)}
              onFocus={beginTextEdit}
              onBlur={endTextEdit}
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
            onChange={(e) => setCs2Text('launchArgs', e.target.value)}
            onFocus={beginTextEdit}
            onBlur={endTextEdit}
          />
        </div>
        <div className="set-row" style={{ alignItems: 'flex-start' }}>
          <div className="info">
            <div className="t">{t.t('settings.hudMode')}</div>
            <div className="d">{t.t('settings.hudModeHint')}</div>
            {hudMode === 'inject' && (
              <div className="d" style={{ color: '#ff9f0a', marginTop: 6 }}>
                {t.t('settings.hudModeInjectWarning')}
              </div>
            )}
            {hudMode === 'addon' && (
              <div className="d" style={{ marginTop: 6 }}>
                {t.t('settings.hudModeAddonHint')}
              </div>
            )}
          </div>
          <div className="seg">
            <span
              className={`seg-item ${hudMode === 'addon' ? 'on' : ''}`}
              onClick={() => setCs2({ hudMode: 'addon' })}
            >
              {t.t('settings.hudModeAddon')}
            </span>
            <span
              className={`seg-item ${hudMode === 'inject' ? 'on' : ''}`}
              onClick={() => {
                if (hudMode !== 'inject') setShowInjectConfirm(true)
              }}
            >
              {t.t('settings.hudModeInject')}
            </span>
            <span
              className={`seg-item ${hudMode === 'off' ? 'on' : ''}`}
              onClick={() => setCs2({ hudMode: 'off' })}
            >
              {t.t('settings.hudModeOff')}
            </span>
          </div>
        </div>

        {hudMode !== 'off' && (
          <div className="set-row" style={{ alignItems: 'flex-start' }}>
            <div className="info">
              <div className="t">{t.t('settings.muteHudMode')}</div>
              <div className="d">{t.t('settings.muteHudModeHint')}</div>
            </div>
            <div className="seg">
              <span
                className={`seg-item ${muteHudMode === 'badge' ? 'on' : ''}`}
                onClick={() => setOverlay({ muteHudMode: 'badge' })}
              >
                {t.t('settings.muteHudModeBadge')}
              </span>
              <span
                className={`seg-item ${muteHudMode === 'hide' ? 'on' : ''}`}
                onClick={() => setOverlay({ muteHudMode: 'hide' })}
              >
                {t.t('settings.muteHudModeHide')}
              </span>
            </div>
          </div>
        )}

        <div className="set-row" style={{ alignItems: 'flex-start' }}>
          <div className="info">
            <div className="t">{t.t('settings.steamSafetyTitle')}</div>
            <div className="d">{t.t('settings.steamSafetyHint')}</div>
            {steamSafety && (
              <div
                style={{
                  marginTop: 10,
                  display: 'grid',
                  gap: 5,
                  fontSize: 11.5,
                  color: 'var(--text-1)'
                }}
              >
                {steamSafety.installPath ? (
                  <>
                    <div className="flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Led
                        state={steamSafety.officialClean ? 'on' : 'red'}
                        label={
                          steamSafety.officialClean
                            ? t.t('settings.steamSafetyOfficialClean')
                            : t.t('settings.steamSafetyNotClean')
                        }
                      />
                      {steamSafety.cs2Running && (
                        <Tag tone="ghost">{t.t('settings.steamSafetyRunning')}</Tag>
                      )}
                    </div>
                    <div>
                      {t.t('settings.steamSafetyGameinfo')}：
                      {steamSafety.gameinfoHasDsh
                        ? t.t('settings.steamSafetyYes')
                        : t.t('settings.steamSafetyNo')}
                    </div>
                    <div>
                      {t.t('settings.steamSafetyBackup')}：
                      {steamSafety.backupExists
                        ? t.t('settings.steamSafetyExists')
                        : t.t('settings.steamSafetyMissing')}
                    </div>
                    <div>
                      {t.t('settings.steamSafetyVpk')}：
                      {t.tf('settings.steamSafetyCount', { n: steamSafety.projectVpks.length })}
                    </div>
                    <div>
                      {t.t('settings.steamSafetyAddon')}：
                      {steamSafety.addonPresent
                        ? t.t('settings.steamSafetyExists')
                        : t.t('settings.steamSafetyMissing')}
                      {steamSafety.addonPresent
                        ? `（${t.t('settings.steamSafetyAddonExtra')}）`
                        : ''}
                    </div>
                    {steamSafety.addonPresent && steamSafety.addonFiles && (
                      <div>
                        {t.t('settings.steamSafetyAddonFiles')}：
                        {steamSafety.addonComplete
                          ? t.t('settings.steamSafetyYes')
                          : t.tf('settings.steamSafetyAddonMissing', {
                              n: steamSafety.addonFiles.filter((f) => !f.exists).length
                            })}
                      </div>
                    )}
                    {steamSafety.error && (
                      <div style={{ color: '#ff453a' }}>{steamSafety.error}</div>
                    )}
                  </>
                ) : (
                  <div style={{ color: '#ff9f0a' }}>
                    {steamSafety.error ?? t.t('settings.steamSafetyNoInstall')}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Btn
              variant="ghost"
              size="sm"
              disabled={safetyLoading}
              onClick={() => void refreshSteamSafety()}
            >
              <IcRefresh size={12} />
              {safetyLoading ? t.t('settings.steamSafetyChecking') : t.t('settings.steamSafetyCheck')}
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              disabled={safetyLoading}
              onClick={() => void cleanSteamSafety()}
            >
              {safetyLoading ? t.t('settings.steamSafetyCleaning') : t.t('settings.steamSafetyClean')}
            </Btn>
          </div>
        </div>

        {hudMode !== 'off' && (
          <>

            <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div className="flex between" style={{ alignItems: 'center' }}>
                <div className="info">
                  <div className="t">{t.t('settings.overlayMutedPlayers')}</div>
                  <div className="d">{t.t('settings.overlayMutedPlayersHint')}</div>
                </div>
                {(draft.overlay?.mutedPlayers?.length ?? 0) > 0 && (
                  <Btn variant="ghost" size="sm" onClick={clearAllMutedPlayers} style={{ color: '#ff453a' }}>
                    {t.t('settings.overlayClearMuted')}
                  </Btn>
                )}
              </div>

              {/* 手动添加输入框 */}
              <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ width: 280 }}
                  placeholder={t.t('settings.mutedPlaceholder')}
                  value={newMutedInput}
                  onChange={(e) => setNewMutedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addMutedPlayer()
                  }}
                />
                <Btn variant="secondary" size="sm" onClick={addMutedPlayer} disabled={!newMutedInput.trim()}>
                  <IcPlus size={12} />
                  <span>{t.t('settings.mutedAdd')}</span>
                </Btn>
              </div>

              {/* 现存静音名单 */}
              {(draft.overlay?.mutedPlayers ?? []).length > 0 ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {(draft.overlay?.mutedPlayers ?? []).map((p) => (
                    <span
                      key={p}
                      className="tag"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'rgba(255, 69, 58, 0.12)',
                        border: '1px solid rgba(255, 69, 58, 0.35)',
                        color: '#ff6961',
                        padding: '4px 8px',
                        borderRadius: 6
                      }}
                    >
                      <IcMicOff size={12} />
                      <span>{p}</span>
                      <button
                        type="button"
                        onClick={() => removeMutedPlayer(p)}
                        title={t.tf('settings.mutedRemoveTitle', { name: p })}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ff6961',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: 12,
                          lineHeight: 1
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {t.t('settings.mutedEmpty')}
                </div>
              )}
            </div>
          </>
        )}

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
              {t.t('settings.offlineGuide')}
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
                    {prog !== null ? `${prog}%` : t.t('settings.enginePreparing')}
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
                  {t.t('settings.offlineStepsTitle')}
                </div>
                <div style={{ color: 'var(--text-1)', lineHeight: 1.8 }}>
                  <div>
                    {t.tf('settings.offlineStep1', {
                      path: dataDir ? `${dataDir}\\engines\\` : '%APPDATA%/CS2 Demo Analyst/engines/'
                    })}
                  </div>
                  <div>{t.t('settings.offlineStep2')}</div>
                  <div style={{ paddingLeft: 12 }}>
                    <div>
                      • <b>{t.t('settings.offlineWhisperModels')}</b>（<code>ggml-base.bin</code> / <code>ggml-small.bin</code> / <code>ggml-medium.bin</code>）<br />
                      👉 {t.t('settings.offlineWhisperModelsDesc')}
                    </div>
                    <div>
                      • <b>{t.t('settings.offlineWhisperCli')}</b><br />
                      👉 {t.t('settings.offlineWhisperCliDesc')}
                    </div>
                    <div>
                      • <b>{t.t('settings.offlineCsgove')}</b><br />
                      👉 {t.t('settings.offlineCsgoveDesc')}
                    </div>
                  </div>
                  <div style={{ marginTop: 4 }}>{t.t('settings.offlineStep3')}</div>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-0)' }}>
                  {t.t('settings.offlineSourcesTitle')}
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
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text-0)' }}>{t.t(s.titleKey as never)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>{t.t(s.descKey as never)}</div>
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
                          {t.t('common.copy')}
                        </Btn>
                        <Btn variant="primary" size="sm" onClick={() => window.api.app.openUrl(s.url)}>
                          {t.t('common.visit')}
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

      {/* Inject 实验模式确认 */}
      {showInjectConfirm && (
        <Modal
          title={t.t('settings.hudModeInject')}
          body={t.t('settings.hudModeInjectWarning')}
          confirmLabel={t.t('common.confirm')}
          onClose={() => setShowInjectConfirm(false)}
          onConfirm={() => {
            setShowInjectConfirm(false)
            setCs2({ hudMode: 'inject' })
          }}
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


