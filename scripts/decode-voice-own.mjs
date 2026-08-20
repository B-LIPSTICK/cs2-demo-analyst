/**
 * 把 extract-voice-own.mjs dump 的 .raw 帧序列解码为 WAV。
 * 支持三种解码后端：
 *   1. ffmpeg（-f opus 裸流，2 字节 BE 长度前缀）—— 默认，最稳
 *   2. @mohayonao/opus-decoder（纯 WASM）
 * 用法:
 *   node scripts/decode-voice-own.mjs <raw文件> [--out out.wav] [--backend ffmpeg|wasm]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const rawFile = process.argv[2]
if (!rawFile) { console.error('usage: node scripts/decode-voice-own.mjs <raw> [--out wav] [--backend ffmpeg|wasm]'); process.exit(1) }
const getOpt = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d }
const outWav = path.resolve(getOpt('--out', rawFile.replace(/\.raw$/i, '.wav')))
const backend = getOpt('--backend', 'ffmpeg')

const buf = await readFile(rawFile)
// 解析 [u32LE len][data] 帧序列
const frames = []
let off = 0
while (off + 4 <= buf.length) {
  const len = buf.readUInt32LE(off)
  off += 4
  if (off + len > buf.length) { console.error(`truncated frame at ${off - 4} len=${len}`); break }
  frames.push(buf.subarray(off, off + len))
  off += len
}
console.log(`parsed ${frames.length} frames from ${rawFile}`)

// 构造 ffmpeg raw opus 流: [u16BE len][data]...
function toRawOpus() {
  const total = frames.reduce((s, f) => s + 2 + f.length, 0)
  const out = Buffer.alloc(total)
  let o = 0
  for (const f of frames) {
    out.writeUInt16BE(f.length, o); o += 2
    f.copy(out, o); o += f.length
  }
  return out
}

async function decodeFfmpeg() {
  const ffmpegPath = process.env.FFMPEG_PATH || (await import('ffmpeg-static')).default
  const tmp = rawFile + '.rawopus'
  await writeFile(tmp, toRawOpus())
  await mkdir(path.dirname(outWav), { recursive: true })
  const args = ['-hide_banner', '-y', '-f', 'opus', '-i', tmp, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', outWav]
  console.log(`ffmpeg: ${ffmpegPath} ${args.join(' ')}`)
  await new Promise((res, rej) => {
    const p = spawn(ffmpegPath, args, { stdio: 'inherit' })
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`))))
  })
}

async function decodeWasm() {
  const { default: OpusDecoder } = await import('@mohayonao/opus-decoder')
  // 该库基于 WebAudio 上下文，Node 下需要 mock；先尝试
  const decoder = new OpusDecoder()
  const samples = []
  for (const f of frames) {
    const r = await decoder.decode(f)
    // r = {channelData, sampleRate, samplesDecoded} 或 null
    if (r?.channelData?.[0]) samples.push(r.channelData[0])
  }
  console.log('wasm backend decoded frames ->', samples.length)
}

if (backend === 'ffmpeg') await decodeFfmpeg()
else await decodeWasm()
console.log('done ->', outWav)
