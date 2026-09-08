import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Btn,
  Empty,
  IcBack,
  IcChat,
  IcChevronLeft,
  IcChevronRight,
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
    window.api.library.detail(id).then(async (d) => {
      if (!alive) return
      if (d) {
        setDetail(d)
      } else {
        // 详情缓存失效（解析器升级）→ 检查 index 中 meta 状态并自动重新解析
        const list = await window.api.library.list().catch(() => [])
        const m = list.find((item) => item.id === id)
        if (m?.status === 'ready') {
          window.api.library.parse(id).then(() => {
            const poll = setInterval(async () => {
              const nd = await window.api.library.detail(id)
              if (nd) {
                clearInterval(poll)
                if (alive) setDetail(nd)
              }
            }, 500)
            setTimeout(() => clearInterval(poll), 60000)
          })
        }
      }
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
    if (!detail) return
    const s = await window.api.settings.get()
    const toolsMode = !!s.cs2?.useToolsMode
    const voiceHud = !toolsMode && !!s.cs2?.voiceHud
    if (voiceHud) toast.push(t('detail.voiceHudPreparing'))
    const r = await window.api.live.launch({ toolsMode, playDemoPath: detail.meta.path, voiceHud })
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
  const allKills = useMemo(() => rounds.flatMap((r) => r.kills), [rounds])
  const round = selectedRound === 'all' ? null : rounds.find((r) => r.roundNum === selectedRound)
  const feedKills = round ? round.kills : allKills
  // 击杀流按时间正序：比赛开始 → 结束
  const sortedKills = useMemo(() => [...feedKills].sort((a, b) => a.tick - b.tick), [feedKills])
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
        <Panel
          hd={
            <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>{`${t('detail.killfeed')} · ${selectedRound === 'all' ? t('common.all') : `R${selectedRound}`}`}</span>
              {rounds.length > 0 && (
                <div className="header-steppers">
                  <button
                    type="button"
                    className="step-btn"
                    disabled={selectedRound === 'all'}
                    onClick={() => {
                      if (selectedRound !== 'all') {
                        const idx = rounds.findIndex((r) => r.roundNum === selectedRound)
                        if (idx > 0) setSelectedRound(rounds[idx - 1].roundNum)
                        else setSelectedRound('all')
                      }
                    }}
                    title="切换到上一回合"
                  >
                    <IcChevronLeft size={11} />
                    <span>上一局</span>
                  </button>
                  <button
                    type="button"
                    className="step-btn"
                    disabled={selectedRound === rounds[rounds.length - 1]?.roundNum}
                    onClick={() => {
                      if (selectedRound === 'all') {
                        if (rounds.length > 0) setSelectedRound(rounds[0].roundNum)
                      } else {
                        const idx = rounds.findIndex((r) => r.roundNum === selectedRound)
                        if (idx >= 0 && idx < rounds.length - 1) {
                          setSelectedRound(rounds[idx + 1].roundNum)
                        }
                      }
                    }}
                    title="切换到下一回合"
                  >
                    <span>下一局</span>
                    <IcChevronRight size={11} />
                  </button>
                </div>
              )}
            </div>
          }
        >
          <div style={{ padding: '10px 0' }}>
            <RoundFilterBar
              rounds={rounds}
              selectedRound={selectedRound}
              onSelectRound={setSelectedRound}
              allLabel={t('common.all')}
            />
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
                  <th>{t('detail.hud.rating')}</th>
                  <th>{t('detail.hud.adr')}</th>
                  <th>{t('detail.hud.kast')}</th>
                  <th>{t('detail.hud.kills')}</th>
                  <th>{t('detail.hud.deaths')}</th>
                  <th>{t('detail.hud.hs')}</th>
                  <th>{t('detail.hud.fkfd')}</th>
                  <th>{t('detail.hud.ud')}</th>
                  <th>{t('detail.hud.fa')}</th>
                  <th>{t('detail.hud.mvp')}</th>
                </tr>
              </thead>
              <tbody>
                {(meta.players ?? []).map((p, i) => (
                  <tr
                    key={p.steamId || p.name}
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
                    <td
                      className={`num ${p.rating && p.rating >= 1.2 ? 'win-rating' : p.rating && p.rating < 0.85 ? 'low-rating' : ''}`}
                      style={{ fontWeight: 700 }}
                    >
                      {p.rating !== undefined ? p.rating.toFixed(2) : '—'}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{p.adr !== undefined ? p.adr : '—'}</td>
                    <td className="num">{p.kast !== undefined ? `${p.kast}%` : '—'}</td>
                    <td className="num">{p.kills}</td>
                    <td className="num">{p.deaths}</td>
                    <td className="num">{p.hsp}%</td>
                    <td className="num">{p.firstKills !== undefined ? `${p.firstKills}/${p.firstDeaths ?? 0}` : '—'}</td>
                    <td
                      className="num"
                      title={`总投掷伤害: ${p.utilityDamage ?? 0} · 局均: ${p.utilityDamagePerRound ?? 0}`}
                    >
                      {p.utilityDamage ?? 0}
                    </td>
                    <td
                      className="num"
                      title={`闪光助攻: ${p.flashAssists ?? 0} · 致盲敌方: ${p.enemiesBlinded ?? 0}次 (${p.enemyBlindDuration ?? 0}s) · 误闪队友: ${p.teammatesBlinded ?? 0}次 (${p.teamBlindDuration ?? 0}s)`}
                    >
                      {p.flashAssists ?? 0}
                    </td>
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
                      <Avatar
                        name={c.playerName}
                        team={playerTeam(c, meta.players)}
                        size={16}
                        avatar={(meta.players ?? []).find((x) => x.name === c.playerName)?.avatar}
                      />
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
          kills={allKills}
          tickRate={meta.tickRate ?? 64}
          onJump={jump}
          onClose={() => setPlayer(null)}
        />
      )}
    </div>
  )
}

/** 击杀标记图标：爆头（CS2经典红骷髅）+ 闪光助攻（闪电）+ 穿烟（烟雾）+ 穿墙（穿透矢量）+ 盲狙（十字准星划线）+ 致盲反杀（高辨识眼睛划线） */
function KillIcons({ kill }: { kill: KillEvent }) {
  return (
    <span className="kill-icons">
      {kill.headshot && (
        <span title="爆头击杀" className="kill-icon hs">
          <svg viewBox="0 0 512 512" fill="currentColor">
            <path d="M256 32C150 32 64 118 64 224c0 62 29.6 117.2 75.8 152.2V448c0 17.7 14.3 32 32 32h168.4c17.7 0 32-14.3 32-32v-71.8C418.4 341.2 448 286 448 224 448 118 362 32 256 32zm-64 160c22.1 0 40 17.9 40 40s-17.9 40-40 40-40-17.9-40-40 17.9-40 40-40zm128 0c22.1 0 40 17.9 40 40s-17.9 40-40 40-40-17.9-40-40 17.9-40 40-40zm-96 144h64v32h-64v-32zm-32 48h128v32H192v-32z" />
          </svg>
        </span>
      )}
      {kill.flashAssist && (
        <span title="闪光助攻" className="kill-icon flash">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </span>
      )}
      {kill.throughSmoke && (
        <span title="穿烟击杀" className="kill-icon smoke">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        </span>
      )}
      {kill.penetrated && (
        <span title="穿墙击杀" className="kill-icon wallbang">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="10" y="3" width="4" height="18" rx="1" fill="currentColor" fillOpacity="0.3" />
            <line x1="2" y1="12" x2="22" y2="12" strokeWidth="2.2" />
            <polyline points="17 7 22 12 17 17" strokeWidth="2.2" />
          </svg>
        </span>
      )}
      {kill.noScope && (
        <span title="盲狙击杀 (未开镜)" className="kill-icon noscope">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="7.5" />
            <line x1="12" y1="1" x2="12" y2="5.5" />
            <line x1="12" y1="18.5" x2="12" y2="23" />
            <line x1="1" y1="12" x2="5.5" y2="12" />
            <line x1="18.5" y1="12" x2="23" y2="12" />
            <line x1="4" y1="4" x2="20" y2="20" strokeWidth="2.2" />
          </svg>
        </span>
      )}
      {kill.attackerBlind && (
        <span title="致盲反杀 (被白状态下击杀)" className="kill-icon blindkill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" fill="currentColor" fillOpacity="0.15" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.4" />
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
      // 拆除：🔧
      return <span style={{ fontSize: 13, lineHeight: 1 }}>🔧</span>
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

/** 击杀流对局快速筛选条（支持左右导航步进按钮、普通/水平滚轮滑动与居中高亮） */
function RoundFilterBar({
  rounds,
  selectedRound,
  onSelectRound,
  allLabel
}: {
  rounds: RoundInfo[]
  selectedRound: number | 'all'
  onSelectRound: (r: number | 'all') => void
  allLabel: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkScroll, rounds])

  // 鼠标滚轮在筛选栏上方平滑横向滚动（支持普通鼠标 deltaY 与左右滚轮 deltaX）
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollRef.current) {
      if (e.deltaY !== 0) {
        scrollRef.current.scrollLeft += e.deltaY
      } else if (e.deltaX !== 0) {
        scrollRef.current.scrollLeft += e.deltaX
      }
      checkScroll()
    }
  }

  const scrollStep = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return
    const step = dir === 'left' ? -150 : 150
    scrollRef.current.scrollBy({ left: step, behavior: 'smooth' })
    setTimeout(checkScroll, 200)
  }

  // 选中特定回合时自动平滑滚动至视口中央
  useEffect(() => {
    if (selectedRound !== 'all' && scrollRef.current) {
      const activeBtn = scrollRef.current.querySelector('.rf-item.on') as HTMLElement
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
    checkScroll()
  }, [selectedRound, checkScroll])

  return (
    <div className="round-filter-wrap">
      <button
        type="button"
        className="rf-nav-btn prev"
        disabled={!canScrollLeft}
        onClick={() => scrollStep('left')}
        title="向左滚动对局"
      >
        <IcChevronLeft size={12} />
      </button>

      <div
        className="round-filter-scroll"
        ref={scrollRef}
        onScroll={checkScroll}
        onWheel={handleWheel}
      >
        <button
          type="button"
          className={`rf-item all-btn ${selectedRound === 'all' ? 'on' : ''}`}
          onClick={() => onSelectRound('all')}
        >
          {allLabel}
        </button>
        {rounds.map((r) => {
          const isWinnerT = r.winner === 'T'
          const isWinnerCT = r.winner === 'CT'
          return (
            <button
              key={r.roundNum}
              type="button"
              className={`rf-item ${selectedRound === r.roundNum ? 'on' : ''}`}
              onClick={() => onSelectRound(r.roundNum)}
              title={`R${r.roundNum} · ${isWinnerT ? 'T 胜' : isWinnerCT ? 'CT 胜' : ''}`}
            >
              <span className="rf-num">{r.roundNum}</span>
              {(isWinnerT || isWinnerCT) && (
                <span className={`rf-dot ${isWinnerT ? 't' : 'ct'}`} />
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="rf-nav-btn next"
        disabled={!canScrollRight}
        onClick={() => scrollStep('right')}
        title="向右滚动对局"
      >
        <IcChevronRight size={12} />
      </button>
    </div>
  )
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
  // 自杀/环境击杀（attacker 与 victim 同一人，或 attacker=世界 65535）
  const isSuicide = kill.attackerUid === kill.victimUid || kill.attackerUid === 65535
  const attackerLabel = isSuicide ? '' : (kill.attackerName ?? '—')
  const victimLabel = isSuicide ? (kill.attackerName ?? kill.victimName ?? '—') : (kill.victimName ?? '—')
  return (
    <div className="kill-row" onClick={() => onJump(kill.tick)}>
      <span className="tk">{fmtTick(kill.tick, tickRate)}</span>
      <span
        className={`nm atk ${kill.attackerTeam === 'T' ? 't' : kill.attackerTeam === 'CT' ? 'ct' : ''}`}
        title={attackerLabel}
      >
        {attackerLabel}
      </span>
      <span className="wp">
        <span className="wp-name">{isSuicide ? '自杀' : kill.weapon}</span>
        <KillIcons kill={kill} />
      </span>
      <span
        className={`nm vic ${kill.victimTeam === 'T' ? 't' : kill.victimTeam === 'CT' ? 'ct' : ''}`}
        title={victimLabel}
      >
        {victimLabel}
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

        <div className="pm-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="pm-stat">
            <span>{t('detail.hud.rating')}</span>
            <b style={{ color: player.rating && player.rating >= 1.2 ? '#34c759' : 'inherit' }}>
              {player.rating !== undefined ? player.rating.toFixed(2) : '—'}
            </b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.adr')}</span>
            <b>{player.adr !== undefined ? player.adr : '—'}</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.kast')}</span>
            <b>{player.kast !== undefined ? `${player.kast}%` : '—'}</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.fkfd')}</span>
            <b>{player.firstKills !== undefined ? `${player.firstKills}/${player.firstDeaths ?? 0}` : '—'}</b>
          </div>
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
          <div className="pm-stat">
            <span>{t('detail.hud.ud')}</span>
            <b>
              {player.utilityDamage ?? 0}
              {player.utilityDamagePerRound !== undefined && (
                <span className="muted" style={{ fontSize: 11, fontWeight: 'normal', marginLeft: 4 }}>
                  ({player.utilityDamagePerRound}/局)
                </span>
              )}
            </b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.fa')}</span>
            <b>{player.flashAssists ?? 0}</b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.blindEnemy')}</span>
            <b>
              {player.enemiesBlinded ?? 0}
              <span className="muted" style={{ fontSize: 11, fontWeight: 'normal', marginLeft: 4 }}>
                ({player.enemyBlindDuration ?? 0}s)
              </span>
            </b>
          </div>
          <div className="pm-stat">
            <span>{t('detail.hud.blindTeam')}</span>
            <b>
              {player.teammatesBlinded ?? 0}
              <span className="muted" style={{ fontSize: 11, fontWeight: 'normal', marginLeft: 4 }}>
                ({player.teamBlindDuration ?? 0}s)
              </span>
            </b>
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
            .sort((a, b) => a.tick - b.tick)
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
  const buyTypeLabel = (bt?: string) => {
    if (bt === 'full') return t('detail.buyType.full')
    if (bt === 'force') return t('detail.buyType.force')
    if (bt === 'semi') return t('detail.buyType.semi')
    if (bt === 'eco') return t('detail.buyType.eco')
    return ''
  }

  return (
    <Panel raised style={{ marginTop: 16 }}>
      <div className="panel-bd flex" style={{ alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Tag tone={round.winner === 'T' ? 't' : 'ct'} dot>
          R{round.roundNum} · {round.winner === 'T' ? 'T' : round.winner === 'CT' ? 'CT' : '—'}
        </Tag>
        <span className="muted" style={{ fontSize: 12 }}>
          {endLabel} · {round.kills.length} kills
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {fmtTick(round.startTick, tickRate)} → {fmtTick(round.endTick, tickRate)}
        </span>

        {/* 首杀 */}
        {round.firstKill && (
          <span className="flex gap-4" style={{ alignItems: 'center', fontSize: 12 }}>
            <span className="muted">{t('detail.firstKill')}:</span>
            <span className={round.firstKill.attackerTeam === 'T' ? 't' : 'ct'} style={{ fontWeight: 600 }}>
              {round.firstKill.attackerName}
            </span>
            <span className="muted">({round.firstKill.weapon})</span>
          </span>
        )}

        {/* 经济与买枪 */}
        {round.economy && (
          <span className="flex gap-8" style={{ alignItems: 'center', fontSize: 12, marginLeft: 'auto' }}>
            <span className="tag t" title={`T 消费 $${round.economy.t.spentCash} / 初始 $${round.economy.t.startCash}`}>
              T: {buyTypeLabel(round.economy.t.buyType)} (${round.economy.t.spentCash})
            </span>
            <span className="tag ct" title={`CT 消费 $${round.economy.ct.spentCash} / 初始 $${round.economy.ct.startCash}`}>
              CT: {buyTypeLabel(round.economy.ct.buyType)} (${round.economy.ct.spentCash})
            </span>
          </span>
        )}

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
