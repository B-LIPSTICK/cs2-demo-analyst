// 检查 csgove 32-bit wav 的 int32 值分布（判断是满幅 int32 还是低 16 位有效）
import { readFile } from 'node:fs/promises'
const f = process.argv[2]
const buf = await readFile(f)
const bits = buf.readUInt16LE(34)
const n = Math.floor((buf.length - 44) / (bits / 8))
console.log(`bits=${bits} samples=${n}`)
let min = Infinity, max = -Infinity, absSum = 0, low16active = 0
const hist = new Map()
for (let i = 0; i < n; i++) {
  const off = 44 + i * 4
  const v = buf.readInt32LE(off)
  if (v < min) min = v
  if (v > max) max = v
  absSum += Math.abs(v)
  const low16 = (v & 0xffff) << 16 >> 16 // sign-extended low 16 bits
  if (Math.abs(low16) > 100) low16active++
  const bucket = Math.abs(v) < 65536 ? '<2^16' : Math.abs(v) < 2 ** 24 ? '<2^24' : '>=2^24'
  hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
}
console.log(`min=${min} max=${max} meanAbs=${(absSum / n).toFixed(0)}`)
console.log('histogram:', [...hist.entries()].map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`samples where low16>100: ${low16active}/${n} (${((low16active / n) * 100).toFixed(1)}%)`)
// 前 20 个值
const first = []
for (let i = 0; i < 20; i++) first.push(buf.readInt32LE(44 + i * 4))
console.log('first int32:', first.join(', '))
