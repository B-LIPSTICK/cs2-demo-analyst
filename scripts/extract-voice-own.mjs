/**
 * extract-voice-own.mjs —— 自研 CS2 demo 语音提取 + 解码（不依赖 csgove）
 *
 * 原理：
 *  - CS2 SVC_VOICE_DATA.audio.voiceData 是 base64 的裸 Opus 帧（TOC config=14 → 16kHz SILK，消息头显式声明 sampleRate=48000）
 *  - 用 @deademx/cs2（纯 JS）解析 demo，按 xuid/entity 过滤并保留 tick 排序的帧序列
 *  - 用 eshaz/wasm-audio-decoders 的 OpusDecoder（WASM libopus，纯 JS 加载，零原生编译）逐帧解码
 *  - 输出：每玩家若干段 48kHz/16-bit WAV（静音间隙 >800ms 切段），附 JSON 元数据
 *
 * 依赖（npm 镜像有）:
 *   @deademx/cs2, @deademx/engine   —— 仓库已有
 *   @eshaz/web-worker                —— UMD bundle 在 CJS 下 require 它（纯 JS shim）
 *   自带: scripts/lib/opus-decoder.js（来自 eshaz/wasm-audio-decoders dist，WASM 内联）
 *
 * 用法:
 *   node scripts/extract-voice-own.mjs <demo.dem> [--out <dir>] [--xuid <steamid64>] [--entity N] [--gap-ms 800]
 *
 * 输出:
 *   <out>/<demobase>/<xuid|entity>_segNNN_t<startTick>.wav
 *   <out>/<demobase>/<xuid|entity>.json
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage } from '@deademx/cs2'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)

// ---------- CLI ----------
const args = process.argv.slice(2)
const demo = args[0]
if (!demo) {
  console.error('usage: node scripts/extract-voice-own.mjs <demo.dem> [--out <dir>] [--xuid <steamid64>] [--entity N] [--gap-ms 800]')
  process.exit(1)
}
const getOpt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def
}
const outDir = getOpt('--out', 'test-data/opus-dump')
const filterXuid = getOpt('--xuid', null)
const filterEntity = getOpt('--entity', null)
const gapMs = Number(getOpt('--gap-ms', '800'))

// ---------- 1) 解析 demo 提取帧 ----------
const parser = new Parser(
  new ParserConfiguration({ messagePacketTypes: [MessagePacketType.SVC_VOICE_DATA] })
)
const speakers = new Map()
let totalMsgs = 0

parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, (dp, mp) => {
  if (mp.type !== MessagePacketType.SVC_VOICE_DATA) return
  totalMsgs++
  const d = mp.data
  if (!d?.audio?.voiceData) return
  let pkt
  try { pkt = Buffer.from(d.audio.voiceData, 'base64') } catch { return }
  if (!pkt || pkt.length < 2) return
  const entity = d.entity ?? -1
  const xuid = d.xuid ? (BigInt(d.xuid.high) << 32n) + BigInt(d.xuid.low) : 0n
  if (filterXuid && xuid.toString() !== filterXuid) return
  if (filterEntity && entity !== Number(filterEntity)) return
  const key = filterXuid ? `xuid_${filterXuid}` : `entity_${entity}`
  let sp = speakers.get(key)
  if (!sp) {
    sp = { key, entity, xuid: xuid.toString(), frames: [], msgCount: 0 }
    speakers.set(key, sp)
  }
  sp.msgCount++
  sp.frames.push({ tick: dp.tick, pkt, bytes: pkt.length })
})

await parser.parse(createReadStream(demo))
await parser.dispose()
console.log(`total SVC_VOICE_DATA msgs = ${totalMsgs}`)
if (speakers.size === 0) {
  console.error('no frames matched filter')
  process.exit(1)
}

// ---------- 2) 排序 + 去重 + 分段 ----------
const TICK_MS = 1000 / 64
for (const sp of speakers.values()) {
  sp.frames.sort((a, b) => a.tick - b.tick)
  const seen = new Set()
  sp.frames = sp.frames.filter((f) => {
    const k = `${f.tick}:${f.bytes}:${f.pkt[0]}:${f.pkt[1]}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const segs = []
  let cur = [], lastTick = null
  for (const f of sp.frames) {
    if (lastTick !== null && (f.tick - lastTick) * TICK_MS > gapMs && cur.length) {
      segs.push(cur); cur = []
    }
    cur.push(f)
    lastTick = f.tick
  }
  if (cur.length) segs.push(cur)
  sp.segments = segs.map((frames) => ({
    startTick: frames[0].tick,
    endTick: frames[frames.length - 1].tick,
    frames
  }))
  console.log(`speaker ${sp.key} (entity=${sp.entity} xuid=${sp.xuid}): ${sp.frames.length} frames -> ${sp.segments.length} segments`)
}

// ---------- 3) WASM Opus 解码 ----------
const { OpusDecoder } = require(fileURLToPath(new URL('./lib/opus-decoder.js', import.meta.url)))
const decoder = new OpusDecoder({ channels: 1, sampleRate: 48000 })
await decoder._init()

const outRoot = path.resolve(outDir)
const demoBase = path.basename(demo).replace(/\.dem$/i, '')
const dumpDir = path.join(outRoot, demoBase)
await mkdir(dumpDir, { recursive: true })

function writeWav(samples, filePath) {
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i])) * 32767
    pcm.writeInt16LE(Math.round(v), i * 2)
  }
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8)
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20)
  hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(48000, 24); hdr.writeUInt32LE(96000, 28)
  hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34)
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40)
  return writeFile(filePath, Buffer.concat([hdr, pcm]))
}

for (const sp of speakers.values()) {
  for (let i = 0; i < sp.segments.length; i++) {
    const seg = sp.segments[i]
    const out = decoder.decodeFrames(seg.frames.map((f) => new Uint8Array(f.pkt)))
    const ch = out.channelData[0]
    const file = path.join(dumpDir, `${sp.key}_seg${String(i).padStart(3, '0')}_t${seg.startTick}.wav`)
    await writeWav(ch, file)
    console.log(`  wrote ${path.basename(file)} (${(ch.length / 48000).toFixed(2)}s, ${seg.frames.length} frames)`)
  }
  await writeFile(
    path.join(dumpDir, `${sp.key}.json`),
    JSON.stringify({
      demo: path.basename(demo),
      entity: sp.entity,
      xuid: sp.xuid,
      msgCount: sp.msgCount,
      gapMs,
      segments: sp.segments.map((s) => ({ startTick: s.startTick, endTick: s.endTick, n: s.frames.length })),
    }, null, 2)
  )
}
decoder.free()
console.log(`done -> ${dumpDir}`)
