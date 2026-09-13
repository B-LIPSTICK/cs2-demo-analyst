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
import type { ChatMessage, DemoDetail, DemoMeta, Settings, VoiceSegment } from '@shared/types'

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

  // 页面常驻（App 只切换 display）后，从详情页跳转带入新的 demoId 时同步切换；
  useEffect(() => {
    if (initialDemoId) setDemoId(initialDemoId)
  }, [initialDemoId])

  // 外部导航（navSeq 变化，例如点击“转写页 ->”或侧栏切换）时，主动拉取最新 detail 并清空陈旧的进度条
  useEffect(() => {
    const idToLoad = initialDemoId || demoId
    if (idToLoad) {
      if (initialDemoId && initialDemoId !== demoId) {
        setDemoId(initialDemoId)
      }
      loadDetail(idToLoad)
    }
  }, [navSeq, initialDemoId, demoId, loadDetail])

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
  }, [demoId])

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
      const voiceHud = !!s.cs2?.voiceHud
      if (voiceHud) toast.push(t('detail.voiceHudPreparing'))
      const r = await window.api.live.launch({
        playDemoPath: detail.meta.path,
        voiceHud,
        startTick: tick
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
      lines.push('', '── CHAT ──')
      for (const c of filteredChat) lines.push(`[${fmtTick(c.tick)}] ${c.playerName}: ${c.text}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${detail?.meta.mapName ?? 'demo'}_transcript.txt`
    a.click()
    URL.revokeObjectURL(url)
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="title">
            {t('transcript.title')}
          </div>
        </div>
        <div className="actions">
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
                    ? d.mapName
                    : d.status === 'pending'
                      ? '待解析'
                      : d.status === 'error'
                        ? '失败'
                        : undefined
              }))
            ]}
            onChange={(v) => {
              setDemoId(v || undefined)
              if (v) onOpenDemo(v)
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
            <span className="muted" style={{ fontSize: 11, maxWidth: 260, lineHeight: 1.5 }}>
              {t('transcript.localSlowHint')}
            </span>
          )}
          <Btn variant="ghost" onClick={exportText} disabled={filteredVoice.length === 0}>
            <IcDownload size={13} />
            {t('transcript.export')}
          </Btn>
        </div>
      </div>

      {!demoId || !detail ? (
        <Empty ghost="TRANSCRIPT" hint={t('transcript.noSegmentsHint')} />
      ) : (
        <>
          {/* 进度条 + 阶段说明 */}
          {progress && (
            <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 8 }}>
              <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
                  {progress.message
                    ? progress.message
                    : progress.stage === 'voice-extract'
                      ? t('transcript.stage.extract')
                      : progress.stage === 'voice-split'
                        ? '正在切分玩家语音…'
                        : t('transcript.stage.asr')}
                </span>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {progress.total > 0
                    ? progress.stage === 'download-engine'
                      ? `${Math.round((progress.done / progress.total) * 100)}%`
                      : `${progress.done}/${progress.total}`
                    : '…'}
                </span>
              </div>
              <div className="grow" style={{ height: 4, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${progress.total ? Math.min(100, Math.max(0, (progress.done / progress.total) * 100)) : 0}%`,
                    background: 'linear-gradient(90deg, var(--accent), var(--ct))',
                    transition: 'width .2s var(--ease-out)'
                  }}
                />
              </div>
            </div>
          )}

          {/* 筛选栏 */}
          <div className="flex" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {voicePlayers.map((p) => {
                const on = players.has(p)
                const playerInfo = (detail?.meta.players ?? []).find((x) => x.name === p)
                const muted = isPlayerMuted(p, playerInfo?.steamId)
                return (
                  <span
                    key={p}
                    className={`tag ${on ? 'voice' : 'ghost'} ${muted ? 'player-muted-tag' : ''}`}
                    style={{
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      borderColor: muted ? 'rgba(255, 69, 58, 0.45)' : undefined,
                      color: muted && !on ? '#ff6961' : undefined
                    }}
                    onClick={() => togglePlayer(p)}
                    title={muted ? `${p} (已静音)` : p}
                  >
                    {muted && <IcMicOff size={11} style={{ color: '#ff453a' }} />}
                    <span>{p}</span>
                    {muted && <span style={{ fontSize: 9, color: '#ff453a', opacity: 0.85 }}>[已静音]</span>}
                  </span>
                )
              })}
              {players.size > 0 && (
                <span className="tag ghost" style={{ cursor: 'pointer' }} onClick={() => setPlayers(new Set())}>
                  {t('common.all')}
                </span>
              )}
            </div>
            <div className="grow" />
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
            <div className="row">
              <IcSearch size={14} />
              <input
                className="input"
                style={{ width: 190 }}
                placeholder={t('transcript.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="seg">
              <span className={`seg-item ${tab === 'voice' ? 'on' : ''}`} onClick={() => setTab('voice')}>
                <IcMic size={12} />
                {t('transcript.voice')} · {filteredVoice.length}
              </span>
              <span className={`seg-item ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>
                {t('transcript.chat')} · {filteredChat.length}
              </span>
            </div>
          </div>

          <Panel hd={tab === 'voice' ? `${t('transcript.voice')} · ${detail.meta.mapName}` : `${t('transcript.chat')} · ${detail.meta.mapName}`}>
            {tab === 'voice' ? (
              filteredVoice.length === 0 ? (
                <Empty ghost="NO VOICE" hint={t('transcript.noSegmentsHint')} />
              ) : (
                <div style={{ maxHeight: 560, overflowY: 'auto', padding: '8px 0' }}>
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
              <Empty ghost="NO CHAT" hint="—" />
            ) : (
              <div style={{ maxHeight: 560, overflowY: 'auto', padding: '8px 0' }}>
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
    <div className={`tline ${muted ? 'muted-line' : ''}`}>
      <span className="tm">
        {fmtTick(seg.tick, tickRate)}
        <span className="eng" style={{ marginLeft: 6 }}>
          {seg.engine === 'cloud' ? t('transcript.cloud') : t('transcript.local')}
        </span>
      </span>
      <span className="who">
        <Avatar name={seg.playerName} team={seg.team} size={18} avatar={avatar} muted={muted} />
        <span className={`nm ${seg.team === 'T' ? 't' : seg.team === 'CT' ? 'ct' : ''}`}>
          {seg.playerName}
          {muted && <span style={{ fontSize: 10, color: '#ff453a', marginLeft: 4 }}>(已静音)</span>}
        </span>
        {seg.roundNum !== undefined && <Tag tone="ghost">R{seg.roundNum}</Tag>}
      </span>
      <span className={`txt ${seg.text ? '' : 'no-text'}`} style={muted ? { opacity: 0.6 } : undefined}>
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
    <div className="tline">
      <span className="tm">{fmtTick(msg.tick, tickRate)}</span>
      <span className="who">
        <Avatar name={msg.playerName} team="NONE" size={18} avatar={avatar} />
        <span className="nm">{msg.playerName}</span>
        <Tag tone={msg.channel === 'T' ? 't' : msg.channel === 'CT' ? 'ct' : 'ghost'}>
          {msg.channel}
        </Tag>
      </span>
      <span className="txt">{msg.text}</span>
      <button className="icon-btn jump" onClick={() => onJump(msg.tick)} title={t('transcript.jump')}>
        <IcJump size={13} />
      </button>
    </div>
  )
}
