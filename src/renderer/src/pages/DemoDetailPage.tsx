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
  IcMic,
  IcMicOff,
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
import type { DemoDetail, KillEvent, PlayerInfo, RoundEndType, RoundInfo, Settings, TeamSide } from '@shared/types'

/**
 * 根据选手列表与静音名单，计算 CS2 GOTV 录像回放语音位掩码 (tv_listen_voice_indices)
 * CS2: slot 0~31 对应 tv_listen_voice_indices 的 bit 0~31
 *      slot 32~63 对应 tv_listen_voice_indices_h 的 bit 0~31
 * 全开为 -1 (0xFFFFFFFF)
 */
export function computeVoiceMask(
  players: PlayerInfo[],
  muted: Set<string>
): { low: number; high: number } {
  if (!muted || muted.size === 0) {
    return { low: -1, high: -1 }
  }

  let low = 0xffffffff
  let high = 0xffffffff

  players.forEach((p, idx) => {
    const isMuted = (p.steamId && muted.has(p.steamId)) || (p.name && muted.has(p.name))
    if (isMuted) {
      const slot = typeof p.slot === 'number' ? p.slot : idx
      if (slot >= 0 && slot < 32) {
        low = (low & ~(1 << slot)) >>> 0
      } else if (slot >= 32 && slot < 64) {
        high = (high & ~(1 << (slot - 32))) >>> 0
      }
    }
  })

  return { low: low | 0, high: high | 0 }
}

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
  const [settings, setSettings] = useState<Settings | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number; message?: string } | null>(null)

  useEffect(() => {
    const offProg = window.api.onEvent('asr:progress', (e) => {
      if (e.demoId === id) {
        setProgress({ stage: e.stage, done: e.done, total: e.total, message: e.message })
      }
    })
    return () => offProg()
  }, [id])

  const runSplit = async () => {
    if (splitting || transcribing) return
    setSplitting(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1, message: '正在提取录像队内语音…' })
    try {
      const n = await window.api.voice.split(id)
      toast.push(`语音分割完成，已提取 ${n} 条玩家说话片段`)
      const d = await window.api.library.detail(id)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSplitting(false)
      setProgress(null)
    }
  }

  const runTranscribe = async () => {
    if (splitting || transcribing) return
    setTranscribing(true)
    setProgress({ stage: 'voice-extract', done: 0, total: 1, message: '正在提取并转写语音…' })
    try {
      await window.api.asr.transcribe(id)
      toast.push(t('library.transcribeDone'))
      const d = await window.api.library.detail(id)
      if (d) setDetail(d)
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setTranscribing(false)
      setProgress(null)
    }
  }

  useEffect(() => {
    window.api.settings.get().then(setSettings).catch(() => {})
    const off = window.api.onEvent('settings:changed', (e) => {
      if (e.settings) setSettings(e.settings)
    })
    return off
  }, [])

  const mutedSet = useMemo(() => new Set(settings?.overlay?.mutedPlayers ?? []), [settings?.overlay?.mutedPlayers])
  const showMutedSpeakers = settings?.overlay?.showMutedSpeakers !== false

  const isPlayerMuted = useCallback(
    (p?: { steamId?: string; name: string } | null) => {
      if (!p) return false
      return (p.steamId ? mutedSet.has(p.steamId) : false) || (p.name ? mutedSet.has(p.name) : false)
    },
    [mutedSet]
  )

  const syncVoiceMaskToLive = useCallback(
    async (nextMutedKeys: string[]) => {
      if (!detail) return
      const mask = computeVoiceMask(detail.meta.players ?? [], new Set(nextMutedKeys))
      const status = await window.api.live.getStatus().catch(() => null)
      if (status?.cs2Running) {
        const res = await window.api.live.setVoiceMask(mask).catch(() => null)
        if (res?.sent) {
          toast.push(`已向 CS2 发送消音指令 (tv_listen_voice_indices ${mask.low})`)
        } else if (res?.cmd) {
          try {
            await navigator.clipboard.writeText(res.cmd)
            toast.push(`已复制 CS2 闭麦指令 (${res.cmd})，可在控制台按 ~ 粘贴`, 'warn')
          } catch {
            /* ignore */
          }
        }
      }
    },
    [detail, toast]
  )

  const copyVoiceMaskCommand = useCallback(async () => {
    if (!detail) return
    const mask = computeVoiceMask(detail.meta.players ?? [], mutedSet)
    const cmd = `tv_listen_voice_indices ${mask.low}; tv_listen_voice_indices_h ${mask.high}`
    try {
      await navigator.clipboard.writeText(cmd)
      toast.push(`已复制 CS2 原生消音指令: ${cmd}`)
    } catch {
      toast.push('复制失败，请检查剪贴板权限', 'err')
    }
  }, [detail, mutedSet, toast])

  const togglePlayerMute = useCallback(
    async (p: { steamId?: string; name: string }) => {
      const key = p.steamId || p.name
      if (!key) return
      const curList = settings?.overlay?.mutedPlayers ?? []
      const isAlready = curList.includes(key) || (p.name && curList.includes(p.name)) || (p.steamId && curList.includes(p.steamId))
      const nextList = isAlready
        ? curList.filter((x) => x !== key && x !== p.name && x !== p.steamId)
        : [...curList, key]

      const updated = await window.api.settings.set({
        overlay: {
          ...(settings?.overlay ?? { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }),
          mutedPlayers: nextList
        }
      })
      setSettings(updated)
      void syncVoiceMaskToLive(nextList)
      if (isAlready) {
        toast.push(`${p.name} 已解除静音`)
      } else {
        toast.push(`${p.name} 已静音（悬浮层将显示闭麦标或屏蔽）`, 'warn')
      }
    },
    [settings, syncVoiceMaskToLive, toast]
  )

  const muteAll = useCallback(async () => {
    if (!detail) return
    const allKeys = (detail.meta.players ?? []).map((p) => p.steamId || p.name).filter(Boolean)
    const updated = await window.api.settings.set({
      overlay: {
        ...(settings?.overlay ?? { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }),
        mutedPlayers: allKeys
      }
    })
    setSettings(updated)
    void syncVoiceMaskToLive(allKeys)
    toast.push('已一键静音全场 10 位选手', 'warn')
  }, [detail, settings, syncVoiceMaskToLive, toast])

  const unmuteAll = useCallback(async () => {
    const updated = await window.api.settings.set({
      overlay: {
        ...(settings?.overlay ?? { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }),
        mutedPlayers: []
      }
    })
    setSettings(updated)
    void syncVoiceMaskToLive([])
    toast.push('已解除全部选手的静音')
  }, [settings, syncVoiceMaskToLive, toast])

  const muteTeam = useCallback(
    async (team: 'T' | 'CT') => {
      if (!detail) return
      const teamKeys = (detail.meta.players ?? []).filter((p) => p.team === team).map((p) => p.steamId || p.name).filter(Boolean)
      const cur = settings?.overlay?.mutedPlayers ?? []
      const combined = [...new Set([...cur, ...teamKeys])]
      const updated = await window.api.settings.set({
        overlay: {
          ...(settings?.overlay ?? { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }),
          mutedPlayers: combined
        }
      })
      setSettings(updated)
      void syncVoiceMaskToLive(combined)
      toast.push(`已静音 ${team === 'T' ? 'T 阵营' : 'CT 阵营'} 全体选手`, 'warn')
    },
    [detail, settings, syncVoiceMaskToLive, toast]
  )

  const toggleShowMutedSpeakers = useCallback(async () => {
    const cur = settings?.overlay?.showMutedSpeakers !== false
    const updated = await window.api.settings.set({
      overlay: {
        ...(settings?.overlay ?? { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }),
        showMutedSpeakers: !cur
      }
    })
    setSettings(updated)
    toast.push(!cur ? '悬浮层：显示闭麦头像（叠加红底闭麦角标）' : '悬浮层：完全隐藏静音选手头像')
  }, [settings, toast])


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
    } else {
      toast.push(t('common.jumpCopied').replace('{cmd}', cmd))
    }
  }

  /** 局外一键启动或局内跳转 */
  const playFromTick = async (tick?: number) => {
    if (!detail) return
    if (typeof tick === 'number' && tick > 0) {
      const jumped = await window.api.live.jumpTick(tick).catch(() => false)
      if (jumped) {
        toast.push(t('common.jumpDirectSuccess').replace('{tick}', String(tick)))
        return
      }
    }
    const cmd = typeof tick === 'number' && tick > 0 ? `demo_gototick ${tick}` : ''
    if (cmd) {
      try {
        await navigator.clipboard.writeText(cmd)
      } catch {
        /* ignore */
      }
    }
    const status = await window.api.live.getStatus().catch(() => null)
    if (status?.cs2Running) {
      if (cmd) {
        toast.push(t('common.jumpCopiedRunning').replace('{cmd}', cmd), 'warn')
      } else {
        toast.push('CS2 正在运行中：请在游戏内按 ~ 打开控制台', 'warn')
      }
      return
    }
    const s = await window.api.settings.get()
    const voiceHud = !!s.cs2?.voiceHud
    if (voiceHud) toast.push(t('detail.voiceHudPreparing'))
    const voiceIndices = computeVoiceMask(detail.meta.players ?? [], mutedSet)
    const r = await window.api.live.launch({
      playDemoPath: detail.meta.path,
      voiceHud,
      startTick: tick,
      tvVoiceIndices: voiceIndices
    })
    if (r.ok) {
      if (typeof tick === 'number' && tick > 0) {
        toast.push(t('common.jumpLaunched').replace('{tick}', String(tick)))
      } else {
        toast.push(t('detail.playLaunched'))
      }
    } else {
      toast.push(r.error ?? t('common.error'), 'warn')
    }
  }

  /** 播放：调用 CS2 原生内置播放器（+exec cfg）稳定原画质播放 */
  const playInCs2 = async () => {
    await playFromTick(round ? round.startTick : undefined)
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

  const [bottomTab, setBottomTab] = useState<'voice' | 'chat'>('voice')

  // 保证所有 Hook 在组件顶层无条件执行（严禁放在 if (!detail) 之后，避免 React Error #310）
  const allKills = useMemo(() => (detail ? detail.rounds.flatMap((r) => r.kills) : []), [detail])
  const round = useMemo(
    () =>
      detail && selectedRound !== 'all'
        ? detail.rounds.find((r) => r.roundNum === selectedRound) ?? null
        : null,
    [detail, selectedRound]
  )
  const feedKills = round ? round.kills : allKills
  // 击杀流按时间正序：比赛开始 → 结束
  const sortedKills = useMemo(() => [...feedKills].sort((a, b) => a.tick - b.tick), [feedKills])

  // 局内语音：联动 selectedRound 对局筛选，并按时间正序排列
  const filteredVoice = useMemo(() => {
    if (!detail) return []
    const list =
      selectedRound === 'all'
        ? detail.voice
        : detail.voice.filter((v) => {
            if (v.roundNum !== undefined) return v.roundNum === selectedRound
            const r = detail.rounds.find((x) => x.roundNum === selectedRound)
            return r ? v.tick >= r.startTick && v.tick <= r.endTick : false
          })
    return [...list].sort((a, b) => a.tick - b.tick)
  }, [detail, selectedRound])

  // 局内文字：联动 selectedRound 对局筛选，并按时间正序排列
  const filteredChat = useMemo(() => {
    if (!detail) return []
    const list =
      selectedRound === 'all'
        ? detail.chat
        : detail.chat.filter((c) => {
            if (c.roundNum !== undefined) return c.roundNum === selectedRound
            const r = detail.rounds.find((x) => x.roundNum === selectedRound)
            return r ? c.tick >= r.startTick && c.tick <= r.endTick : false
          })
    return [...list].sort((a, b) => a.tick - b.tick)
  }, [detail, selectedRound])

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
              <Btn
                size="sm"
                variant="accent"
                onClick={playInCs2}
                title={round ? `局外启动 CS2 并直接跳转至 R${round.roundNum} 开始播放` : '局外启动 CS2 播放完整录像'}
              >
                <IcJump size={12} />
                {round ? t('detail.playRound').replace('{round}', String(round.roundNum)) : t('detail.playInCs2')}
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
              <Btn size="sm" variant="ghost" onClick={() => window.api.app.revealInFolder(meta.path)} title="在文件夹中定位 Demo">
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

          {/* 回合胜负走势图（CS:GO / CS2 官方比赛计分板风格） */}
          <div style={{ marginTop: 16 }}>
            <MatchTimelineBar
              rounds={rounds}
              selectedRound={selectedRound === 'all' ? undefined : selectedRound}
              onSelectRound={(r) => setSelectedRound((cur) => (cur === r ? 'all' : r))}
            />
          </div>
        </div>
      </Panel>

      {/* 选手数据计分板（全宽展示，空间宽敞清晰） */}
      <Panel
        raised
        style={{ marginTop: 16 }}
        hd={
          <div className="flex between" style={{ alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 8 }}>
            <div className="flex" style={{ alignItems: 'center', gap: 8 }}>
              <span>{t('detail.players')}</span>
              {(meta.players ?? []).filter((p) => isPlayerMuted(p)).length > 0 ? (
                <span
                  className="tag alert"
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    height: 'auto',
                    background: 'rgba(255, 69, 58, 0.15)',
                    color: '#ff453a',
                    borderColor: 'rgba(255, 69, 58, 0.35)'
                  }}
                >
                  已静音 {(meta.players ?? []).filter((p) => isPlayerMuted(p)).length} 人
                </span>
              ) : (
                <span className="muted" style={{ fontSize: 11, fontWeight: 'normal' }}>
                  全员开麦
                </span>
              )}
            </div>
            <div className="flex" style={{ alignItems: 'center', gap: 6 }}>
              <Btn
                size="sm"
                variant="secondary"
                onClick={toggleShowMutedSpeakers}
                title={
                  showMutedSpeakers
                    ? '当前模式：悬浮层显示闭麦图标头像（点击切换为完全隐藏）'
                    : '当前模式：悬浮层完全隐藏静音选手头像（点击切换为显示闭麦头像）'
                }
                style={{ fontSize: 11, height: 26, padding: '0 8px' }}
              >
                <IcMicOff size={12} style={{ marginRight: 4 }} />
                {showMutedSpeakers ? '悬浮层：显示闭麦头像' : '悬浮层：隐藏静音头像'}
              </Btn>
              {(meta.players ?? []).filter((p) => isPlayerMuted(p)).length > 0 ? (
                <Btn size="sm" variant="ghost" onClick={unmuteAll} style={{ fontSize: 11, height: 26, padding: '0 8px' }}>
                  全员恢复
                </Btn>
              ) : (
                <Btn size="sm" variant="ghost" onClick={muteAll} style={{ fontSize: 11, height: 26, padding: '0 8px' }}>
                  一键全员静音
                </Btn>
              )}
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => muteTeam('T')}
                style={{ fontSize: 11, height: 26, padding: '0 8px' }}
                title="静音进攻方 (T) 全体选手"
              >
                静音 T
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => muteTeam('CT')}
                style={{ fontSize: 11, height: 26, padding: '0 8px' }}
                title="静音防守方 (CT) 全体选手"
              >
                静音 CT
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={copyVoiceMaskCommand}
                style={{ fontSize: 11, height: 26, padding: '0 8px' }}
                title="复制当前设置对应的 CS2 原生控制台消音指令 (tv_listen_voice_indices)"
              >
                复制 CS2 闭麦指令
              </Btn>
            </div>
          </div>
        }
      >
        <div className="tbl-wrap" style={{ padding: '6px 0' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('detail.players')}</th>
                <th style={{ textAlign: 'center' }}>麦克风</th>
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
              {(meta.players ?? []).map((p, i) => {
                const muted = isPlayerMuted(p)
                return (
                  <tr
                    key={p.steamId || p.name}
                    className={`player-row ${muted ? 'player-muted' : ''}`}
                    onClick={() => setPlayer(p)}
                    title={t('detail.playerDetail')}
                  >
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <span className="flex gap-8" style={{ alignItems: 'center' }}>
                        <Avatar name={p.name} team={p.team} size={20} avatar={p.avatar} muted={muted} />
                        <span
                          className={`nm ${p.team === 'T' ? 't' : p.team === 'CT' ? 'ct' : ''}`}
                          style={muted ? { opacity: 0.65 } : undefined}
                        >
                          {p.name}
                        </span>
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className={`btn-mic-toggle ${muted ? 'muted' : 'active'}`}
                        onClick={() => togglePlayerMute(p)}
                        title={muted ? `点击恢复 ${p.name} 开麦` : `点击静音 ${p.name}`}
                        style={{
                          background: muted ? 'rgba(255, 69, 58, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          border: `1px solid ${muted ? 'rgba(255, 69, 58, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                          color: muted ? '#ff453a' : 'var(--text-muted, #999)',
                          borderRadius: 6,
                          padding: '3px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          lineHeight: 1,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {muted ? <IcMicOff size={12} /> : <IcMic size={12} />}
                        <span>{muted ? '已静音' : '开麦'}</span>
                      </button>
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
                    <td className="num">{p.flashAssists ?? 0}</td>
                    <td className="num">{p.mvp}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 回合简报 */}
      {round && <RoundStrip round={round} tickRate={meta.tickRate ?? 64} onJump={jump} />}

      {/* 底部两栏：击杀战报 + 局内通信（语音 & 聊天，随选定回合联动） */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* 左栏：击杀战报 */}
        <Panel
          hd={
            <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>{`${t('detail.killfeed')} · ${selectedRound === 'all' ? t('common.all') : `第 ${selectedRound} 回合`}`}</span>
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
            <div className="kill-list" style={{ maxHeight: 440, overflowY: 'auto' }}>
              {sortedKills.map((k, i) => {
                const roundObj = rounds.find((r) => r.roundNum === k.roundNum)
                return (
                  <KillRow
                    key={`${k.tick}-${i}`}
                    kill={k}
                    tickRate={meta.tickRate ?? 64}
                    roundStartTick={roundObj?.startTick}
                    onJump={jump}
                  />
                )
              })}
              {sortedKills.length === 0 && (
                <div className="muted" style={{ padding: '36px 12px', textAlign: 'center', fontSize: 12 }}>
                  {selectedRound === 'all' ? '暂无击杀记录' : `第 ${selectedRound} 回合暂无击杀`}
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* 右栏：局内通信与语音（随选定回合变动联动展示） */}
        <Panel
          hd={
            <div className="flex between" style={{ alignItems: 'center', width: '100%', gap: 8 }}>
              <div className="seg">
                <span
                  className={`seg-item ${bottomTab === 'voice' ? 'on' : ''}`}
                  onClick={() => setBottomTab('voice')}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <IcMic size={12} />
                  <span>队内语音</span>
                  <span style={{ opacity: 0.7, fontSize: 11 }}>({filteredVoice.length})</span>
                </span>
                <span
                  className={`seg-item ${bottomTab === 'chat' ? 'on' : ''}`}
                  onClick={() => setBottomTab('chat')}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <IcChat size={12} />
                  <span>局内聊天</span>
                  <span style={{ opacity: 0.7, fontSize: 11 }}>({filteredChat.length})</span>
                </span>
              </div>
              <Btn
                size="sm"
                variant="ghost"
                onClick={onGoTranscript}
                title="前往完整转写页查看全部语音并支持搜索"
                style={{ fontSize: 11, height: 26, padding: '0 8px' }}
              >
                <span>转写页</span>
                <span>→</span>
              </Btn>
            </div>
          }
        >
          <div className="panel-bd" style={{ padding: '10px 14px' }}>
            {/* 进度条（仅在切分/转写运行中展示） */}
            {progress && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--bg-2)', border: '1px solid var(--line-1)', borderRadius: 8 }}>
                <div className="flex" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)' }}>
                    {progress.message || (progress.stage === 'voice-extract' ? '正在提取语音…' : progress.stage === 'voice-split' ? '正在切分玩家语音…' : '正在识别文字…')}
                  </span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {progress.total > 0 ? `${progress.done}/${progress.total}` : '…'}
                  </span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-3)', position: 'relative', overflow: 'hidden', borderRadius: 2 }}>
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

            {bottomTab === 'voice' ? (
              voice.length === 0 ? (
                <div
                  style={{
                    padding: '36px 16px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  {meta.hasVoice ? (
                    <>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-0)' }}>
                        检测到本局包含队内语音数据（约 {Math.round(voiceSecs)} 秒）
                      </div>
                      <div className="muted" style={{ fontSize: 12, maxWidth: 440, lineHeight: 1.6 }}>
                        录像包含玩家麦克风音频，尚未提取切分或转写识别。可快速切分听取原声或识别文字：
                      </div>
                      <div className="flex" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <Btn
                          variant="secondary"
                          size="sm"
                          disabled={splitting || transcribing}
                          onClick={runSplit}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px' }}
                        >
                          <IcMic size={13} />
                          <span>{splitting ? '正在切分中…' : '快速语音切分 (无需 Key · 秒出)'}</span>
                        </Btn>
                        <Btn
                          variant="accent"
                          size="sm"
                          disabled={splitting || transcribing}
                          onClick={runTranscribe}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px' }}
                        >
                          <IcTranscript size={13} />
                          <span>{transcribing ? '正在转写中…' : 'AI 智能转写文字'}</span>
                        </Btn>
                      </div>
                    </>
                  ) : (
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      此 Demo 未录制队内语音（官方比赛 HLTV Demo 或无语音录像通常不包含麦克风音频）
                    </div>
                  )}
                </div>
              ) : filteredVoice.length === 0 ? (
                <div className="muted" style={{ padding: '36px 16px', textAlign: 'center', fontSize: 12 }}>
                  {selectedRound === 'all' ? '暂无语音记录' : `第 ${selectedRound} 回合暂无说话记录`}
                </div>
              ) : (
                <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                  {filteredVoice.map((v, i) => {
                    const vMuted = isPlayerMuted({ steamId: v.steamId, name: v.playerName })
                    return (
                      <div key={`${v.tick}-${i}`} className={`tline ${vMuted ? 'muted-line' : ''}`} onClick={() => jump(v.tick)}>
                        <span className="tm">{fmtTick(v.tick, meta.tickRate ?? 64)}</span>
                        <span className="who">
                          <Avatar
                            name={v.playerName}
                            team={v.team}
                            size={18}
                            avatar={(meta.players ?? []).find((x) => x.name === v.playerName)?.avatar}
                            muted={vMuted}
                          />
                          <span className={`nm ${v.team === 'T' ? 't' : v.team === 'CT' ? 'ct' : ''}`}>
                            {v.playerName}
                            {vMuted && <span style={{ fontSize: 10, color: '#ff453a', marginLeft: 4 }}>(已静音)</span>}
                          </span>
                          {selectedRound === 'all' && v.roundNum !== undefined && (
                            <Tag tone="ghost" style={{ fontSize: 10, padding: '1px 5px' }}>R{v.roundNum}</Tag>
                          )}
                        </span>
                        <span className={`txt ${vMuted ? 'muted' : ''}`} style={vMuted ? { opacity: 0.6 } : undefined}>
                          {v.text || '[语音片段]'}
                        </span>
                        <VoicePlayButton
                          demoId={id}
                          seg={{ steamId: v.steamId, playerName: v.playerName, startSec: v.timeSec, endSec: v.endSec }}
                          size={13}
                        />
                        <button
                          type="button"
                          className="icon-btn jump"
                          title={t('transcript.jump')}
                          onClick={(e) => {
                            e.stopPropagation()
                            jump(v.tick)
                          }}
                        >
                          <IcJump size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              /* Chat tab */
              filteredChat.length === 0 ? (
                <div className="muted" style={{ padding: '36px 16px', textAlign: 'center', fontSize: 12 }}>
                  {selectedRound === 'all' ? '暂无聊天记录' : `第 ${selectedRound} 回合暂无文字聊天`}
                </div>
              ) : (
                <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                  {filteredChat.map((c, i) => (
                    <div key={i} className="tline" onClick={() => jump(c.tick)}>
                      <span className="tm">{fmtTick(c.tick, meta.tickRate ?? 64)}</span>
                      <span className="who">
                        <Avatar
                          name={c.playerName}
                          team={playerTeam(c, meta.players)}
                          size={18}
                          avatar={(meta.players ?? []).find((p) => p.name === c.playerName)?.avatar}
                        />
                        <span className="nm">{c.playerName}</span>
                        {selectedRound === 'all' && c.roundNum !== undefined && (
                          <Tag tone="ghost" style={{ fontSize: 10, padding: '1px 5px' }}>R{c.roundNum}</Tag>
                        )}
                        <Tag tone={c.channel === 'T' ? 't' : c.channel === 'CT' ? 'ct' : 'ghost'}>
                          {c.channel}
                        </Tag>
                      </span>
                      <span className="txt">{c.text}</span>
                      <button
                        type="button"
                        className="icon-btn jump"
                        title={t('transcript.jump')}
                        onClick={(e) => {
                          e.stopPropagation()
                          jump(c.tick)
                        }}
                      >
                        <IcJump size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )
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
          rounds={rounds}
          isMuted={isPlayerMuted(player)}
          onToggleMute={() => togglePlayerMute(player)}
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

/** 5 种官方 CS:GO / CS2 胜负方式精细矢量 SVG 图标 */
function SkullIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M8 1a6 6 0 0 0-6 6c0 1.8.8 3.4 2.1 4.5V13c0 .6.4 1 1 1h5.8c.6 0 1-.4 1-1v-1.5C13.2 10.4 14 8.8 14 7a6 6 0 0 0-6-6zm-2.5 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM6 11.5v1.5h1v-1.5H6zm2 0v1.5h1v-1.5H8zm2 0v1.5h1v-1.5h-1z" />
    </svg>
  )
}

function BombExplodedIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M8 1l1.5 3 3.5-.8-1.5 3.3 3 2-3 2 1.5 3.3-3.5-.8L8 15l-1.5-3-3.5.8 1.5-3.3-3-2 3-2-1.5-3.3 3.5.8L8 1z" />
    </svg>
  )
}

function DefuseKitIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L7.5 5.5M10 2L8.5 5.5" />
      <circle cx="8" cy="6" r="1.2" fill="currentColor" />
      <path d="M7 7C5 9 4 11 4 14M9 7C11 9 12 11 12 14" />
    </svg>
  )
}

function TimeoutIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="9" r="5.5" />
      <path d="M8 2v2M6 2h4M8 6.5V9l1.8 1.8M12.5 4.5l1 1" />
    </svg>
  )
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
      <path d="M3 2h10v3c0 2.5-1.8 4.6-4.2 4.9.4.6.9 1.4 1.2 2.1H11a1 1 0 0 1 1 1v1H4v-1a1 1 0 0 1 1-1h1c.3-.7.8-1.5 1.2-2.1C4.8 9.6 3 7.5 3 5V2zm-1 1h1v2c0 1.5 1 2.8 2.3 3.3C4.5 7.6 4 6.6 4 5.5V3zm12 0h-1v2.5c0 1.1-.5 2.1-1.3 2.8 1.3-.5 2.3-1.8 2.3-3.3V3z" />
    </svg>
  )
}

function RoundVictoryIcon({ type, isTrophy }: { type: RoundEndType; isTrophy?: boolean }) {
  if (isTrophy) return <TrophyIcon />
  switch (type) {
    case 'bomb_exploded':
      return <BombExplodedIcon />
    case 'bomb_defused':
      return <DefuseKitIcon />
    case 'elimination':
      return <SkullIcon />
    case 'timeout':
      return <TimeoutIcon />
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

function SurvivorBars({
  count,
  teamColor,
  direction
}: {
  count: number
  teamColor: 't' | 'ct'
  direction: 'up' | 'down'
}) {
  const slots = direction === 'up' ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5]
  return (
    <div className="survivor-bars">
      {slots.map((slot) => {
        const isAlive = slot <= count
        return <div key={slot} className={`s-bar ${isAlive ? `alive ${teamColor}` : ''}`} />
      })}
    </div>
  )
}

/**
 * CS:GO / CS2 官方比赛回合走势图（Match Round Timeline Bar）
 * - 双轨对决：上半区（Team 1：上半场T / 下半场CT） vs 下半区（Team 2：上半场CT / 下半场T）
 * - 5格幸存者指示槽（Survivor Bars）
 * - 5种官方矢量图标（全歼💀、引爆💥、拆弹✂、超时⏱、胜赛点🏆）
 * - 中轴刻度线与半场换边分隔线
 */
function MatchTimelineBar({
  rounds,
  selectedRound,
  onSelectRound
}: {
  rounds: RoundInfo[]
  selectedRound?: number
  onSelectRound: (roundNum: number) => void
}) {
  if (!rounds || rounds.length === 0) return null

  // CS2 统一 MR12（12回合换边），早前 CS:GO MR15（15回合换边）
  const halfRound = rounds.length > 26 ? 15 : 12
  const half1 = rounds.filter((r) => r.roundNum <= halfRound)
  const half2 = rounds.filter((r) => r.roundNum > halfRound && r.roundNum <= halfRound * 2)
  const overtime = rounds.filter((r) => r.roundNum > halfRound * 2)

  const renderCol = (r: RoundInfo) => {
    const isHalf2 = r.roundNum > halfRound
    const topTeam = isHalf2 ? 'CT' : 'T'
    const bottomTeam = isHalf2 ? 'T' : 'CT'

    const isTopWinner = r.winner === topTeam
    const isBottomWinner = r.winner === bottomTeam

    const topColor = topTeam === 'T' ? 't' : 'ct'
    const bottomColor = bottomTeam === 'T' ? 't' : 'ct'

    // 计算获胜方存活人数
    const winningDeaths = (r.kills ?? []).filter((k) => k.victimTeam === r.winner).length
    const survivors = Math.max(0, Math.min(5, 5 - winningDeaths))
    const isLastRound = r.roundNum === rounds.length && r.roundNum >= (halfRound === 15 ? 16 : 13)

    const endTypeName = (() => {
      switch (r.endType) {
        case 'bomb_exploded': return '💥 炸弹爆炸'
        case 'bomb_defused': return '✂ 成功拆包'
        case 'elimination': return '💀 全歼对手'
        case 'timeout': return '⏱ 时间耗尽'
        default: return '回合胜利'
      }
    })()
    const winTeamName = r.winner === 'T' ? '匪徒(T)' : r.winner === 'CT' ? '警察(CT)' : '未知'
    const tooltip = `第 ${r.roundNum} 回合 · ${winTeamName} 胜 · ${endTypeName} · ${survivors} 人存活 (歼灭 ${r.kills?.length ?? 0} 人)`

    const showAxisNum = r.roundNum === 1 || r.roundNum % 5 === 0

    return (
      <div
        key={r.roundNum}
        className={`round-col ${selectedRound === r.roundNum ? 'active' : ''}`}
        onClick={() => onSelectRound(r.roundNum)}
        title={tooltip}
      >
        <div className="track-row top">
          {isTopWinner && (
            <>
              <SurvivorBars count={survivors} teamColor={topColor} direction="up" />
              <div className={`win-icon ${topColor}`}>
                <RoundVictoryIcon type={r.endType} isTrophy={isLastRound && isTopWinner} />
              </div>
            </>
          )}
        </div>

        <div className="axis-center">
          <div className="axis-line" />
          {showAxisNum ? (
            <span className="axis-label">{r.roundNum}</span>
          ) : (
            <span className="axis-dot" />
          )}
        </div>

        <div className="track-row bottom">
          {isBottomWinner && (
            <>
              <div className={`win-icon ${bottomColor}`}>
                <RoundVictoryIcon type={r.endType} isTrophy={isLastRound && isBottomWinner} />
              </div>
              <SurvivorBars count={survivors} teamColor={bottomColor} direction="down" />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="timeline-wrap">
      <div className="match-timeline">
        <div className="timeline-half">
          {half1.map(renderCol)}
        </div>

        {half2.length > 0 && (
          <div className="halftime-divider" title="半场换边 (Halftime)">
            <div className="halftime-line" />
            <div className="halftime-tag">HT</div>
          </div>
        )}

        {half2.length > 0 && (
          <div className="timeline-half">
            {half2.map(renderCol)}
          </div>
        )}

        {overtime.length > 0 && (
          <div className="halftime-divider" title="加时赛 (Overtime)">
            <div className="halftime-line" />
            <div className="halftime-tag">OT</div>
          </div>
        )}

        {overtime.length > 0 && (
          <div className="timeline-half">
            {overtime.map(renderCol)}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 计算击杀跳转的目标 tick：提前 4 秒缓冲（64-tick 下约为 256 ticks），方便完整观看击杀前架枪、搜点及交火对枪全过程
 */
export function getKillJumpTick(killTick: number, tickRate = 64, roundStartTick?: number): number {
  const leadSeconds = 4
  const offset = Math.round((tickRate || 64) * leadSeconds)
  const target = killTick - offset
  if (typeof roundStartTick === 'number' && roundStartTick > 0) {
    return Math.max(roundStartTick, target)
  }
  return Math.max(1, target)
}

/** 武器名展示规范化（兼容旧缓存中带皮肤后缀的 hkp2000_txz04 等未解析原始字段） */
export function displayWeapon(raw?: string): string {
  if (!raw) return '—'
  const s = raw.toLowerCase().trim()
  if (s.startsWith('weapon_')) {
    return displayWeapon(s.slice(7))
  }
  if (s.includes('hkp2000') || s.includes('p2000')) return 'P2000'
  if (s.includes('usp_silencer')) return 'USP-S'
  if (s.includes('m4a1_silencer')) return 'M4A1-S'
  if (s.includes('ak47')) return 'AK-47'
  if (s.includes('deagle')) return 'Desert Eagle'
  if (s.includes('ssg08')) return 'SSG 08'
  if (s.includes('taser') || s.includes('zeus')) return 'Zeus x27'
  if (s.includes('cz75')) return 'CZ75-A'
  if (s.includes('knife') || s.includes('bayonet')) return 'Knife'
  // 剥除 5E 等对战平台前后缀
  const cleaned = raw
    .replace(/^weapon_/i, '')
    .replace(/^5e_\w+_/i, '')
    .replace(/_(txz?\d*|fm\d*|vip|gold|blood|dawn|volt|emerald|chroma|prem|elite|s\d+)$/i, '')
  return cleaned || raw
}

function KillRow({
  kill,
  tickRate,
  roundStartTick,
  onJump
}: {
  kill: KillEvent
  tickRate: number
  roundStartTick?: number
  onJump: (tick: number) => void
}) {
  const t = useTKey()
  // 自杀/环境击杀（attacker 与 victim 同一人，或 attacker=世界 65535）
  const isSuicide = kill.attackerUid === kill.victimUid || kill.attackerUid === 65535
  const attackerLabel = isSuicide ? '' : (kill.attackerName ?? '—')
  const victimLabel = isSuicide ? (kill.attackerName ?? kill.victimName ?? '—') : (kill.victimName ?? '—')

  const handleJump = () => {
    const target = getKillJumpTick(kill.tick, tickRate, roundStartTick)
    onJump(target)
  }

  return (
    <div className="kill-row" onClick={handleJump} title={t('transcript.jumpKill')}>
      <span className="tk">{fmtTick(kill.tick, tickRate)}</span>
      <span
        className={`nm atk ${kill.attackerTeam === 'T' ? 't' : kill.attackerTeam === 'CT' ? 'ct' : ''}`}
        title={attackerLabel}
      >
        {attackerLabel}
      </span>
      <span className="wp">
        <span className="wp-name">{isSuicide ? '自杀' : displayWeapon(kill.weapon)}</span>
        <KillIcons kill={kill} />
      </span>
      <span
        className={`nm vic ${kill.victimTeam === 'T' ? 't' : kill.victimTeam === 'CT' ? 'ct' : ''}`}
        title={victimLabel}
      >
        {victimLabel}
      </span>
      <span className="rn">R{kill.roundNum}</span>
      <button
        type="button"
        className="icon-btn jump"
        title={t('transcript.jumpKill')}
        onClick={(e) => {
          e.stopPropagation()
          handleJump()
        }}
      >
        <IcJump size={13} />
      </button>
    </div>
  )
}

/** 选手详情弹窗：个人数据 + 武器击杀统计 + 击杀列表（可跳转） */
function PlayerModal({
  player,
  kills,
  tickRate,
  rounds,
  isMuted,
  onToggleMute,
  onJump,
  onClose
}: {
  player: PlayerInfo
  kills: KillEvent[]
  tickRate: number
  rounds?: RoundInfo[]
  isMuted?: boolean
  onToggleMute?: () => void
  onJump: (tick: number) => void
  onClose: () => void
}) {
  const t = useTKey()
  const [activeTick, setActiveTick] = useState<number | null>(null)
  const myKills = useMemo(
    () =>
      kills.filter((k) =>
        k.attackerSteamId ? k.attackerSteamId === player.steamId : k.attackerName === player.name
      ),
    [kills, player]
  )
  const byWeapon = useMemo(() => {
    const map = new Map<string, number>()
    for (const k of myKills) {
      const w = displayWeapon(k.weapon)
      map.set(w, (map.get(w) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [myKills])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal player-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-head">
          <Avatar name={player.name} team={player.team} size={46} avatar={player.avatar} muted={isMuted} />
          <div style={{ minWidth: 0 }}>
            <div className="pm-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{player.name}</span>
              {isMuted && (
                <span
                  style={{
                    fontSize: 11,
                    color: '#ff453a',
                    background: 'rgba(255, 69, 58, 0.12)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontWeight: 500
                  }}
                >
                  已静音
                </span>
              )}
            </div>
            <div className="pm-sub">
              {player.team === 'T' ? 'T 队' : player.team === 'CT' ? 'CT 队' : '—'}
            </div>
          </div>
          <div className="grow" />
          {onToggleMute && (
            <Btn
              variant={isMuted ? 'danger' : 'secondary'}
              size="sm"
              onClick={onToggleMute}
              title={isMuted ? '点击取消静音该选手' : '点击静音该选手麦克风'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 6 }}
            >
              {isMuted ? <IcMicOff size={13} /> : <IcMic size={13} />}
              <span>{isMuted ? '已静音' : '静音选手'}</span>
            </Btn>
          )}
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
            .map((k, i) => {
              const roundObj = rounds?.find((r) => r.roundNum === k.roundNum)
              const handleJump = () => {
                const target = getKillJumpTick(k.tick, tickRate, roundObj?.startTick)
                setActiveTick(k.tick)
                onJump(target)
              }
              const isJumpActive = activeTick === k.tick
              return (
                <div
                  key={`${k.tick}-${i}`}
                  className={`pm-kill ${isJumpActive ? 'active' : ''}`}
                  onClick={handleJump}
                  title={t('transcript.jumpKill')}
                >
                  <span className="tm">{fmtTick(k.tick, tickRate)}</span>
                  <span className="wp">
                    {displayWeapon(k.weapon)}
                    <KillIcons kill={k} />
                  </span>
                  <span className="vic">{k.victimName ?? '—'}</span>
                  <span className="rn">R{k.roundNum}</span>
                  <button
                    type="button"
                    className={`icon-btn jump ${isJumpActive ? 'active' : ''}`}
                    title={t('transcript.jumpKill')}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleJump()
                    }}
                  >
                    <IcJump size={13} />
                  </button>
                </div>
              )
            })}
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
