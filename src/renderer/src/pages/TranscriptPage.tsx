import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Btn,
  Empty,
  IcChevron,
  IcDownload,
  IcJump,
  IcMic,
  IcSearch,
  Panel,
  Tag,
  VoicePlayButton,
  fmtTick,
  useToast
} from '@/components/ui'
import { useTKey } from '@/i18n'
import type { ChatMessage, DemoDetail, DemoMeta, VoiceSegment } from '@shared/types'

export function TranscriptPage({
  initialDemoId,
  onOpenDemo
}: {
  initialDemoId?: string
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

  // 页面常驻（App 只切换 display）后，从详情页跳转带入新的 demoId 时同步切换
  useEffect(() => {
    if (initialDemoId) setDemoId(initialDemoId)
  }, [initialDemoId])

  useEffect(() => {
    window.api.settings.get().then((s) => setHasCloudKey(Boolean(s.asr?.cloudApiKey))).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.library.list().then(setDemos)
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

  // 转写事件
  useEffect(() => {
    const offSeg = window.api.onEvent('asr:segment', (e) => {
      if (e.demoId === demoId) setLiveSegs((s) => [...s, e.segment])
    })
    const offProg = window.api.onEvent('asr:progress', (e) => {
      if (e.demoId === demoId)
        setProgress({ stage: e.stage, done: e.done, total: e.total, message: e.message })
    })
    return () => {
      offSeg()
      offProg()
    }
  }, [demoId])

  const runTranscribe = async () => {
    if (!demoId) return
    setTranscribing(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1 })
    try {
      await window.api.asr.transcribe(demoId)
      toast.push(t('library.transcribeDone'))
      // 转写完成刷新详情（语音列表更新）
      const d = await window.api.library.detail(demoId)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setTranscribing(false)
      setProgress(null)
    }
  }

  /** 语音分割：只提取并切分语音（不转写、无需 API Key），切完可直接逐段听 */
  const runSplit = async () => {
    if (!demoId) return
    setSplitting(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1 })
    try {
      const n = await window.api.voice.split(demoId)
      toast.push(t('transcript.splitDone').replace('{n}', String(n)))
      const d = await window.api.library.detail(demoId)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSplitting(false)
      setProgress(null)
    }
  }

  const allVoice = useMemo<VoiceSegment[]>(() => {
    const base = detail?.voice ?? []
    return [...base, ...liveSegs]
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
    const ok = await window.api.live.jumpTick(tick)
    if (!ok) toast.push(t('common.jumpHint'), 'warn')
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="title">
            {t('transcript.title')}
          </div>
          <div className="sub">{t('transcript.subtitle')}</div>
        </div>
        <div className="actions">
          <select
            className="input select"
            value={demoId ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setDemoId(v || undefined)
              // 只更新本地状态，不回写路由（避免页面常驻下路由 demoId 干扰其他入口）
              if (v) onOpenDemo(v)
            }}
          >
            <option value="">{t('transcript.selectDemo')}</option>
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName}
                {d.status === 'ready' && d.mapName ? ` · ${d.mapName}` : d.status === 'pending' ? ' · 待解析' : d.status === 'error' ? ' · 解析失败' : ''}
              </option>
            ))}
          </select>
          {/* 先分割（提取语音片段），再转写（生成文字） */}
          <Btn
            variant="accent"
            disabled={!demoId || transcribing || splitting}
            onClick={runSplit}
            title={t('transcript.splitHint')}
          >
            <IcMic size={13} />
            {splitting ? t('transcript.splitting') : t('transcript.split')}
          </Btn>
          <Btn
            variant="primary"
            disabled={!demoId || transcribing || splitting}
            onClick={runTranscribe}
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
            <div style={{ marginBottom: 12 }}>
              <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-1)' }}>
                  {progress.stage === 'voice-extract'
                    ? t('transcript.stage.extract')
                    : (progress.message || t('transcript.stage.asr'))}
                </span>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {progress.stage === 'voice-extract' ? '…' : `${progress.done}/${progress.total}`}
                </span>
              </div>
              <div className="grow" style={{ height: 4, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, var(--accent), var(--ct))',
                    transition: 'width .3s var(--ease-out)'
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
                return (
                  <span
                    key={p}
                    className={`tag ${on ? 'voice' : 'ghost'}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => togglePlayer(p)}
                  >
                    {p}
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
            <select
              className="input select"
              style={{ width: 130 }}
              value={String(round)}
              onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">{t('common.round')} · {t('common.all')}</option>
              {rounds.map((r) => (
                <option key={r.roundNum} value={r.roundNum}>
                  R{r.roundNum}
                </option>
              ))}
            </select>
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
                  {filteredVoice.map((v, i) => (
                    <VoiceRow key={`${v.tick}-${i}-${i}`} demoId={demoId!} seg={v} tickRate={detail.meta.tickRate ?? 64} onJump={jump} avatar={(detail.meta.players ?? []).find((p) => p.name === v.playerName)?.avatar} />
                  ))}
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
  onJump,
  avatar
}: {
  demoId: string
  seg: VoiceSegment
  tickRate: number
  onJump: (tick: number) => void
  avatar?: string
}) {
  const t = useTKey()
  return (
    <div className="tline">
      <span className="tm">
        {fmtTick(seg.tick, tickRate)}
        <span className="eng" style={{ marginLeft: 6 }}>
          {seg.engine === 'cloud' ? t('transcript.cloud') : t('transcript.local')}
        </span>
      </span>
      <span className="who">
        <Avatar name={seg.playerName} team={seg.team} size={18} avatar={avatar} />
        <span className={`nm ${seg.team === 'T' ? 't' : seg.team === 'CT' ? 'ct' : ''}`}>
          {seg.playerName}
        </span>
        {seg.roundNum !== undefined && <Tag tone="ghost">R{seg.roundNum}</Tag>}
      </span>
      <span className={`txt ${seg.text ? '' : 'no-text'}`}>{seg.text || t('transcript.noText')}</span>
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
      <button className="icon-btn jump" onClick={() => onJump(msg.tick)}>
        <IcChevron size={13} />
      </button>
    </div>
  )
}
