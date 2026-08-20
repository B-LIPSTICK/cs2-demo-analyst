/**
 * 用 eshaz/wasm-audio-decoders 的 OpusDecoder 解码 .raw 帧序列为 16-bit WAV
 * 用法: node scripts/decode-wasm-own.mjs <raw> [out.wav]
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const rawFile = process.argv[2]
const outWav = process.argv[3] ?? rawFile.replace(/\.raw$/i, '.wasm.wav')
const buf = await readFile(rawFile)

const frames = []
let off = 0
while (off + 4 <= buf.length) {
  const len = buf.readUInt32LE(off)
  off += 4
  if (off + len > buf.length) break
  frames.push(new Uint8Array(buf.subarray(off, off + len)))
  off += len
}
console.log(`frames: ${frames.length}`)

// 加载 UMD bundle（Node CJS）
const mod = require('../test-data/opus-decoder.js')
const { OpusDecoder } = mod
const decoder = new OpusDecoder({ channels: 1, sampleRate: 48000 })
await decoder._init() // 直接模式（非 worker）需要手动初始化

// decodeFrames 一次喂全部帧（按序），返回 {channelData, samplesDecoded, sampleRate}
const start = Date.now()
const out = decoder.decodeFrames(frames)
console.log(`decode ok in ${Date.now() - start}ms sampleRate=${out.sampleRate} samples=${out.samplesDecoded}`)

const ch = out.channelData[0]
const pcm = Buffer.alloc(ch.length * 2)
for (let i = 0; i < ch.length; i++) {
  const v = Math.max(-1, Math.min(1, ch[i])) * 32767
  pcm.writeInt16LE(Math.round(v), i * 2)
}
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8)
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20)
hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(48000, 24); hdr.writeUInt32LE(96000, 28)
hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34)
hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40)
await writeFile(outWav, Buffer.concat([hdr, pcm]))
console.log(`wrote ${outWav} (${(ch.length / 48000).toFixed(2)}s)`)
