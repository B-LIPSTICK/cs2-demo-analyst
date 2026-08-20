/**
 * 样本级互相关：在长 WAV 中定位 query 的最强匹配（10ms 步进粗扫 + 精细校正）
 * 用法: node scripts/find-position2.mjs <long.wav> <query.wav>
 */
import { readFile } from 'node:fs/promises'

const [longFile, queryFile] = process.argv.slice(2)
const lb = await readFile(longFile)
const qb = await readFile(queryFile)
const getS = (b, bits, off) => {
  if (bits === 16) return b.readInt16LE(off) / 32768
  if (bits === 32) return b.readInt32LE(off) / 2147483647
  return 0
}
const lBits = lb.readUInt16LE(34), qBits = qb.readUInt16LE(34)
const lSr = lb.readUInt32LE(24), qSr = qb.readUInt32LE(24)
const lN = Math.floor((lb.length - 44) / (lBits / 8))
const qN = Math.floor((qb.length - 44) / (qBits / 8))
const lS = new Float32Array(lN)
for (let i = 0; i < lN; i++) lS[i] = getS(lb, lBits, 44 + i * (lBits / 8))
const qS = new Float32Array(qN)
for (let i = 0; i < qN; i++) qS[i] = getS(qb, qBits, 44 + i * (qBits / 8))

// query 非零起止
let q0 = 0, q1 = qN
while (q0 < qN && Math.abs(qS[q0]) < 0.005) q0++
while (q1 > q0 && Math.abs(qS[q1 - 1]) < 0.005) q1--
console.log(`query active samples ${q0}..${q1} (${((q1 - q0) / qSr).toFixed(2)}s)`)

// 粗扫：200 样本步进，能量相关
const step = 200
const cands = []
for (let p = 0; p + (q1 - q0) < lN; p += step) {
  let num = 0, da = 0, db = 0
  for (let i = q0; i < q1; i += 4) {
    const a = lS[p + i - q0], b = qS[i]
    num += a * b; da += a * a; db += b * b
  }
  const c = num / Math.sqrt(da * db)
  if (Number.isFinite(c) && c > 0.3) cands.push({ p, c })
}
cands.sort((x, y) => y.c - x.c)
console.log('coarse top:')
for (const { p, c } of cands.slice(0, 10)) console.log(`  c=${c.toFixed(3)} at ${(p / lSr).toFixed(2)}s`)

// 精细：对 top-5 做 ±2000 样本精扫
const fine = []
for (const { p } of cands.slice(0, 5)) {
  let best = { off: 0, c: -1 }
  for (let off = -2000; off <= 2000; off += 20) {
    const pp = p + off
    if (pp < 0 || pp + (q1 - q0) > lN) continue
    let num = 0, da = 0, db = 0
    for (let i = q0; i < q1; i += 2) {
      const a = lS[pp + i - q0], b = qS[i]
      num += a * b; da += a * a; db += b * b
    }
    const c = num / Math.sqrt(da * db)
    if (Number.isFinite(c) && c > best.c) best = { off, c }
  }
  fine.push({ p: p + best.off, c: best.c })
}
fine.sort((x, y) => y.c - x.c)
console.log('fine top:')
for (const { p, c } of fine.slice(0, 5)) console.log(`  c=${c.toFixed(3)} at ${(p / lSr).toFixed(3)}s`)
