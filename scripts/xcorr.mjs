// 样本级对比两个 wav（自动找最佳延迟）
import { readFile } from 'node:fs/promises'
const [fa, fb] = process.argv.slice(2)
const load = async (f) => {
  const buf = await readFile(f)
  const sr = buf.readUInt32LE(24), bits = buf.readUInt16LE(34)
  const n = Math.floor((buf.length - 44) / (bits / 8))
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const off = 44 + i * (bits / 8)
    if (bits === 16) s[i] = buf.readInt16LE(off) / 32768
    else if (bits === 32) s[i] = buf.readInt32LE(off) / 2147483647
    else if (bits === 24) s[i] = ((buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)) << 8 >> 8) / 8388607
  }
  return { sr, bits, s }
}
const A = await load(fa), B = await load(fb)
console.log(`A ${fa.split(/[\\/]/).pop()} ${A.s.length} samples ${(A.s.length / A.sr).toFixed(2)}s`)
console.log(`B ${fb.split(/[\\/]/).pop()} ${B.s.length} samples ${(B.s.length / B.sr).toFixed(2)}s`)
const n = Math.min(A.s.length, B.s.length, 48000 * 3)
// 粗扫延迟 ±2000
let best = { lag: 0, c: -2 }
for (let lag = -2000; lag <= 2000; lag += 10) {
  let num = 0, da = 0, db = 0
  const lo = Math.max(0, -lag), hi = Math.min(n, n - lag)
  for (let i = lo; i < hi; i += 2) {
    const x = A.s[i + lag], y = B.s[i]
    num += x * y; da += x * x; db += y * y
  }
  const c = num / Math.sqrt(da * db)
  if (Number.isFinite(c) && c > best.c) best = { lag, c }
}
console.log(`best corr=${best.c.toFixed(4)} at lag=${best.lag} samples (${(best.lag / 48000).toFixed(4)}s)`)
// 幅度对比
let rmsA = 0, rmsB = 0
for (let i = 0; i < n; i++) { rmsA += A.s[i] * A.s[i]; rmsB += B.s[i] * B.s[i] }
console.log(`RMS A=${Math.sqrt(rmsA / n).toFixed(4)} RMS B=${Math.sqrt(rmsB / n).toFixed(4)}`)
