/**
 * 回合时间轴：CS2 DemoUI 风格的轨道 + 回合分段 + 击杀/语音/炸弹标记。
 * 全量渲染，标记按 tick 比例定位。
 */
import { useMemo, type ReactNode } from 'react'
import type { RoundInfo, VoiceSegment } from '@shared/types'
import { fmtTick } from './ui'

interface TimelineProps {
  rounds: RoundInfo[]
  voice?: VoiceSegment[]
  firstTick: number
  lastTick: number
  tickRate?: number
  selectedRound?: number
  onSelectRound: (roundNum: number) => void
  onJumpTick: (tick: number) => void
}

export function Timeline({
  rounds,
  voice,
  firstTick,
  lastTick,
  tickRate = 64,
  selectedRound,
  onSelectRound,
  onJumpTick
}: TimelineProps) {
  const span = Math.max(1, lastTick - firstTick)
  const pct = (tick: number) => ((tick - firstTick) / span) * 100

  const voiceByRound = useMemo(() => {
    const map = new Map<number, VoiceSegment[]>()
    for (const v of voice ?? []) {
      const key = v.roundNum ?? 0
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(v)
    }
    return map
  }, [voice])

  const bombSpans: ReactNode[] = []
  for (const r of rounds) {
    if (r.bombPlantedTick) {
      bombSpans.push(
        <span
          key={`p${r.roundNum}`}
          className="bomb tt"
          style={{ left: `${pct(r.bombPlantedTick)}%` }}
          data-tip={`R${r.roundNum} 安放`}
        />
      )
    }
    if (r.bombExplodedTick) {
      bombSpans.push(
        <span
          key={`x${r.roundNum}`}
          className="bomb tt"
          style={{ left: `${pct(r.bombExplodedTick)}%`, background: 'var(--red)' }}
          data-tip={`R${r.roundNum} 爆炸`}
        />
      )
    }
    if (r.bombDefusedTick) {
      bombSpans.push(
        <span
          key={`d${r.roundNum}`}
          className="bomb tt"
          style={{ left: `${pct(r.bombDefusedTick)}%`, background: 'var(--green)' }}
          data-tip={`R${r.roundNum} 拆除`}
        />
      )
    }
  }

  return (
    <div className="timeline">
      <div className="track">
        {rounds.map((r) => (
          <div
            key={r.roundNum}
            className={`seg ${r.winner === 'T' ? 'win-t' : r.winner === 'CT' ? 'win-ct' : ''} ${
              selectedRound === r.roundNum ? 'active' : ''
            }`}
            style={{ left: `${pct(r.startTick)}%`, width: `${pct(r.endTick) - pct(r.startTick)}%` }}
            onClick={() => onSelectRound(r.roundNum)}
            title={`R${r.roundNum} · ${r.winner === 'T' ? 'T' : r.winner === 'CT' ? 'CT' : '-'} · ${
              r.kills.length
            } kills`}
          />
        ))}
        {rounds.map((r) => (
          <span key={`l${r.roundNum}`} className={`rlabel ${selectedRound === r.roundNum ? 'on' : ''}`} style={{ left: `${pct(r.startTick)}%` }}>
            {r.roundNum}
          </span>
        ))}
        {rounds.flatMap((r) =>
          r.kills.map((k, i) => (
            <span
              key={`k${r.roundNum}-${i}`}
              className={`kill tt ${k.headshot ? 'hs' : ''}`}
              style={{ left: `${pct(k.tick)}%` }}
              data-tip={`${fmtTick(k.tick, tickRate)} ${k.attackerName} → ${k.victimName} ${k.weapon}${k.headshot ? ' HS' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onJumpTick(k.tick)
              }}
            />
          ))
        )}
        {bombSpans}
        {[...voiceByRound.entries()].flatMap(([roundNum, segs]) =>
          segs.map((v, i) => (
            <span
              key={`v${roundNum}-${i}`}
              className="voice tt"
              style={{
                left: `${pct(v.tick)}%`,
                width: `${Math.max(0.5, pct(v.endTick) - pct(v.tick))}%`
              }}
              data-tip={`${v.playerName}: ${v.text.slice(0, 40)}`}
              onClick={(e) => {
                e.stopPropagation()
                onJumpTick(v.tick)
              }}
            />
          ))
        )}
        <span className="ticks">
          {fmtTick(firstTick, tickRate)} → {fmtTick(lastTick, tickRate)} @ {tickRate}T
        </span>
      </div>
    </div>
  )
}
