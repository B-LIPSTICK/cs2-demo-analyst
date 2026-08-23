/**
 * 验证：手枪局（隐式首回合）保留修复
 * 用法: node --experimental-strip-types scripts/verify-pistol-round.mjs <demo路径>
 */
import { parseDemo } from '../src/main/services/parser.ts'

const [, , demoPath] = process.argv
if (!demoPath) {
  console.error('用法: node scripts/verify-pistol-round.mjs <demo路径>')
  process.exit(1)
}

const result = await parseDemo(demoPath)
const rounds = result.rounds
const totalKills = rounds.reduce((s, r) => s + r.kills.length, 0)
console.log('总回合:', rounds.length, '| 总击杀:', totalKills)

const r1 = rounds[0]
console.log('R1: startTick=' + r1.startTick + ' endTick=' + r1.endTick +
  ' winner=' + r1.winner + ' endType=' + r1.endType + ' kills=' + r1.kills.length)
for (const k of r1.kills) {
  console.log(
    `  @${k.tick} ${k.attackerName}(${k.attackerTeam}) -> ${k.victimName}(${k.victimTeam}) wp=${k.weapon}`
  )
}

// 手枪局武器应全是手枪（显示名）
const pistolOnly = new Set(['Glock-18', 'USP-S', 'P250', 'Five-SeveN', 'Tec-9', 'CZ75-A', 'Dual Berettas', 'R8 Revolver', 'Desert Eagle'])
let bad = 0
for (const k of r1.kills) {
  if (k.weapon && !pistolOnly.has(k.weapon)) {
    bad++
    console.log('  ⚠ 非手枪武器:', k.weapon, '@', k.tick)
  }
}
console.log(bad === 0 ? '✓ R1 全为手枪武器' : `✗ R1 有 ${bad} 个非手枪武器`)
console.log('比分 6:13 应为 19 回合:', rounds.length === 19 ? '✓' : `✗ 实际 ${rounds.length}`)
