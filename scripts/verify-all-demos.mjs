/**
 * 全面验证: 击杀阵营一致率 + 无名字击杀统计（两个 demo）
 * 用法: node --experimental-strip-types scripts/verify-all-demos.mjs
 */
import { parseDemo } from '../src/main/services/parser.ts'

const DEMOS = [
  { id: '92152', path: 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem' },
  { id: '92071', path: 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\4a2071e93e6da7aa\\9207154890384076300_0.dem' }
]

for (const d of DEMOS) {
  console.log(`\n========== demo ${d.id} ==========`)
  const r = await parseDemo(d.path)
  console.log(`回合: ${r.rounds.length}, 玩家: ${r.players.length}, 击杀总数: ${r.rounds.reduce((a, x) => a + x.kills.length, 0)}`)

  // 玩家表
  console.log('玩家表:')
  for (const p of r.players) console.log(`  ${p.name} [${p.team}] ${p.kills}杀`)

  // 击杀分析
  let noName = 0
  let noVictimName = 0
  let noTeam = 0
  let friendly = 0
  let total = 0
  const samples = []
  for (const round of r.rounds) {
    for (const k of round.kills) {
      total++
      if (!k.attackerName) noName++
      if (!k.victimName) noVictimName++
      if (k.attackerTeam === 'NONE' || k.victimTeam === 'NONE') noTeam++
      if (k.attackerTeam !== 'NONE' && k.attackerTeam === k.victimTeam && k.attackerName && k.victimName) {
        friendly++
        if (samples.length < 10) samples.push(`R${round.roundNum} @${Math.round(k.tick / 64)}s: ${k.attackerName}(${k.attackerTeam}) → ${k.victimName}(${k.victimTeam}) [${k.weapon}]`)
      }
    }
  }
  console.log(`\n击杀: 总${total} 无攻击者名${noName} 无受害者名${noVictimName} 无阵营${noTeam} 同阵营${friendly}`)
  console.log('同阵营样例:')
  for (const s of samples) console.log(`  ${s}`)
  console.log('\n无名字击杀样例（前 8）:')
  let shown = 0
  for (const round of r.rounds) {
    for (const k of round.kills) {
      if ((!k.attackerName || !k.victimName) && shown < 8) {
        console.log(`  R${round.roundNum} @${Math.round(k.tick / 64)}s: atk=${k.attackerName ?? k.attackerUid}(${k.attackerTeam}) → vic=${k.victimName ?? k.victimUid}(${k.victimTeam}) [${k.weapon}]`)
        shown++
      }
    }
  }
}
