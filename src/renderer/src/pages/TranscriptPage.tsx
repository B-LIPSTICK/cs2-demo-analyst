import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Btn,
  Empty,
  IcChevron,
  IcDownload,
  IcJump,
  IcLive,
  IcMic,
  IcSearch,
  Panel,
  Tag,
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

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
      if (e.demoId === demoId) setProgress({ done: e.done, total: e.total })
    })
    return () => {
      offSeg()
      offProg()
    }
  }, [demoId])

  const runTranscribe = async () => {
    if (!demoId) return
    setTranscribing(true)
    setProgress({ done: 0, total: 1 })
    try {
      await window.api.asr.transcribe(demoId)
      toast.push(t('library.transcribeDone'))
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setTranscribing(false)
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
    if (!ok) toast.push(t('common.notimpl'), 'warn')
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
              onOpenDemo(v)
            }}
          >
            <option value="">{t('transcript.selectDemo')}</option>
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.mapName ?? d.fileName} · {d.fileName}
              </option>
            ))}
          </select>
          <Btn
            variant="primary"
            disabled={!demoId || transcribing}
            onClick={runTranscribe}
          >
            <IcMic size={13} />
            {transcribing ? t('library.transcribing') : t('library.transcribe')}
          </Btn>
          <Btn
            variant="ghost"
            onClick={async () => {
              if (!demoId) return
              await window.api.overlay.setEnabled(true, demoId)
              toast.push('OVERLAY ON')
            }}
          >
            <IcLive size={13} />
            OVERLAY
          </Btn>
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
          {/* 进度条 */}
          {progress && (
            <div className="flex gap-8" style={{ alignItems: 'center', marginBottom: 12 }}>
              <div className="grow" style={{ height: 3, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden' }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, var(--green), var(--ct))',
                    transition: 'width .3s var(--ease-out)'
                  }}
                />
              </div>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {progress.done}/{progress.total}
              </span>
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
                    <VoiceRow key={`${v.tick}-${i}-${i}`} seg={v} tickRate={detail.meta.tickRate ?? 64} onJump={jump} />
                  ))}
                </div>
              )
            ) : filteredChat.length === 0 ? (
              <Empty ghost="NO CHAT" hint="—" />
            ) : (
              <div style={{ maxHeight: 560, overflowY: 'auto', padding: '8px 0' }}>
                {filteredChat.map((c, i) => (
                  <ChatRow key={i} msg={c} tickRate={detail.meta.tickRate ?? 64} onJump={jump} />
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
  seg,
  tickRate,
  onJump
}: {
  seg: VoiceSegment
  tickRate: number
  onJump: (tick: number) => void
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
        <Avatar name={seg.playerName} team={seg.team} size={18} />
        <span className={`nm ${seg.team === 'T' ? 't' : seg.team === 'CT' ? 'ct' : ''}`}>
          {seg.playerName}
        </span>
        {seg.roundNum !== undefined && <Tag tone="ghost">R{seg.roundNum}</Tag>}
      </span>
      <span className="txt">{seg.text}</span>
      <button className="icon-btn jump" onClick={() => onJump(seg.tick)} title={t('transcript.jump')}>
        <IcJump size={13} />
      </button>
    </div>
  )
}

function ChatRow({
  msg,
  tickRate,
  onJump
}: {
  msg: ChatMessage
  tickRate: number
  onJump: (tick: number) => void
}) {
  return (
    <div className="tline">
      <span className="tm">{fmtTick(msg.tick, tickRate)}</span>
      <span className="who">
        <Avatar name={msg.playerName} team="NONE" size={18} />
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
