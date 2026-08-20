/**
 * 比分走势时间轴：上半为比分差折线（正=T 领先，负=CT 领先），
 * 下半为简化回合胜败色块条。点击色块/走势点可选中回合。
 */
import type { RoundInfo } from '@shared/types'

interface TimelineProps {
  rounds: RoundInfo[]
  selectedRound?: number
  onSelectRound: (roundNum: number) => void
}

const W = 100
const H = 44
const MID = H / 2

export function Timeline({ rounds, selectedRound, onSelectRound }: TimelineProps) {
  // 每回合结束后的比分与分差
  let t = 0
  let c = 0
  const points = rounds.map((r) => {
    if (r.winner === 'T') t++
    else if (r.winner === 'CT') c++
    return { r: r.roundNum, diff: t - c }
  })
  if (points.length === 0) return null

  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.diff)))
  const px = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2)
  const py = (d: number) => MID - (d / maxAbs) * (H / 2 - 5)
  const line = points.map((p, i) => `${px(i).toFixed(2)},${py(p.diff).toFixed(2)}`).join(' ')

  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend">
        <line x1={0} y1={MID} x2={W} y2={MID} className="trend-zero" />
        <polyline points={line} className="trend-line" />
        {points.map((p, i) => (
          <circle
            key={p.r}
            cx={px(i)}
            cy={py(p.diff)}
            r={1.2}
            className={`trend-dot ${selectedRound === p.r ? 'on' : ''}`}
            onClick={() => onSelectRound(p.r)}
          >
            <title>{`R${p.r} · 分差 ${p.diff > 0 ? '+' : ''}${p.diff}`}</title>
          </circle>
        ))}
      </svg>
      <div className="track">
        {rounds.map((r) => (
          <div
            key={r.roundNum}
            className={`seg ${r.winner === 'T' ? 'win-t' : r.winner === 'CT' ? 'win-ct' : ''} ${
              selectedRound === r.roundNum ? 'active' : ''
            }`}
            style={{ left: `${(r.roundNum - 1) / rounds.length * 100}%`, width: `${100 / rounds.length}%` }}
            onClick={() => onSelectRound(r.roundNum)}
            title={`R${r.roundNum} · ${r.winner === 'T' ? 'T' : r.winner === 'CT' ? 'CT' : '-'} · ${r.kills.length} 击杀`}
          />
        ))}
      </div>
      <div className="rlabels">
        {rounds.map((r) => (
          <span key={r.roundNum} className={`rlabel ${selectedRound === r.roundNum ? 'on' : ''}`} style={{ left: `${(r.roundNum - 0.5) / rounds.length * 100}%` }}>
            {r.roundNum}
          </span>
        ))}
      </div>
    </div>
  )
}
