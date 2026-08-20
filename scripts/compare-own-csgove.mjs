// 对比 own decode 与 csgove fresh compact 的波形
import { readFile } from 'node:fs/promises'
const a = await readFile('test-data/devil-own-decode-seg0.wav')
const b = await readFile(process.argv[2] ?? 'test-data/csgove-fresh/9211588078062082572_0_Devil\'_76561198132865304.wav')
const load = (buf) => {
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
const A = load(a), B = load(b)
console.log(`A sr=${A.sr} bits=${A.bits} n=${A.s.length} (${(A.s.length / A.sr).toFixed(2)}s)`)
console.log(`B sr=${B.sr} bits=${B.bits} n=${B.s.length} (${(B.s.length / B.sr).toFixed(2)}s)`)

// B 的 100ms 能量包络
const env = (s) => { const o = []; const w = 4800; for (let i = 0; i < s.length; i += w) { let sum = 0, c = 0; for (let j = i; j < Math.min(i + w, s.length); j++) { sum += s[j] * s[j]; c++ } o.push(Math.sqrt(sum / Math.max(1, c))) } return o }
const eB = env(B.s)
console.log('B env (100ms):', eB.map((v) => v.toFixed(2)).join(' '))

// 找 B 中与 A 包络最匹配的位置
const eA = env(A.s)
let best = { p: 0, c: -1 }
for (let p = 0; p + eA.length < eB.length; p += 2) {
  let num = 0, da = 0, db = 0
  for (let i = 0; i < eA.length; i++) { const x = eB[p + i], y = eA[i]; num += x * y; da += x * x; db += y * y }
  const c = num / Math.sqrt(da * db)
  if (Number.isFinite(c) && c > best.c) best = { p, c }
}
console.log(`A-env best match in B at ${(best.p * 0.1).toFixed(2)}s corr=${best.c.toFixed(3)}`)
console.log('A env (100ms):', eA.map((v) => v.toFixed(2)).join(' '))
