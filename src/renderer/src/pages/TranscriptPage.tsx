import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Btn,
  CustomSelect,
  Empty,
  IcDownload,
  IcJump,
  IcMic,
  IcMicOff,
  IcSearch,
  Panel,
  Tag,
  VoicePlayButton,
  fmtTick,
  useToast
} from '@/components/ui'
import { useTKey } from '@/i18n'
import { formatMapName } from '@/utils/format'
import { computeVoiceMask } from './DemoDetailPage'
import type { ChatMessage, DemoDetail, DemoMeta, Settings, VoiceSegment } from '@shared/types'

/** 空状态主按钮：把焦点和点击交给顶部的 Demo 选择器，不引入新的选择逻辑。 */
function openDemoPicker() {
  const trigger = document.querySelector<HTMLButtonElement>('.transcript-toolbar .cs-trigger')
  trigger?.focus()
  trigger?.click()
}
export function TranscriptPage({
  initialDemoId,
  navSeq,
  onOpenDemo
}: {
  initialDemoId?: string
  /** 导航序号（App navigate 每次 +1）：重复跳转同一 demo 时也重新同步选中 */
  navSeq?: number
  onOpenDemo: (id: string) => void
}) {
  const t = useTKey()
  const toast = useToast()
  const [demos, setDemos] = useState<DemoMeta[]>([])
  const [demoId, setDemoId] = useState<string | undefined>(initialDemoId)
  const [detail, setDetail] = useState<DemoDetail | null>(null)
  const [tab, setTab] = useState<'voice' | 'chat'>('voice')
  const [players, setPlayers] = useState<Set<string>>(new Set())
  const [round, setRound] = useState<number | 'all'>('all')
  const [query, setQuery] = useState('')
  const [liveSegs, setLiveSegs] = useState<VoiceSegment[]>([])
  const [transcribing, setTranscribing] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number; message?: string } | null>(null)
  const [hasCloudKey, setHasCloudKey] = useState(false)

  const [settings, setSettings] = useState<Settings | null>(null)

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null)
      setLiveSegs([])
      return
    }
    try {
      const d = await window.api.library.detail(id)
      setDetail(d)
    } catch {
      // ignore
    }
  }, [])

  // 外部导航（详情页跳转/侧栏切换）时同步 demoId。
  // 用户主动清空时 initialDemoId 会变为 undefined，这里不能回填旧值，否则会弹回上一个 demo。
  useEffect(() => {
    if (initialDemoId) setDemoId(initialDemoId)
  }, [initialDemoId])

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setHasCloudKey(Boolean(s.asr?.cloudApiKey))
    }).catch(() => {})
    const off = window.api.onEvent('settings:changed', (e) => {
      if (e.settings) setSettings(e.settings)
    })
    return () => off()
  }, [])

  const mutedSet = useMemo(() => new Set(settings?.overlay?.mutedPlayers ?? []), [settings?.overlay?.mutedPlayers])

  const isPlayerMuted = (name: string, steamId?: string) => {
    return (steamId ? mutedSet.has(steamId) : false) || mutedSet.has(name)
  }

  useEffect(() => {
    window.api.library.list().then(setDemos)
    // 库实时刷新（新加入/移除 demo 后下拉立即可选，避免选到已移除的过期 id）
    const off = window.api.onEvent('library:updated', (e) => setDemos(e.demos))
    return () => off()
  }, [])

  useEffect(() => {
    if (!demoId) {
      setDetail(null)
      setLiveSegs([])
      return
    }
    let alive = true
    setLiveSegs([])
    window.api.library.detail(demoId).then((d) => {
      if (alive) setDetail(d)
    })
    return () => {
      alive = false
    }
    // navSeq 变化（重复导航到同一 demo）时也刷新详情
  }, [demoId, navSeq])

  // 转写 / 分割事件
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null
    const offSeg = window.api.onEvent('asr:segment', (e) => {
      if (e.demoId === demoId) setLiveSegs((s) => [...s, e.segment])
    })
    const offProg = window.api.onEvent('asr:progress', (e) => {
      if (e.demoId === demoId) {
        if (e.stage === 'done') {
          setProgress(null)
          loadDetail(demoId)
        } else {
          setProgress({ stage: e.stage, done: e.done, total: e.total, message: e.message })
          // 兜底：若已达 100%（例如分割完成 8/8），在短暂延迟后若无新事件自动清除并拉取最新详情
          if (e.total > 0 && e.done >= e.total) {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              setProgress((p) => (p && p.total > 0 && p.done >= p.total ? null : p))
              loadDetail(demoId)
            }, 1200)
          }
        }
      }
    })
    const offDone = window.api.onEvent('asr:done', (e) => {
      if (e.demoId === demoId) {
        if (timer) clearTimeout(timer)
        setProgress(null)
        setLiveSegs([])
        loadDetail(demoId)
      }
    })
    const offDetail = window.api.onEvent('library:detail', (e) => {
      if (e.id === demoId && e.detail) {
        if (timer) clearTimeout(timer)
        setDetail(e.detail)
        setProgress(null)
        setLiveSegs([])
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      offSeg()
      offProg()
      offDone()
      offDetail()
    }
  }, [demoId, loadDetail])

  const runTranscribe = async () => {
    if (!demoId) return
    if (demos.find((d) => d.id === demoId)?.status !== 'ready') {
      toast.push(t('transcript.notReadyHint'), 'warn')
      return
    }
    setTranscribing(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1 })
    try {
      await window.api.asr.transcribe(demoId)
      toast.push(t('library.transcribeDone'))
      // 转写完成刷新详情（语音列表更新）；liveSegs 只是转写过程的实时预览，
      // 完成后清空，否则与 detail.voice 合并显示会整列表翻倍
      setLiveSegs([])
      const d = await window.api.library.detail(demoId)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(errMsg(err), 'err')
    } finally {
      setTranscribing(false)
      setProgress(null)
    }
  }

  /** 语音分割：只提取并切分语音（不转写、无需 API Key），切完可直接逐段听 */
  const runSplit = async () => {
    if (!demoId) return
    if (demos.find((d) => d.id === demoId)?.status !== 'ready') {
      toast.push(t('transcript.notReadyHint'), 'warn')
      return
    }
    setSplitting(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1 })
    try {
      const n = await window.api.voice.split(demoId)
      toast.push(t('transcript.splitDone').replace('{n}', String(n)))
      const d = await window.api.library.detail(demoId)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(errMsg(err), 'err')
    } finally {
      setSplitting(false)
      setProgress(null)
    }
  }

  const allVoice = useMemo<VoiceSegment[]>(() => {
    const base = detail?.voice ?? []
    // 去重兜底（防 liveSegs 与 detail.voice 偶发重叠）
    const seen = new Set<string>()
    const out: VoiceSegment[] = []
    const rounds = detail?.rounds ?? []
    for (const v of [...base, ...liveSegs]) {
      const key = `${v.playerName}|${v.timeSec}`
      if (seen.has(key)) continue
      seen.add(key)
      const rNum =
        v.roundNum !== undefined
          ? v.roundNum
          : rounds.find((r) => v.tick >= r.startTick && v.tick <= r.endTick)?.roundNum
      out.push(rNum !== v.roundNum ? { ...v, roundNum: rNum } : v)
    }
    return out
  }, [detail, liveSegs])

  const voicePlayers = useMemo(() => {
    const s = new Set<string>()
    for (const v of allVoice) s.add(v.playerName)
    return [...s]
  }, [allVoice])

  const filteredVoice = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allVoice
      .filter((v) => (players.size === 0 || players.has(v.playerName)))
      .filter((v) => round === 'all' || v.roundNum === round)
      .filter((v) => !q || v.text.toLowerCase().includes(q) || v.playerName.toLowerCase().includes(q))
      .sort((a, b) => a.tick - b.tick)
  }, [allVoice, players, round, query])

  const filteredChat = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (detail?.chat ?? [])
      .filter((c) => (players.size === 0 || players.has(c.playerName)))
      .filter((c) => round === 'all' || c.roundNum === round)
      .filter((c) => !q || c.text.toLowerCase().includes(q) || c.playerName.toLowerCase().includes(q))
      .sort((a, b) => a.tick - b.tick)
  }, [detail, players, round, query])

  const jump = async (tick: number) => {
    const jumped = await window.api.live.jumpTick(tick).catch(() => false)
    if (jumped) {
      toast.push(t('common.jumpDirectSuccess').replace('{tick}', String(tick)))
      return
    }
    const cmd = `demo_gototick ${tick}`
    try {
      await navigator.clipboard.writeText(cmd)
    } catch {
      /* ignore */
    }
    const status = await window.api.live.getStatus().catch(() => null)
    if (status?.cs2Running) {
      toast.push(t('common.jumpCopiedRunning').replace('{cmd}', cmd))
      return
    }
    // CS2 未运行：直接局外一键唤起 CS2 播放并定位
    if (detail?.meta.path) {
      const s = await window.api.settings.get()
      const hudMode = s.cs2?.hudMode ?? 'addon'
      if (hudMode !== 'off') toast.push(t('detail.voiceHudPreparing'))
      // 与详情页一致：按静音名单计算 GOTV 语音位掩码，保证各入口启动行为统一
      const voiceIndices = computeVoiceMask(
        detail.meta.players ?? [],
        new Set(s.overlay?.mutedPlayers ?? [])
      )
      const r = await window.api.live.launch({
        playDemoPath: detail.meta.path,
        hudMode,
        startTick: tick,
        tvVoiceIndices: { low: voiceIndices.low, high: voiceIndices.high }
      })
      if (r.ok) {
        toast.push(t('common.jumpLaunched').replace('{tick}', String(tick)))
        return
      }
    }
    toast.push(t('common.jumpCopied').replace('{cmd}', cmd))
  }

  const togglePlayer = (name: string) => {
    setPlayers((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  const exportText = () => {
    const lines = filteredVoice.map(
      (v) =>
        `[${fmtTick(v.tick)}] ${v.playerName}: ${v.text}`
    )
    if (filteredChat.length) {
      lines.push('', t('transcript.exportChatHeader'))
      for (const c of filteredChat) lines.push(`[${fmtTick(c.tick)}] ${c.playerName}: ${c.text}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${detail?.meta.mapName ?? 'demo'}_transcript.txt`
    a.click()
    // 延迟释放：部分浏览器/Electron 在 click 同步返回后立刻 revoke 会导致下载被取消
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const rounds = detail?.rounds ?? []
  // 当前选中 demo 是否解析完成（未完成时禁转写/分割）
  const demoReady = Boolean(demos.find((d) => d.id === demoId)?.status === 'ready')

  /** 错误提示友好化：Electron 包装的 raw 错误 → 中文提示 */
  const errMsg = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('demo not found')) return t('transcript.demoGoneHint')
    return msg
  }

  const mapLabel = detail ? formatMapName(detail.meta.mapName) || '—' : '—'

  return (
    <div className="page transcript-page">
      <div className="page-head">
        <div>
          <div className="title">
            {t('transcript.title')}
          </div>
        </div>
        <div className="actions transcript-toolbar">
          <CustomSelect
            width={240}
            value={demoId ?? ''}
            placeholder={t('transcript.selectDemo')}
            options={[
              { value: '', label: t('transcript.selectDemo') },
              ...demos.map((d) => ({
                value: d.id,
                label: d.fileName,
                sublabel:
                  d.status === 'ready' && d.mapName
                    ? formatMapName(d.mapName)
                    : d.status === 'pending'
                      ? t('common.pending')
                      : d.status === 'error'
                        ? t('common.failed')
                        : undefined
              }))
            ]}
            onChange={(v) => {
              if (!v) {
                // 真正清空选择，并同步 App 路由，避免被旧 initialDemoId 弹回
                setDemoId(undefined)
                setDetail(null)
                setLiveSegs([])
                setProgress(null)
                onOpenDemo('')
                return
              }
              setDemoId(v)
              onOpenDemo(v)
            }}
          />
          {/* 先分割（提取语音片段），再转写（生成文字） */}
          <Btn
            variant="accent"
            disabled={!demoId || !demoReady || transcribing || splitting}
            onClick={runSplit}
            title={demoReady ? t('transcript.splitHint') : t('transcript.notReadyHint')}
          >
            <IcMic size={13} />
            {splitting ? t('transcript.splitting') : t('transcript.split')}
          </Btn>
          <Btn
            variant="primary"
            disabled={!demoId || !demoReady || transcribing || splitting}
            onClick={runTranscribe}
            title={demoReady ? t('transcript.transcribeHint') : t('transcript.notReadyHint')}
          >
            <IcMic size={13} />
            {transcribing ? t('library.transcribing') : t('library.transcribe')}
          </Btn>
          {!hasCloudKey && (
            <span className="muted transcript-hint">{t('transcript.localSlowHint')}</span>
          )}
          <Btn variant="ghost" onClick={exportText} disabled={filteredVoice.length === 0}>
            <IcDownload size={13} />
            {t('transcript.export')}
          </Btn>
        </div>
      </div>

      {!demoId || !detail ? (
        <Empty ghost="TRANSCRIPT" hint={t('transcript.noSegmentsHint')}>
          <Btn variant="secondary" className="transcript-empty-action" onClick={openDemoPicker}>
            {t('transcript.selectDemo')}
          </Btn>
        </Empty>
      ) : (
        <>
          {/* 进度条 + 阶段说明 */}
          {progress && (
            <div className="transcript-progress" role="status" aria-live="polite">
              <div className="transcript-progress-head">
                <span className="transcript-progress-label">
                  <span className="transcript-progress-pulse" aria-hidden="true" />
                  {progress.message
                    ? progress.message
                    : progress.stage === 'voice-extract'
                      ? t('transcript.stage.extract')
                      : progress.stage === 'voice-split'
                        ? t('transcript.stage.split')
                        : t('transcript.stage.asr')}
                </span>
                <span className="transcript-progress-value mono">
                  {progress.total > 0
                    ? progress.stage === 'download-engine'
                      ? `${Math.round((progress.done / progress.total) * 100)}%`
                      : `${progress.done}/${progress.total}`
                    : '…'}
                </span>
              </div>
              <div className="transcript-progress-track">
                <div
                  className="transcript-progress-fill"
                  style={{
                    width: `${progress.total ? Math.min(100, Math.max(0, (progress.done / progress.total) * 100)) : 0}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* 筛选栏 */}
          <div className="transcript-filters">
            <div className="transcript-chips">
              {voicePlayers.map((p) => {
                const on = players.has(p)
                const playerInfo = (detail?.meta.players ?? []).find((x) => x.name === p)
                const muted = isPlayerMuted(p, playerInfo?.steamId)
                return (
                  <button
                    key={p}
                    type="button"
                    className={`tag filter-chip ${on ? 'is-on' : 'ghost'} ${muted ? 'is-muted' : ''}`}
                    onClick={() => togglePlayer(p)}
                    title={muted ? `${p} ${t('common.mutedSuffix')}` : p}
                    aria-pressed={on}
                  >
                    {muted && <IcMicOff size={12} />}
                    <span className="filter-chip-name">{p}</span>
                    {muted && <span className="filter-chip-muted">{t('common.mutedTag')}</span>}
                  </button>
                )
              })}
              {players.size > 0 && (
                <button type="button" className="tag ghost filter-chip filter-chip-all" onClick={() => setPlayers(new Set())}>
                  {t('common.all')}
                </button>
              )}
            </div>
            <div className="grow" />
            <div className="transcript-round">
              <CustomSelect
                width={140}
                value={String(round)}
              options={[
                { value: 'all', label: `${t('common.round')} · ${t('common.all')}` },
                ...rounds.map((r) => ({
                  value: String(r.roundNum),
                  label: `R${r.roundNum}`
                }))
              ]}
                onChange={(v) => setRound(v === 'all' ? 'all' : Number(v))}
              />
            </div>
            <label className="transcript-search">
              <IcSearch size={15} />
              <input
                className="input"
                placeholder={t('transcript.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t('transcript.search')}
              />
            </label>
            <div className="seg transcript-tabs">
              <span className={`seg-item ${tab === 'voice' ? 'on' : ''}`} onClick={() => setTab('voice')}>
                <IcMic size={12} />
                {t('transcript.voice')} · {filteredVoice.length}
              </span>
              <span className={`seg-item ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>
                {t('transcript.chat')} · {filteredChat.length}
              </span>
            </div>
          </div>

          <Panel className="transcript-panel" dot hd={`${tab === 'voice' ? t('transcript.voice') : t('transcript.chat')} · ${mapLabel}`}>
            {tab === 'voice' ? (
              filteredVoice.length === 0 ? (
                <div className="transcript-empty">
                  <Empty ghost={t('transcript.emptyVoice')} hint={t('transcript.noSegmentsHint')} />
                </div>
              ) : (
                <div className="transcript-list">
                  {filteredVoice.map((v, i) => {
                    const muted = isPlayerMuted(v.playerName, v.steamId)
                    return (
                      <VoiceRow
                        key={`${v.tick}-${i}-${i}`}
                        demoId={demoId!}
                        seg={v}
                        tickRate={detail.meta.tickRate ?? 64}
                        muted={muted}
                        onJump={jump}
                        avatar={(detail.meta.players ?? []).find((p) => p.name === v.playerName)?.avatar}
                      />
                    )
                  })}
                </div>
              )
            ) : filteredChat.length === 0 ? (
              <div className="transcript-empty">
                <Empty ghost={t('transcript.emptyChat')} hint="—" />
              </div>
            ) : (
              <div className="transcript-list">
                {filteredChat.map((c, i) => (
                  <ChatRow key={i} msg={c} tickRate={detail.meta.tickRate ?? 64} onJump={jump} avatar={(detail.meta.players ?? []).find((p) => p.name === c.playerName)?.avatar} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

function VoiceRow({
  demoId,
  seg,
  tickRate,
  muted,
  onJump,
  avatar
}: {
  demoId: string
  seg: VoiceSegment
  tickRate: number
  muted?: boolean
  onJump: (tick: number) => void
  avatar?: string
}) {
  const t = useTKey()
  return (
    <div className={`tline voice-line ${muted ? 'is-muted' : ''}`}>
      <span className="tm">
        {fmtTick(seg.tick, tickRate)}
        <span className="eng" style={{ marginLeft: 6 }}>
          {seg.engine === 'cloud' ? t('transcript.cloud') : t('transcript.local')}
        </span>
      </span>
      <span className="who">
        <Avatar name={seg.playerName} team={seg.team} size={22} avatar={avatar} muted={muted} />
        <span className={`nm ${seg.team === 'T' ? 't' : seg.team === 'CT' ? 'ct' : ''}`}>
          {seg.playerName}
          {muted && <span style={{ fontSize: 10, color: '#ff453a', marginLeft: 4 }}>{t('common.mutedSuffix')}</span>}
        </span>
        {seg.roundNum !== undefined && <Tag tone="ghost">R{seg.roundNum}</Tag>}
      </span>
      <span className={`txt ${seg.text ? '' : 'no-text'} ${muted ? 'is-muted' : ''}`}>
        {seg.text || ''}
      </span>
      <VoicePlayButton
        demoId={demoId}
        seg={{ steamId: seg.steamId, playerName: seg.playerName, startSec: seg.timeSec, endSec: seg.endSec }}
      />
      <button className="icon-btn jump" onClick={() => onJump(seg.tick)} title={t('transcript.jump')}>
        <IcJump size={13} />
      </button>
    </div>
  )
}

function ChatRow({
  msg,
  tickRate,
  onJump,
  avatar
}: {
  msg: ChatMessage
  tickRate: number
  onJump: (tick: number) => void
  avatar?: string
}) {
  const t = useTKey()
  return (
    <div className="tline chat-line">
      <span className="tm">{fmtTick(msg.tick, tickRate)}</span>
      <span className="who">
        <Avatar name={msg.playerName} team="NONE" size={22} avatar={avatar} />
        <span className="nm">{msg.playerName}</span>
        <Tag tone={msg.channel === 'T' ? 't' : msg.channel === 'CT' ? 'ct' : 'ghost'}>
          {msg.channel}
        </Tag>
      </span>
      <span className="txt">{msg.text}</span>
      <button className="icon-btn jump" onClick={() => onJump(msg.tick)} title={t('transcript.jump')} aria-label={t('transcript.jump')}>
        <IcJump size={13} />
      </button>
    </div>
  )
}
