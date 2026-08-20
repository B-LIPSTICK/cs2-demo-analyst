/**
 * 把任意 WAV 转为 whisper 兼容的 16-bit PCM WAV（读取时按头部 bit 深度解释数据）
 * 用法: node scripts/wav-convert.mjs <in.wav> <out.wav>
 */
import { readFile, writeFile } from 'node:fs/promises'

const [inFile, outFile] = process.argv.slice(2)
const buf = await readFile(inFile)
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
const bits = buf.readUInt16LE(fmt.off + 14)
const sr = buf.readUInt32LE(fmt.off + 4)
const ch = buf.readUInt16LE(fmt.off + 2)
console.log(`in: sr=${sr} ch=${ch} bits=${bits} data=${data.sz}`)

const n = Math.floor(data.sz / ch / (bits / 8))
const out = Buffer.alloc(n * 2)
for (let i = 0; i < n; i++) {
  const off = data.off + i * ch * (bits / 8)
  let v
  if (bits === 32) v = buf.readInt32LE(off) / 2147483647
  else if (bits === 24) v = ((buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)) << 8 >> 8) / 8388607
  else if (bits === 16) v = buf.readInt16LE(off) / 32768
  else if (bits === 8) v = (buf[off] - 128) / 128
  else { console.error('unsupported bits', bits); process.exit(1) }
  const s16 = Math.max(-1, Math.min(1, v)) * 32767
  out.writeInt16LE(Math.round(s16), i * 2)
}
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + out.length, 4); hdr.write('WAVE', 8)
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20)
hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 2, 28)
hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34)
hdr.write('data', 36); hdr.writeUInt32LE(out.length, 40)
await writeFile(outFile, Buffer.concat([hdr, out]))
console.log(`wrote ${outFile} (${n} samples, ${(n / sr).toFixed(2)}s)`)
