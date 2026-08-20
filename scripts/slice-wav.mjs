/**
 * 从（已转 16-bit 的）csgove 输出 WAV 中按秒切片
 * 用法: node scripts/slice-wav.mjs <in.wav> <t0s> <durS> <out.wav>
 */
import { readFile, writeFile } from 'node:fs/promises'

const [src, t0s, durS, out] = process.argv.slice(2)
const b = await readFile(src)
const sr = b.readUInt32LE(24)
const bits = b.readUInt16LE(34)
const dataOff = 44
const bps = bits / 8
const s0 = Math.floor(parseFloat(t0s) * sr)
const n = Math.floor(parseFloat(durS) * sr)
const data = Buffer.alloc(n * 2)
for (let i = 0; i < n; i++) {
  const off = dataOff + (s0 + i) * bps
  let v
  if (bits === 16) v = b.readInt16LE(off) / 32768
  else if (bits === 32) v = b.readInt32LE(off) / 2147483647
  else if (bits === 24) v = ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16)) << 8 >> 8) / 8388607
  else { console.error('unsupported bits', bits); process.exit(1) }
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2)
}
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8)
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20)
hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 2, 28)
hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40)
await writeFile(out, Buffer.concat([hdr, data]))
console.log(`sliced ${out}: ${t0s}s + ${durS}s -> ${(n / sr).toFixed(2)}s @${sr}Hz`)
