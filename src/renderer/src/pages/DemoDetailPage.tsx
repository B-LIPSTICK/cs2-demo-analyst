import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Btn,
  Empty,
  IcBack,
  IcChat,
  IcFolder,
  IcJump,
  IcTranscript,
  Panel,
  Tag,
  VoicePlayButton,
  fmtBytes,
  fmtTick,
  fmtTime,
  useToast
} from '@/components/ui'
import { useTKey } from '@/i18n'
import type { DemoDetail, KillEvent, PlayerInfo, RoundEndType, RoundInfo, TeamSide } from '@shared/types'

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
  const [player, setPlayer] = useState<PlayerInfo | null>(null)

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
    if (!ok) toast.push(t('common.jumpHint'), 'warn')
  }

  /** 播放：普通模式 = CS2 内置播放器（+exec cfg）；工具模式 = VConsole 注入；voiceHud = 游戏内语音 HUD */
  const playInCs2 = async () => {
    const s = await window.api.settings.get()
    const toolsMode = !!s.cs2?.useToolsMode
    const voiceHud = !toolsMode && !!s.cs2?.voiceHud
    if (voiceHud) toast.push(t('detail.voiceHudPreparing'))
    const r = await window.api.live.launch({ toolsMode, playDemoPath: meta.path, voiceHud })
    if (r.ok) {
      if (r.starting) toast.push(t('detail.playStarting'))
      else toast.push(r.injected ? t('detail.playInjected') : t('detail.playLaunched'))
    } else toast.push(r.error ?? t('common.error'), 'warn')
  }

  const parseAndWait = async () => {
    await window.api.library.parse(id)
    toast.push(t('library.parseStart'))
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const d = await window.api.library.detail(id)
      if (d) {
        setDetail(d)
        return
      }
    }
  }

  if (!detail) {
    return (
      <div className="page">
        <Empty ghost="DEMO" hint={t('library.notParsed')}>
          <Btn variant="accent" onClick={parseAndWait} style={{ marginTop: 8 }}>
            {t('library.parseNow')}
          </Btn>
        </Empty>
      </div>
    )
  }

  const { meta, rounds, chat, voice } = detail
  const round = selectedRound === 'all' ? null : rounds.find((r) => r.roundNum === selectedRound)
  const kills: KillEvent[] = round ? round.kills : rounds.flatMap((r) => r.kills)
  // 按时间正序：比赛开始 → 结束
  const sortedKills = [...kills].sort((a, b) => a.tick - b.tick)
  // 已转写：用转写段累计时长；未转写：回退用解析时检测到的语音时长（meta.voiceSec）
  const voiceSecs =
    voice.length > 0 ? voice.reduce((s, v) => s + (v.endSec - v.timeSec), 0) : (meta.voiceSec ?? 0)

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
                <span className="map" style={{ fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em' }}>
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
              <Btn size="sm" variant="accent" onClick={playInCs2}>
                <IcJump size={12} />
                {t('detail.playInCs2')}
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => onGoTranscript()}
                title={t('detail.goTranscriptHint')}
              >
                <IcTranscript size={12} />
                {t('detail.goTranscript')} →
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => window.api.app.revealInFolder(meta.path)}>
                <IcFolder size={12} />
              </Btn>
            </div>
          </div>

          {/* 比分条 */}
          <div className="flex" style={{ marginTop: 18, gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, lineHeight: 1, color: 'var(--t)' }}>
              {meta.scoreT}
            </span>
            <span style={{ color: 'var(--text-2)', fontSize: 18, fontFamily: 'var(--font-display)' }}>:</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, lineHeight: 1, color: 'var(--ct)' }}>
              {meta.scoreCT}
            </span>
            <div className="grow" />
            <div className="flex" style={{ gap: 26 }}>
              {[
                [t('library.duration'), fmtTime(meta.durationSec ?? 0)],
                [t('library.rounds'), String(meta.roundCount ?? 0)],
                [t('detail.voice'), `${voice.length} · ${Math.round(voiceSecs)}s`],
                [t('detail.chat'), String(chat.length)]
              ].map(([k, v]) => (
                <div key={k} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-2)' }}>{k}</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 回合结束栏（爆炸 / 拆除 / 全死 / 超时） */}
          <div style={{ marginTop: 16 }}>
            <RoundBar
              rounds={rounds}
              selectedRound={selectedRound === 'all' ? undefined : selectedRound}
              onSelectRound={(r) => setSelectedRound((cur) => (cur === r ? 'all' : r))}
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
          <div className="tbl-wrap" style={{ padding: '6px 0' }}>
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
                  <tr
                    key={p.steamId}
                    className="player-row"
                    onClick={() => setPlayer(p)}
                    title={t('detail.playerDetail')}
                  >
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <span className="flex gap-8" style={{ alignItems: 'center' }}>
                        <Avatar name={p.name} team={p.team} size={20} avatar={p.avatar} />
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
              meta.hasVoice === true ? (
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                  <span className="muted">
                    {t('detail.voiceDetected').replace('{s}', String(Math.round(voiceSecs)))}
                  </span>
                  <div style={{ marginTop: 8 }}>
                    <Btn size="sm" variant="accent" onClick={onGoTranscript}>
                      {t('library.transcribe')} →
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('detail.noVoice')} · {t('detail.voiceHint')}
                </div>
              )
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {voice.slice(0, 80).map((v, i) => (
                  <div key={i} className="tline" onClick={() => jump(v.tick)}>
                    <span className="tm">{fmtTick(v.tick, meta.tickRate ?? 64)}</span>
                    <span className="who">
                      <Avatar
                        name={v.playerName}
                        team={v.team}
                        size={16}
                        avatar={(meta.players ?? []).find((x) => x.name === v.playerName)?.avatar}
                      />
                      <span className={`nm ${v.team === 'T' ? 't' : v.team === 'CT' ? 'ct' : ''}`}>{v.playerName}</span>
                    </span>
                    <span className={`txt ${v.text ? '' : 'no-text'}`}>{v.text || t('transcript.noText')}</span>
                    <VoicePlayButton
                      demoId={id}
                      seg={{ steamId: v.steamId, playerName: v.playerName, startSec: v.timeSec, endSec: v.endSec }}
                      size={13}
                    />
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

      {/* 选手详情弹窗 */}
      {player && (
        <PlayerModal
          player={player}
          kills={kills}
          tickRate={meta.tickRate ?? 64}
          onJump={jump}
          onClose={() => setPlayer(null)}
        />
      )}
    </div>
  )
}

/** 击杀标记图标：爆头（红骷髅）+ 穿烟（灰云），一眼可辨 */
function KillIcons({ kill }: { kill: KillEvent }) {
  return (
    <span className="kill-icons">
      {kill.headshot && (
        <span title="爆头">
          <svg className="hs" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a8 8 0 0 0-8 8c0 2.5 1.2 4.7 3 6v3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3c1.8-1.3 3-3.5 3-6a8 8 0 0 0-8-8zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16c.8.8 1.9 1.3 3 1.3s2.2-.5 3-1.3c-.9.6-1.9.9-3 .9s-2.1-.3-3-.9z" />
          </svg>
        </span>
      )}
      {kill.throughSmoke && (
        <span title="穿烟">
          <svg className="smoke" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.2 18a4.2 4.2 0 0 1-.3-8.4 5.2 5.2 0 0 1 10-1.8 4.6 4.6 0 0 1 .4 9.2 1 1 0 0 1-.2 0H7.2z" />
            <path d="M10 21a1 1 0 0 1-.2-2h4.4a1 1 0 0 1-.2 2H10z" />
          </svg>
        </span>
      )}
    </span>
  )
}

/** 回合结束方式图标（SVG 原色，不着阵营色） */
function RoundIcon({ type }: { type: RoundEndType }) {
  const style = { width: 13, height: 13, display: 'block' } as const
  switch (type) {
    case 'bomb_exploded':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
          <path d="M12 2l2 3 3-.5-.7 3.2 3.2 2.8-3.7 1.3 1 3.7-3.8-1.4-2.3 3.4-.7-3.6L6 13l1.6-2.9L7 6.5l3 .3L12 2z" />
        </svg>
      )
    case 'bomb_defused':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
          <path d="M21.7 5.4l-3.8 3.8a3 3 0 0 1-4.1 0L9.6 5a3 3 0 0 1-.9-2.4A7 7 0 0 0 3.6 9l4.2 4.2-1 1a2.1 2.1 0 1 0 3 3l1-1L15 20.4A7 7 0 0 0 21.4 6.3 3 3 0 0 1 19 7.2l-3.6-3.6 4-4H21v5.8z" />
        </svg>
      )
    case 'elimination':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
          <path d="M12 2a8 8 0 0 0-8 8c0 2.5 1.2 4.7 3 6v3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3c1.8-1.3 3-3.5 3-6a8 8 0 0 0-8-8zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16c.8.8 1.9 1.3 3 1.3s2.2-.5 3-1.3c-.9.6-1.9.9-3 .9s-2.1-.3-3-.9z" />
        </svg>
      )
    case 'timeout':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.3V16h-2v-4.4l-2.9-1.7 1-1.7 3.9 2.1z" />
        </svg>
      )
    default:
      return null
  }
}

/** 回合结束栏：每回合显示结束方式图标（爆炸/拆除/全死/超时），无信息回合显示占位 */
function RoundBar({
  rounds,
  selectedRound,
  onSelectRound
}: {
  rounds: RoundInfo[]
  selectedRound?: number
  onSelectRound: (roundNum: number) => void
}) {
  return (
    <div className="round-grid">
      {rounds.map((r) => {
        const endLabel =
          r.endType === 'bomb_exploded'
            ? '爆炸'
            : r.endType === 'bomb_defused'
              ? '拆除'
              : r.endType === 'elimination'
                ? '全死'
                : r.endType === 'timeout'
                  ? '超时'
                  : ''
        return (
          <div
            key={r.roundNum}
            className={`round-cell ${r.winner === 'T' ? 'win-t' : r.winner === 'CT' ? 'win-ct' : ''} ${
              selectedRound === r.roundNum ? 'active' : ''
            }`}
            onClick={() => onSelectRound(r.roundNum)}
            title={`R${r.roundNum} · ${r.winner === 'T' ? 'T' : r.winner === 'CT' ? 'CT' : '-'} 胜 · ${endLabel || '未知'}`}
          >
            <div className="rc-icon">
              {r.endType !== 'unknown' ? <RoundIcon type={r.endType} /> : <span className="rc-empty">·</span>}
            </div>
            <div className={`rc-r ${r.winner === 'T' ? 't' : r.winner === 'CT' ? 'ct' : ''}`}>{r.roundNum}</div>
          </div>
        )
      })}
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
  return (
    <div className="kill-row" onClick={() => onJump(kill.tick)}>
      <span className="tk">{fmtTick(kill.tick, tickRate)}</span>
      <span className={`nm ${kill.attackerTeam === 'T' ? 't' : kill.attackerTeam === 'CT' ? 'ct' : ''}`}>
        {kill.attackerName ?? '—'}
      </span>
      <span className="wp">
        {kill.weapon}
        <KillIcons kill={kill} />
      </span>
      <span className={`nm ${kill.victimTeam === 'T' ? 't' : kill.victimTeam === 'CT' ? 'ct' : ''}`}>
        {kill.victimName ?? '—'}
      </span>
      <span className="rn">R{kill.roundNum}</span>
    </div>
  )
}

/** 选手详情弹窗：个人数据 + 武器击杀统计 + 击杀列表（可跳转） */
function PlayerModal({
  player,
  kills,
  tickRate,
  onJump,
  onClose
}: {
  player: PlayerInfo
  kills: KillEvent[]
  tickRate: number
  onJump: (tick: number) => void
  onClose: () => void
}) {
  const t = useTKey()
  const myKills = useMemo(
    () =>
      kills.filter((k) =>
        k.attackerSteamId ? k.attackerSteamId === player.steamId : k.attackerName === player.name
      ),
    [kills, player]
  )
  const byWeapon = useMemo(() => {
    const map = new Map<string, number>()
    for (const k of myKills) map.set(k.weapon, (map.get(k.weapon) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [myKills])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal player-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-head">
          <Avatar name={player.name} team={player.team} size={46} avatar={player.avatar} />
          <div style={{ minWidth: 0 }}>
            <div className="pm-name">{player.name}</div>
            <div className="pm-sub">
              {player.team === 'T' ? 'T 队' : player.team === 'CT' ? 'CT 队' : '—'}
            </div>
          </div>
          <div className="grow" />
          <Btn variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Btn>
        </div>

        <div className="pm-stats">
          <div className="pm-stat">
            <span>{t('detail.hud.kills')}</span>
            <b>{player.kills}</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.deaths')}</span>
            <b>{player.deaths}</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.hs')}</span>
            <b>{player.hsp}%</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.mvp')}</span>
            <b>{player.mvp}</b>
          </div>
        </div>

        <div className="pm-section">{t('detail.playerWeapons')}</div>
        <div className="pm-weapons">
          {byWeapon.map(([w, n]) => (
            <span key={w} className="pm-weapon">
              <b>{n}</b> {w}
            </span>
          ))}
          {byWeapon.length === 0 && <span className="muted">—</span>}
        </div>

        <div className="pm-section">
          {t('detail.playerKills')}（{myKills.length}）
        </div>
        <div className="pm-kills">
          {[...myKills]
            .sort((a, b) => b.tick - a.tick)
            .slice(0, 80)
            .map((k, i) => (
              <div
                key={`${k.tick}-${i}`}
                className="pm-kill"
                onClick={() => {
                  onJump(k.tick)
                  onClose()
                }}
              >
                <span className="tm">{fmtTick(k.tick, tickRate)}</span>
                <span className="wp">
                  {k.weapon}
                  <KillIcons kill={k} />
                </span>
                <span className="vic">{k.victimName ?? '—'}</span>
                <span className="rn">R{k.roundNum}</span>
              </div>
            ))}
        </div>
      </div>
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
