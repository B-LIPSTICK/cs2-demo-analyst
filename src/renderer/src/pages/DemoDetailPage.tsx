import { useEffect, useState } from 'react'
import {
  Avatar,
  Btn,
  Empty,
  IcBack,
  IcChat,
  IcFolder,
  IcJump,
  IcLive,
  IcMic,
  IcTranscript,
  Panel,
  Tag,
  fmtBytes,
  fmtTick,
  fmtTime,
  useToast
} from '@/components/ui'
import { Timeline } from '@/components/Timeline'
import { useTKey } from '@/i18n'
import type { DemoDetail, KillEvent, RoundInfo, TeamSide } from '@shared/types'

export function DemoDetailPage({
  id,
  onBack,
  onGoTranscript
}: {
  id: string
  onBack: () => void
  onGoTranscript: () => void
}) {
  const t = useTKey()
  const toast = useToast()
  const [detail, setDetail] = useState<DemoDetail | null>(null)
  const [selectedRound, setSelectedRound] = useState<number | 'all'>('all')

  useEffect(() => {
    let alive = true
    setDetail(null)
    window.api.library.detail(id).then((d) => {
      if (alive) setDetail(d)
    })
    return () => {
      alive = false
    }
  }, [id])

  const jump = async (tick: number) => {
    const ok = await window.api.live.jumpTick(tick)
    if (!ok) toast.push(t('common.notimpl'), 'warn')
  }

  if (!detail) {
    return (
      <div className="page">
        <Empty ghost="LOADING" hint="…" />
      </div>
    )
  }

  const { meta, rounds, chat, voice } = detail
  const round = selectedRound === 'all' ? null : rounds.find((r) => r.roundNum === selectedRound)
  const kills: KillEvent[] = round ? round.kills : rounds.flatMap((r) => r.kills)
  const sortedKills = [...kills].sort((a, b) => b.tick - a.tick)
  const voiceSecs = voice.reduce((s, v) => s + (v.endSec - v.timeSec), 0)

  return (
    <div className="page">
      {/* HUD 头部 */}
      <Panel className="hud-accent" raised>
        <div className="panel-bd" style={{ padding: 18 }}>
          <div className="flex between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="flex gap-8" style={{ alignItems: 'center' }}>
                <Btn variant="ghost" size="sm" onClick={onBack}>
                  <IcBack size={12} />
                  {t('common.back')}
                </Btn>
                <span className="map" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  {meta.mapName}
                </span>
                {meta.hasVoice === true && (
                  <Tag tone="voice" dot>
                    {t('library.voice')} · {Math.round(voiceSecs)}s
                  </Tag>
                )}
              </div>
              <div className="file muted" style={{ marginTop: 6, fontSize: 11 }} title={meta.path}>
                {meta.fileName} · {fmtBytes(meta.sizeBytes)}
              </div>
            </div>
            <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Btn
                size="sm"
                variant="accent"
                onClick={async () => {
                  const r = await window.api.live.launch({ toolsMode: false, playDemoPath: meta.path })
                  if (r.ok) toast.push(t('detail.playLaunched'))
                  else toast.push(r.error ?? t('common.error'), 'warn')
                }}
              >
                <IcJump size={12} />
                {t('detail.playInCs2')}
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                onClick={async () => {
                  await window.api.overlay.setFullPanel(true, id)
                  toast.push('FULL PANEL ON')
                }}
              >
                <IcLive size={12} />
                全屏面板
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await window.api.overlay.setEnabled(true, id)
                  toast.push('OVERLAY ON · demo sim')
                }}
              >
                <IcLive size={12} />
                OVERLAY
              </Btn>
              <Btn
                size="sm"
                onClick={async () => {
                  try {
                    const n = await window.api.voice.extract(id)
                    toast.push(n > 0 ? `VOICE ×${n} · ${t('library.extractVoice')} ✓` : t('detail.noVoice'), n > 0 ? 'ok' : 'warn')
                  } catch (err) {
                    toast.push(err instanceof Error ? err.message : String(err), 'err')
                  }
                }}
              >
                <IcMic size={12} />
                {t('library.extractVoice')}
              </Btn>
              <Btn size="sm" variant="primary" onClick={() => onGoTranscript()}>
                <IcTranscript size={12} />
                {t('library.transcribe')}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => window.api.app.revealInFolder(meta.path)}>
                <IcFolder size={12} />
              </Btn>
            </div>
          </div>

          {/* 比分条 */}
          <div className="flex" style={{ marginTop: 18, gap: 14, alignItems: 'center' }}>
            <div className="flex gap-8" style={{ alignItems: 'center', minWidth: 0 }}>
              <span className="tag t">{meta.teamT ?? 'T'}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, lineHeight: 1, color: 'var(--t)' }}>
                {meta.scoreT}
              </span>
            </div>
            <span style={{ color: 'var(--text-2)', fontSize: 18, fontFamily: 'var(--font-display)' }}>:</span>
            <div className="flex gap-8" style={{ alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, lineHeight: 1, color: 'var(--ct)' }}>
                {meta.scoreCT}
              </span>
              <span className="tag ct">{meta.teamCT ?? 'CT'}</span>
            </div>
            <div className="grow" />
            <div className="flex" style={{ gap: 26 }}>
              {[
                [t('library.duration'), fmtTime(meta.durationSec ?? 0)],
                [t('library.rounds'), String(meta.roundCount ?? 0)],
                [t('detail.voice'), `${voice.length} · ${Math.round(voiceSecs)}s`],
                [t('detail.chat'), String(chat.length)]
              ].map(([k, v]) => (
                <div key={k} style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-2)', textTransform: 'uppercase' }}>{k}</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 时间轴 */}
          <div style={{ marginTop: 20 }}>
            <Timeline
              rounds={rounds}
              voice={voice}
              firstTick={detail.firstTick}
              lastTick={detail.lastTick}
              tickRate={meta.tickRate ?? 64}
              selectedRound={selectedRound === 'all' ? undefined : selectedRound}
              onSelectRound={(r) => setSelectedRound((cur) => (cur === r ? 'all' : r))}
              onJumpTick={jump}
            />
          </div>
        </div>
      </Panel>

      <div className="grid-3" style={{ marginTop: 16 }}>
        {/* 击杀流 */}
        <Panel hd={`${t('detail.killfeed')} · ${selectedRound === 'all' ? t('common.all') : `R${selectedRound}`}`}>
          <div style={{ padding: '10px 0' }}>
            <div className="seg" style={{ margin: '0 12px 8px' }}>
              <span
                className={`seg-item ${selectedRound === 'all' ? 'on' : ''}`}
                onClick={() => setSelectedRound('all')}
              >
                {t('common.all')}
              </span>
              {rounds.map((r) => (
                <span
                  key={r.roundNum}
                  className={`seg-item ${selectedRound === r.roundNum ? 'on' : ''}`}
                  onClick={() => setSelectedRound(r.roundNum)}
                >
                  {r.roundNum}
                </span>
              ))}
            </div>
            <div className="kill-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {sortedKills.map((k, i) => (
                <KillRow key={`${k.tick}-${i}`} kill={k} tickRate={meta.tickRate ?? 64} onJump={jump} />
              ))}
              {sortedKills.length === 0 && (
                <div className="muted" style={{ padding: '18px 12px', fontSize: 12 }}>
                  —
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* 选手数据 */}
        <Panel hd={t('detail.players')}>
          <div style={{ padding: '6px 0' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('detail.players')}</th>
                  <th>{t('detail.hud.kills')}</th>
                  <th>{t('detail.hud.deaths')}</th>
                  <th>{t('detail.hud.hs')}</th>
                  <th>{t('detail.hud.mvp')}</th>
                </tr>
              </thead>
              <tbody>
                {(meta.players ?? []).map((p, i) => (
                  <tr key={p.steamId}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <span className="flex gap-8" style={{ alignItems: 'center' }}>
                        <Avatar name={p.name} team={p.team} size={18} />
                        <span className={`nm ${p.team === 'T' ? 't' : p.team === 'CT' ? 'ct' : ''}`}>{p.name}</span>
                      </span>
                    </td>
                    <td className="num">{p.kills}</td>
                    <td className="num">{p.deaths}</td>
                    <td className="num">{p.hsp}%</td>
                    <td className="num">{p.mvp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* 回合详情 */}
      {round && <RoundStrip round={round} tickRate={meta.tickRate ?? 64} onJump={jump} />}

      {/* 语音 / 聊天概要 */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        <Panel hd={t('detail.voice')} dot={voice.length > 0}>
          <div className="panel-bd">
            {voice.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {t('detail.noVoice')} · {t('detail.voiceHint')}
              </div>
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {voice.slice(0, 80).map((v, i) => (
                  <div key={i} className="tline" onClick={() => jump(v.tick)}>
                    <span className="tm">{fmtTick(v.tick, meta.tickRate ?? 64)}</span>
                    <span className="who">
                      <Avatar name={v.playerName} team={v.team} size={16} />
                      <span className={`nm ${v.team === 'T' ? 't' : v.team === 'CT' ? 'ct' : ''}`}>{v.playerName}</span>
                    </span>
                    <span className="txt">{v.text}</span>
                    <span className="jump">
                      <IcJump size={13} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
        <Panel hd={t('detail.chat')}>
          <div className="panel-bd">
            {chat.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>—</div>
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {chat.slice(-60).reverse().map((c, i) => (
                  <div key={i} className="tline" onClick={() => jump(c.tick)}>
                    <span className="tm">{fmtTick(c.tick, meta.tickRate ?? 64)}</span>
                    <span className="who">
                      <Avatar name={c.playerName} team={playerTeam(c, meta.players)} size={16} />
                      <span className="nm">{c.playerName}</span>
                    </span>
                    <span className="txt">{c.text}</span>
                    <span className="jump">
                      <IcChat size={12} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function KillRow({
  kill,
  tickRate,
  onJump
}: {
  kill: KillEvent
  tickRate: number
  onJump: (tick: number) => void
}) {
  const t = useTKey()
  return (
    <div className="kill-row" onClick={() => onJump(kill.tick)}>
      <span className="tk">{fmtTick(kill.tick, tickRate)}</span>
      <span className={`nm ${kill.attackerTeam === 'T' ? 't' : kill.attackerTeam === 'CT' ? 'ct' : ''}`}>
        {kill.attackerName ?? '—'}
      </span>
      <span className="wp">
        {kill.weapon}
        {kill.headshot && (
          <svg className="hs" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2c1.6 2.5 1.6 4.5 0 6-1.6-1.5-1.6-3.5 0-6zm-7 9h6l-2-7 9 9-9 9 2-7H5z" />
          </svg>
        )}
        {kill.throughSmoke && <span style={{ color: 'var(--text-2)' }}>SMK</span>}
      </span>
      <span className={`nm ${kill.victimTeam === 'T' ? 't' : kill.victimTeam === 'CT' ? 'ct' : ''}`}>
        {kill.victimName ?? '—'}
      </span>
      <span className="tk" style={{ textAlign: 'right' }}>
        R{kill.roundNum} · {t('common.tick')}
      </span>
    </div>
  )
}

function RoundStrip({
  round,
  tickRate,
  onJump
}: {
  round: RoundInfo
  tickRate: number
  onJump: (tick: number) => void
}) {
  const t = useTKey()
  const endLabel = (() => {
    switch (round.endType) {
      case 'bomb_exploded':
        return t('detail.bombExploded')
      case 'bomb_defused':
        return t('detail.bombDefused')
      case 'elimination':
        return t('detail.elimination')
      case 'timeout':
        return t('detail.timeout')
      case 'surrender':
        return t('detail.surrender')
      default:
        return t('detail.unknownEnd')
    }
  })()
  return (
    <Panel raised style={{ marginTop: 16 }}>
      <div className="panel-bd flex" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Tag tone={round.winner === 'T' ? 't' : 'ct'} dot>
          R{round.roundNum} · {round.winner === 'T' ? 'T' : round.winner === 'CT' ? 'CT' : '—'}
        </Tag>
        <span className="muted" style={{ fontSize: 12 }}>
          {endLabel} · {round.kills.length} kills
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {fmtTick(round.startTick, tickRate)} → {fmtTick(round.endTick, tickRate)}
        </span>
        {round.bombPlantedTick && (
          <Btn size="sm" variant="ghost" onClick={() => onJump(round.bombPlantedTick!)}>
            {t('detail.bombPlanted')} {fmtTick(round.bombPlantedTick, tickRate)}
          </Btn>
        )}
        {round.bombDefusedTick && (
          <Btn size="sm" variant="ghost" onClick={() => onJump(round.bombDefusedTick!)}>
            {t('detail.bombDefused')} {fmtTick(round.bombDefusedTick, tickRate)}
          </Btn>
        )}
        {round.bombExplodedTick && (
          <Btn size="sm" variant="ghost" onClick={() => onJump(round.bombExplodedTick!)}>
            {t('detail.bombExploded')} {fmtTick(round.bombExplodedTick, tickRate)}
          </Btn>
        )}
        <Btn size="sm" variant="accent" onClick={() => onJump(round.startTick)}>
          <IcJump size={12} />
          R{round.roundNum}
        </Btn>
      </div>
    </Panel>
  )
}

function playerTeam(
  c: { playerName: string; steamId?: string },
  players?: DemoDetail['meta']['players']
): TeamSide {
  const p = players?.find((x) => x.steamId === c.steamId || x.name === c.playerName)
  return p?.team ?? 'NONE'
}
