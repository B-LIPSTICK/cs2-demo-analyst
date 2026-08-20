/**
 * 分析 WAV：按 10ms 窗口计算 RMS 能量，定位有效语音区间。
 * 用法: node scripts/wav-energy.mjs <file.wav> [--int32] [--u16]
 * 默认按 16-bit 解读；--int32 按 32-bit 解读。
 */
import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'

const file = process.argv[2]
const asInt32 = process.argv.includes('--int32')
const asU16 = process.argv.includes('--u16')

const buf = await readFile(file)
if (buf.toString('latin1', 0, 4) !== 'RIFF') { console.error('not RIFF'); process.exit(1) }
const findChunk = (id) => {
  let off = 12
  while (off + 8 <= buf.length) {
    const cid = buf.toString('latin1', off, off + 4)
    const sz = buf.readUInt32LE(off + 4)
    if (cid === id) return { off: off + 8, sz }
    off += 8 + sz + (sz & 1)
  }
  return null
}
const fmt = findChunk('fmt ')
const data = findChunk('data')
if (!fmt || !data) { console.error('no fmt/data'); process.exit(1) }
const bits = buf.readUInt16LE(fmt.off + 14)
const sr = buf.readUInt32LE(fmt.off + 4)
const ch = buf.readUInt16LE(fmt.off + 2)
const bps = bits / 8
console.log(`sr=${sr} ch=${ch} bits=${bits} dataBytes=${data.sz} dur=${(data.sz / sr / ch / bps).toFixed(1)}s`)

const WIN = Math.floor(sr * 0.02) // 20ms
const stride = Math.floor(sr * 0.02)
const nWin = Math.floor(data.sz / ch / bps / stride)
const rms = []
for (let w = 0; w < nWin; w++) {
  let sum = 0
  let off = data.off + w * stride * ch * bps
  for (let i = 0; i < WIN; i++) {
    let v
    if (asInt32) {
      v = buf.readInt32LE(off + i * ch * 4) / 2147483647
    } else if (asU16) {
      v = (buf.readUInt16LE(off + i * ch * 2) - 32768) / 32768
    } else {
      v = buf.readInt16LE(off + i * ch * 2) / 32768
    }
    sum += v * v
  }
  rms.push(Math.sqrt(sum / WIN))
}
const maxRms = Math.max(...rms)
const thresh = maxRms * 0.05
console.log(`maxRMS=${maxRms.toFixed(4)} threshold=${thresh.toFixed(4)}`)
// 合并语音区间（gap>500ms 切段）
const segs = []
let cur = null
for (let w = 0; w < rms.length; w++) {
  const active = rms[w] >= thresh
  if (active && !cur) cur = { s: w, e: w }
  else if (active && cur) cur.e = w
  else if (!active && cur) {
    if ((w - cur.e) * 0.02 > 0.5) { segs.push(cur); cur = null }
  }
}
if (cur) segs.push(cur)
console.log('active regions (sec):')
for (const s of segs) console.log(`  ${(s.s * 0.02).toFixed(1)} - ${(s.e * 0.02).toFixed(1)}  (${((s.e - s.s) * 0.02).toFixed(1)}s)`)
