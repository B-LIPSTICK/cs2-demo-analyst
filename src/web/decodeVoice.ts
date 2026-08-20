/**
 * Web 版语音解码：把解析出的 SVC_VOICE_DATA 原始 Opus 帧解码为 16-bit PCM WAV。
 * 首选 ffmpeg.wasm（-f opus 裸流，经真实 demo 验证可靠）；失败时回退 wasm-audio-decoders。
 *
 * 流程: 按说话者(xuid/entity)分组 → tick 排序 → 静音间隙(>800ms)切段
 *       → 每段解码 → WAV（时间轴保留）
 */
import type { ParseResult } from './parseDemo'

export interface VoiceSegmentWav {
  playerKey: string
  playerName?: string
  startTick: number
  endTick: number
  wav: Blob
  durationSec: number
}

interface FrameMsg {
  tick: number
  voiceData: string
}

const g = (typeof window !== 'undefined' ? window : globalThis) as {
  'opus-decoder'?: { OpusDecoder: unknown }
}

function getDecoder(): { OpusDecoder: unknown } | null {
  return g['opus-decoder'] ?? null
}

// ─── ffmpeg.wasm 解码后端（首选，可靠）────────────────────────────────────

let ffmpegSingleton: Promise<import('@ffmpeg/ffmpeg').FFmpeg | null> | null = null

async function getFfmpeg(): Promise<import('@ffmpeg/ffmpeg').FFmpeg | null> {
  if (ffmpegSingleton) return ffmpegSingleton
  ffmpegSingleton = (async () => {
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const ffmpeg = new FFmpeg()
      ffmpeg.on('log', ({ message }) => {
        if (process.env['DEBUG_VOICE'] === '1' || /error|Error/i.test(message)) {
          console.log('[ffmpeg]', message)
        }
      })
      await ffmpeg.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' })
      return ffmpeg
    } catch (err) {
      console.warn('[voice] ffmpeg.wasm 加载失败', err)
      return null
    }
  })()
  return ffmpegSingleton
}

// ─── Ogg Opus 容器（ffmpeg.wasm 用标准 Ogg demuxer 更稳）──────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    t[i] = r >>> 0
  }
  return t
})()

function oggCrc(data: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0
  }
  return crc
}

function oggPage(serial: number, seq: number, packets: Uint8Array[], granule: number, type: number): Uint8Array {
  const lacing: number[] = []
  for (const p of packets) {
    let rest = p.length
    while (rest >= 255) {
      lacing.push(255)
      rest -= 255
    }
    lacing.push(rest)
  }
  const header = new Uint8Array(27 + lacing.length)
  const dv = new DataView(header.buffer)
  for (let i = 0; i < 4; i++) header[i] = 'OggS'.charCodeAt(i)
  header[4] = 0
  header[5] = type
  dv.setBigInt64(6, BigInt(granule), true)
  dv.setUint32(14, serial, true)
  dv.setUint32(18, seq, true)
  header[26] = lacing.length
  header.set(lacing, 27)
  const bodyLen = packets.reduce((s, p) => s + p.length, 0)
  const page = new Uint8Array(header.length + bodyLen)
  page.set(header, 0)
  let off = header.length
  for (const p of packets) {
    page.set(p, off)
    off += p.length
  }
  dv.setUint32(22, oggCrc(page), true)
  return page
}

/** 帧序列 → Ogg Opus 文件字节（48kHz mono, preskip=0） */
function framesToOggOpus(frames: Uint8Array[]): Uint8Array {
  const serial = 0x44454144
  const opusHead = new Uint8Array(19)
  const dvh = new DataView(opusHead.buffer)
  for (let i = 0; i < 8; i++) opusHead[i] = 'OpusHead'.charCodeAt(i)
  opusHead[8] = 1
  opusHead[9] = 1 // mono
  dvh.setUint16(10, 0, true) // preskip
  dvh.setUint32(12, 48000, true)
  dvh.setInt16(16, 0, true)
  const vendor = new TextEncoder().encode('CS2DMA')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  const dvt = new DataView(tags.buffer)
  for (let i = 0; i < 8; i++) tags[i] = 'OpusTags'.charCodeAt(i)
  dvt.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  dvt.setUint32(12 + vendor.length, 0, true)

  const pages: Uint8Array[] = []
  pages.push(oggPage(serial, 0, [opusHead], 0, 2))
  pages.push(oggPage(serial, 1, [tags], 0, 0))
  let seq = 2
  let granule = 0
  const PER = 32
  for (let i = 0; i < frames.length; i += PER) {
    const batch = frames.slice(i, i + PER)
    granule += batch.length * 480 // 10ms 帧 @48k
    const isLast = i + PER >= frames.length
    pages.push(oggPage(serial, seq++, batch, granule, isLast ? 4 : 0))
  }
  const total = pages.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of pages) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** 帧序列 → Ogg Opus → ffmpeg 解码 → WAV 字节 */
async function decodeWithFfmpeg(frames: Uint8Array[]): Promise<Uint8Array | null> {
  const ffmpeg = await getFfmpeg()
  if (!ffmpeg) return null
  try {
    const ogg = framesToOggOpus(frames)
    await ffmpeg.writeFile('voice.ogg', ogg)
    await ffmpeg.exec([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', 'voice.ogg',
      '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le',
      'out.wav'
    ])
    const data = await ffmpeg.readFile('out.wav')
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer)
    if (bytes.length < 44) return null
    return bytes.slice()
  } catch (err) {
    console.warn('[voice] ffmpeg 解码失败', err)
    return null
  }
}

/** 帧按说话者分组并按 tick 排序 */
function groupFrames(voiceMsgs: ParseResult['voiceMsgs']): Map<string, FrameMsg[]> {
  const groups = new Map<string, FrameMsg[]>()
  for (const m of voiceMsgs) {
    const key = m.xuid ? `xuid:${m.xuid}` : `entity:${m.entity}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ tick: m.tick, voiceData: m.voiceData })
  }
  for (const frames of groups.values()) frames.sort((a, b) => a.tick - b.tick)
  return groups
}

/** 静音间隙 >800ms 切段 */
function splitSegments(frames: FrameMsg[]): FrameMsg[][] {
  const segs: FrameMsg[][] = []
  let cur: FrameMsg[] = []
  let lastTick: number | null = null
  for (const f of frames) {
    if (lastTick !== null && f.tick - lastTick > 800 / (1000 / 64) && cur.length > 0) {
      segs.push(cur)
      cur = []
    }
    cur.push(f)
    lastTick = f.tick
  }
  if (cur.length) segs.push(cur)
  return segs
}

/** Float32 PCM → 16-bit PCM WAV Blob */
export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const w = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i))
  }
  w(0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/**
 * 解码整个 demo 的语音。返回按说话者/时间段的 WAV 列表。
 * decoder 全局加载失败时抛错（提示刷新或环境不支持 WASM）。
 */
export async function decodeDemoVoice(
  result: ParseResult,
  onProgress?: (done: number, total: number) => void
): Promise<VoiceSegmentWav[]> {
  const groups = groupFrames(result.voiceMsgs)
  const total = [...groups.values()].reduce((s, f) => s + splitSegments(f).length, 0)
  let done = 0
  const out: VoiceSegmentWav[] = []

  // 解码后端：ffmpeg.wasm 优先，失败回退 wasm-audio-decoders
  const fallback = ((): ((seg: FrameMsg[]) => Promise<{ wav: Blob; rate: number } | null>) | null => {
    const dec = getDecoder()
    if (!dec) return null
    return async (seg: FrameMsg[]) => {
      const decoder = new (dec.OpusDecoder as new () => {
        ready: Promise<void>
        decodeFrames(f: Uint8Array[]): Promise<{ channelData?: Float32Array[]; sampleRate?: number }>
        free(): void
      })()
      await decoder.ready
      const chunks: Float32Array[] = []
      let rate = 48000
      for (const f of seg) {
        try {
          const r = await decoder.decodeFrames([base64ToBytes(f.voiceData)])
          if (r.channelData?.[0] && r.channelData[0].length > 0) {
            chunks.push(r.channelData[0])
            rate = r.sampleRate || rate
          }
        } catch {
          /* 单帧失败跳过 */
        }
      }
      decoder.free()
      if (chunks.length === 0) return null
      const totalLen = chunks.reduce((s, c) => s + c.length, 0)
      const pcm = new Float32Array(totalLen)
      let off = 0
      for (const c of chunks) {
        pcm.set(c, off)
        off += c.length
      }
      return { wav: pcmToWavBlob(pcm, rate), rate }
    }
  })()

  const nameOf = (key: string): string | undefined => {
    const xuid = key.startsWith('xuid:') ? key.slice(5) : undefined
    if (!xuid) return undefined
    return result.players.find((p) => p.steamId === xuid)?.name
  }

  for (const [key, frames] of groups) {
    for (const seg of splitSegments(frames)) {
      try {
        const frameBytes = seg.map((f) => base64ToBytes(f.voiceData))
        // 首选 ffmpeg.wasm
        let wav: Blob | null = null
        const ffWav = await decodeWithFfmpeg(frameBytes)
        if (ffWav) {
          wav = new Blob([ffWav as unknown as BlobPart], { type: 'audio/wav' })
        } else if (fallback) {
          const r = await fallback(seg)
          if (r) wav = r.wav
        }
        if (!wav) {
          done++
          continue
        }
        out.push({
          playerKey: key,
          playerName: nameOf(key),
          startTick: seg[0].tick,
          endTick: seg[seg.length - 1].tick,
          durationSec: wav.size / 48000 / 2,
          wav
        })
      } catch (err) {
        console.warn('[voice] segment decode failed', err)
      }
      done++
      onProgress?.(done, total)
    }
  }
  return out.sort((a, b) => a.startTick - b.startTick)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
