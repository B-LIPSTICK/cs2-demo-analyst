/**
 * 验证击杀阵营修复: 解析 demo，统计每回合击杀的攻方阵营分布
 * 预期: 上半场（R1-12）T 击杀为 T 方，换边后（R13+）翻转
 * 用法: node --experimental-strip-types scripts/verify-kill-teams.mjs
 */
import { parseDemo } from '../src/main/services/parser.ts'

const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'

const t0 = Date.now()
const result = await parseDemo(DEMO)
console.log(`解析完成 ${Date.now() - t0}ms, ${result.rounds.length} 回合, ${result.players.length} 玩家\n`)

// 找换边点：实时阵营跟踪显示换边 tick=75840（1185s）。这里用「首杀 attackerTeam 从 T 变为 CT 的回合」辅助，
// 更可靠：对比每个玩家击杀时的 attackerTeam 与最终阵营是否相反
console.log('\n=== 换边验证：击杀阵营 vs 最终阵营 ===')
// 取每个玩家上半场（R1-12）击杀的 attackerTeam 与最终 team 对比
const byPlayer = new Map()
for (const r of result.rounds.filter((x) => x.roundNum <= 12)) {
  for (const k of r.kills) {
    if (!byPlayer.has(k.attackerName)) byPlayer.set(k.attackerName, [])
    byPlayer.get(k.attackerName).push(k.attackerTeam)
  }
}
for (const [name, teams] of byPlayer) {
  const p = result.players.find((x) => x.name === name)
  const tCount = teams.filter((t) => t === 'T').length
  const ctCount = teams.filter((t) => t === 'CT').length
  const dominant = tCount >= ctCount ? 'T' : 'CT'
  const finalTeam = p?.team ?? '?'
  const consistent = dominant === finalTeam
  console.log(`  ${name}: 上半场击杀阵营 T=${tCount} CT=${ctCount} → 主导=${dominant} 最终=${finalTeam} ${consistent ? '✓一致' : '✗翻转(预期,换边)'}`)
}

console.log('\n每回合击杀攻方分布:')
for (const r of result.rounds) {
  const tKills = r.kills.filter((k) => k.attackerTeam === 'T').length
  const ctKills = r.kills.filter((k) => k.attackerTeam === 'CT').length
  const none = r.kills.length - tKills - ctKills
  const side = tKills > ctKills ? 'T 主导' : ctKills > tKills ? 'CT 主导' : '-'
  console.log(`  R${String(r.roundNum).padStart(2)}: T=${String(tKills).padStart(2)} CT=${String(ctKills).padStart(2)} 无色=${none} ${side}`)
}

// 未着色击杀统计
let noneTotal = 0
for (const r of result.rounds) noneTotal += r.kills.filter((k) => k.attackerTeam === 'NONE').length
console.log(`\n无阵营击杀总数: ${noneTotal}（应接近 0，燃烧瓶等非玩家击杀可忽略）`)

// 玩家最终阵营
console.log('\n玩家表（最终阵营）:')
for (const p of result.players) {
  console.log(`  ${p.name}: ${p.team} (${p.kills}杀 ${p.deaths}死)`)
}
