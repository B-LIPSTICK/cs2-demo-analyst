/**
 * 对比两个 WAV 在相同时间窗的波形：RMS、相关度
 * 用法: node scripts/compare-wavs.mjs <a.wav> <b.wav> [windowSec]
 */
import { readFile } from 'node:fs/promises'

const [fa, fb] = process.argv.slice(2)
const win = parseFloat(process.argv[3] ?? '1.0')

const load = async (f) => {
  const b = await readFile(f)
  const sr = b.readUInt32LE(24)
  const bits = b.readUInt16LE(34)
  const dataOff = 44
  const n = Math.floor((b.length - dataOff) / (bits / 8))
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const off = dataOff + i * (bits / 8)
    if (bits === 16) samples[i] = b.readInt16LE(off) / 32768
    else if (bits === 32) samples[i] = b.readInt32LE(off) / 2147483647
    else if (bits === 24) samples[i] = ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16)) << 8 >> 8) / 8388607
  }
  return { sr, samples }
}

const a = await load(fa)
const b = await load(fb)
console.log(`A: ${fa} sr=${a.sr} ${(a.samples.length / a.sr).toFixed(2)}s`)
console.log(`B: ${fb} sr=${b.sr} ${(b.samples.length / b.sr).toFixed(2)}s`)

const n = Math.floor(Math.min(a.samples.length, b.samples.length, win * 48000))
const segA = a.samples.subarray(0, n)
const segB = b.samples.subarray(0, n)

const rms = (s) => Math.sqrt(s.reduce((x, v) => x + v * v, 0) / s.length)
console.log(`RMS A=${rms(segA).toFixed(4)} RMS B=${rms(segB).toFixed(4)}`)

// 归一化互相关（找最佳延迟）
let best = { lag: 0, corr: -1 }
for (let lag = -4800; lag <= 4800; lag += 20) {
  let num = 0, denA = 0, denB = 0
  const nn = n - 4800
  for (let i = 4800; i < nn; i++) {
    const ja = i + lag
    if (ja < 0 || ja >= n) continue
    num += segA[ja] * segB[i]
    denA += segA[ja] * segA[ja]
    denB += segB[i] * segB[i]
  }
  const c = num / Math.sqrt(denA * denB)
  if (c > best.corr) best = { lag, corr: c }
}
console.log(`best cross-corr=${best.corr.toFixed(3)} at lag=${best.lag} samples (${(best.lag / 48000).toFixed(3)}s)`)

// 逐样本比较（零延迟，降采样到 1/20）
let same = 0
for (let i = 0; i < n; i += 20) {
  if (Math.abs(segA[i] - segB[i]) < 0.05) same++
}
console.log(`samples within 0.05: ${same}/${Math.floor(n / 20)} (${((same / (n / 20)) * 100).toFixed(1)}%)`)
