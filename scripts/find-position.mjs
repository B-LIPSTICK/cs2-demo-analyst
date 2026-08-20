/**
 * 在长 WAV 中扫描与查询片段最相关的偏移（用 RMS 包络相关，快）
 * 用法: node scripts/find-position.mjs <long.wav> <query.wav>
 */
import { readFile } from 'node:fs/promises'

const [longFile, queryFile] = process.argv.slice(2)
const lb = await readFile(longFile)
const qb = await readFile(queryFile)
const lSr = lb.readUInt32LE(24), qSr = qb.readUInt32LE(24)
const lBits = lb.readUInt16LE(34), qBits = qb.readUInt16LE(34)
const lN = Math.floor((lb.length - 44) / (lBits / 8))
const qN = Math.floor((qb.length - 44) / (qBits / 8))
const getS = (b, bits, off) => {
  if (bits === 16) return b.readInt16LE(off) / 32768
  if (bits === 32) return b.readInt32LE(off) / 2147483647
  return 0
}
const lS = new Float32Array(lN)
for (let i = 0; i < lN; i++) lS[i] = getS(lb, lBits, 44 + i * (lBits / 8))
const qS = new Float32Array(qN)
for (let i = 0; i < qN; i++) qS[i] = getS(qb, qBits, 44 + i * (qBits / 8))

// 包络：10ms 窗口 RMS
const win = Math.floor(Math.min(lSr, qSr) * 0.01)
const env = (s, sr) => {
  const out = []
  for (let i = 0; i < s.length; i += win) {
    let sum = 0, c = 0
    for (let j = i; j < Math.min(i + win, s.length); j++) { sum += s[j] * s[j]; c++ }
    out.push(Math.sqrt(sum / Math.max(1, c)))
  }
  return out
}
const lE = env(lS, lSr)
const qE = env(qS, qSr)
console.log(`long env=${lE.length} query env=${qE.length}`)

let bests = []
for (let p = 0; p + qE.length < lE.length; p += 5) {
  let num = 0, da = 0, db = 0
  for (let i = 0; i < qE.length; i++) {
    const a = lE[p + i], b = qE[i]
    num += a * b; da += a * a; db += b * b
  }
  const c = num / Math.sqrt(da * db)
  if (Number.isFinite(c)) bests.push({ p, c })
  if (bests.length > 20000) bests.sort((x, y) => y.c - x.c), bests.length = 1000
}
bests.sort((x, y) => y.c - x.c)
console.log('top matches:')
for (const { p, c } of bests.slice(0, 8)) {
  console.log(`  corr=${c.toFixed(3)} at ${(p * win / lSr).toFixed(2)}s`)
}
