/**
 * 原型：把 CS2 裸 Opus 帧封装为 Ogg Opus，用 wasm-audio-decoders decodeFile 解码。
 * 验证 Ogg 容器方案能否得到正确音频（对比 decodeFrames 的静音问题）。
 */
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { parseDemoWeb } from '../out/parse-web-bundle.mjs'

const require = createRequire(import.meta.url)

// ─── Ogg CRC ───────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    t[i] = r >>> 0
  }
  return t
})()

function crc32(data) {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0
  }
  return crc
}

function oggPage(serial, seq, packets, granule, type) {
  const body = packets.reduce((s, p) => s + p.length, 0)
  const lacing = []
  for (const p of packets) {
    const len = p.length
    if (len < 255) {
      lacing.push(len)
    } else {
      let rest = len
      while (rest >= 255) {
        lacing.push(255)
        rest -= 255
      }
      lacing.push(rest)
    }
  }
  const segTable = lacing.length
  const header = Buffer.alloc(27)
  header.write('OggS', 0, 'latin1')
  header[4] = 0
  header[5] = type
  header.writeBigInt64LE(BigInt(granule), 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(seq, 18)
  header.writeUInt32LE(0, 22) // CRC 占位
  header[26] = segTable
  const page = Buffer.concat([header, Buffer.from(lacing), ...packets.map((p) => Buffer.from(p))])
  const crc = crc32(new Uint8Array(page.buffer, page.byteOffset, page.length))
  page.writeUInt32LE(crc, 22)
  return new Uint8Array(page.buffer, page.byteOffset, page.length)
}

/** 帧序列 → Ogg Opus 文件（48kHz mono, preskip=0） */
export function framesToOggOpus(frames) {
  const serial = 0x44454144
  const opusHead = Buffer.alloc(19)
  opusHead.write('OpusHead', 0, 'latin1')
  opusHead[8] = 1
  opusHead[9] = 1 // channels
  opusHead.writeUInt16LE(0, 10) // preskip
  opusHead.writeUInt32LE(48000, 12)
  opusHead.writeInt16LE(0, 16)
  opusHead[18] = 0
  const vendor = Buffer.from('CS2DMA', 'latin1')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'latin1')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  tags.writeUInt32LE(0, 12 + vendor.length) // comment list len
  const pages = []
  pages.push(oggPage(serial, 0, [new Uint8Array(opusHead)], 0, 2))
  pages.push(oggPage(serial, 1, [new Uint8Array(tags)], 0, 0))
  // 帧：每页最多 64 包，granule 累计（480 样本/帧 @48k 10ms）
  let seq = 2
  let granule = 0
  const PAGE_PACKETS = 32
  for (let i = 0; i < frames.length; i += PAGE_PACKETS) {
    const batch = frames.slice(i, i + PAGE_PACKETS)
    granule += batch.length * 480
    const isLast = i + PAGE_PACKETS >= frames.length
    pages.push(oggPage(serial, seq++, batch, granule, isLast ? 4 : 0))
  }
  return new Uint8Array(Buffer.concat(pages.map((p) => Buffer.from(p))))
}

// ─── 主流程 ────────────────────────────────────────────────────────────────
const demo = process.argv[2] || 'test-data/demos/9211588078062082572_0.dem'
const parsed = await parseDemoWeb(Readable.toWeb(createReadStream(demo)), statSync(demo).size)
const msgs = parsed.voiceMsgs.filter((m) => m.xuid === '76561198037931906').slice(0, 30)
const frames = msgs.map((m) => {
  const bin = atob(m.voiceData)
  const b = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
  return b
})
const ogg = framesToOggOpus(frames)

globalThis['opus-decoder'] = require('../scripts/lib/opus-decoder.js')
const d = new globalThis['opus-decoder'].OpusDecoder()
await d.ready
const r = await d.decodeFile(ogg)
const pcm = r.channelData[0]
let sum = 0, peak = 0
for (const v of pcm) { sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v) }
console.log(`decodeFile: n=${pcm.length} rms=${Math.sqrt(sum / pcm.length).toExponential(2)} peak=${peak.toExponential(2)} rate=${r.sampleRate}`)

// 存 wav 供 whisper 验证
const n = pcm.length
const buf = Buffer.alloc(44 + n * 2)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(1, 22); buf.writeUInt32LE(r.sampleRate, 24); buf.writeUInt32LE(r.sampleRate * 2, 28)
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
for (let i = 0; i < n; i++) {
  const v = Math.max(-1, Math.min(1, pcm[i]))
  buf.writeInt16LE(v < 0 ? v * 0x8000 : v * 0x7fff, 44 + i * 2)
}
writeFileSync('test-data/web-voice/ogg-test.wav', buf)
console.log('wav saved')
