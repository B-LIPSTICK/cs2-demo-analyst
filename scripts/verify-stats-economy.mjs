/**
 * 验证：ADR、KAST、Rating 2.0、首杀对决与回合经济解析
 * 用法: node --experimental-strip-types scripts/verify-stats-economy.mjs <demo路径>
 */
import { parseDemo } from '../src/main/services/parser.ts'

const [, , demoPath] = process.argv
if (!demoPath) {
  console.error('用法: node --experimental-strip-types scripts/verify-stats-economy.mjs <demo路径>')
  process.exit(1)
}

console.log('开始解析 Demo:', demoPath)
const result = await parseDemo(demoPath)

console.log('\n=== 1. 比赛概况 ===')
console.log(`地图: ${result.mapName} | 回合数: ${result.rounds.length} | 比分: ${result.teamT}(T) ${result.scoreT} : ${result.scoreCT} (CT)${result.teamCT}`)

console.log('\n=== 2. 选手表现 (含 ADR / KAST / Rating 2.0 / FK / FD) ===')
console.log('选手名'.padEnd(20) + '阵营'.padEnd(6) + 'K/D/A'.padEnd(12) + 'ADR'.padEnd(8) + 'KAST%'.padEnd(8) + 'Rating'.padEnd(8) + 'FK/FD'.padEnd(8) + '总伤害')
console.log('-'.repeat(80))
for (const p of result.players) {
  const kda = `${p.kills}/${p.deaths}/${p.assists}`
  const fkfd = `${p.firstKills ?? 0}/${p.firstDeaths ?? 0}`
  console.log(
    (p.name || 'Unknown').padEnd(20) +
    p.team.padEnd(6) +
    kda.padEnd(12) +
    String(p.adr ?? 0).padEnd(8) +
    `${p.kast ?? 0}%`.padEnd(8) +
    String(p.rating ?? 0).padEnd(8) +
    fkfd.padEnd(8) +
    String(p.totalDamage ?? 0)
  )
}

console.log('\n=== 3. 前 5 回合经济与首杀概况 ===')
for (let i = 0; i < Math.min(5, result.rounds.length); i++) {
  const r = result.rounds[i]
  const fk = r.firstKill ? `${r.firstKill.attackerName} -> ${r.firstKill.victimName} (${r.firstKill.weapon})` : '无'
  const econT = r.economy ? `T: ${r.economy.t.buyType} (花$${r.economy.t.spentCash} 剩$${r.economy.t.startCash} 补偿$${r.economy.t.lossBonusAmount})` : '无'
  const econCT = r.economy ? `CT: ${r.economy.ct.buyType} (花$${r.economy.ct.spentCash} 剩$${r.economy.ct.startCash} 补偿$${r.economy.ct.lossBonusAmount})` : '无'
  console.log(`R${r.roundNum} [胜者:${r.winner} 胜因:${r.endType}] | 首杀: ${fk}`)
  console.log(`     经济 -> ${econT} | ${econCT}`)
}

// 断言检查
let errors = 0
for (const p of result.players) {
  if (p.rating === undefined || p.rating < 0.05 || p.rating > 3.5) {
    console.error(`❌ Rating 异常: ${p.name} rating=${p.rating}`)
    errors++
  }
  if (p.adr === undefined || p.adr < 0) {
    console.error(`❌ ADR 异常: ${p.name} adr=${p.adr}`)
    errors++
  }
  if (p.kast === undefined || p.kast < 0 || p.kast > 100) {
    console.error(`❌ KAST 异常: ${p.name} kast=${p.kast}`)
    errors++
  }
}
for (const r of result.rounds) {
  if (!r.economy) {
    console.error(`❌ 回合缺少经济信息: R${r.roundNum}`)
    errors++
  }
}

if (errors === 0) {
  console.log('\n✅ 全部数据校验通过，ADR、KAST、Rating 2.0、首杀与经济计算正常！')
} else {
  console.error(`\n❌ 发现 ${errors} 处数据异常`)
  process.exit(1)
}
