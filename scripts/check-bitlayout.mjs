// 验证 csgove int32 位布局：高16位 vs 低16位
import { readFileSync } from 'node:fs'
const raw = readFileSync('test-data/csgove-fresh/9211588078062082572_0_Devil\'_76561198132865304.wav')
const good = readFileSync('test-data/devil-csgove-fresh-16.wav')
const base = Math.floor(6.5 * 48000)
console.log('int32 raw vs (raw>>16) vs (raw&0xffff) vs correct-converted-16:')
for (let i = base; i < base + 10; i++) {
  const v = raw.readInt32LE(44 + i * 4)
  const hi = v >> 16
  const lo = (v & 0xffff) << 16 >> 16
  const good16 = good.readInt16LE(44 + i * 2)
  console.log(`  v=${(v >>> 0).toString(16).padStart(8, '0')} hi16=${hi} lo16=${lo} correct16=${good16}`)
}
