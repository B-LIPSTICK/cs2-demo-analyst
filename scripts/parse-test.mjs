/**
 * 解析器独立验证脚本（开发用）
 * 用法: node scripts/parse-test.mjs <demo路径> [--json]
 */
import { parseDemo } from '../out/parser-bundle.mjs'

const demo = process.argv[2]
if (!demo) {
  console.error('usage: node scripts/parse-test.mjs <demo.dem>')
  process.exit(1)
}

const t0 = Date.now()
const result = await parseDemo(demo, (p) => {
  process.stdout.write(`\rparse ${Math.round((p.bytes / p.total) * 100)}%`)
})
const secs = ((Date.now() - t0) / 1000).toFixed(1)
process.stdout.write('\n')

const summary = {
  map: result.mapName,
  teams: [result.teamT, result.teamCT],
  score: [result.scoreT, result.scoreCT],
  rounds: result.rounds.length,
  kills: result.rounds.reduce((s, r) => s + r.kills.length, 0),
  chat: result.chat.length,
  players: result.players.map((p) => `${p.name}(${p.team}) K${p.kills}/D${p.deaths}/A${p.assists} HS${p.hsp}%`),
  voice: result.hasVoice,
  voiceSec: result.voiceSec,
  firstTick: result.firstTick,
  lastTick: result.lastTick,
  durationMin: Math.round(result.lastTick / 64 / 60),
  parseSecs: secs
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`map=${result.mapName} teams=${result.teamT}/${result.teamCT} score=${result.scoreT}:${result.scoreCT}`)
  console.log(`rounds=${result.rounds.length} kills=${summary.kills} chat=${result.chat.length} voice=${result.hasVoice}(${result.voiceSec}s)`)
  console.log(`ticks ${result.firstTick}..${result.lastTick} (${summary.durationMin}min) parsed in ${secs}s`)
  console.log('players:')
  for (const p of result.players) console.log(`  ${p.name} [${p.team}] K${p.kills}/D${p.deaths}/A${p.assists} HS${p.hsp}% MVP${p.mvp}`)
  const r1 = result.rounds[0]
  if (r1) {
    console.log('round1:', JSON.stringify({ num: r1.roundNum, start: r1.startTick, end: r1.endTick, winner: r1.winner, type: r1.endType, kills: r1.kills.length, plant: r1.bombPlantedTick }))
  }
  console.log('chat sample:', result.chat.slice(0, 5).map((c) => `[${c.channel}] ${c.playerName}: ${c.text}`).join(' | '))
}
