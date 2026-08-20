/**
 * Web 版语音解码：把解析出的 SVC_VOICE_DATA 原始 Opus 帧解码为 16-bit PCM WAV。
 * 使用 vendored wasm-audio-decoders（/opus-decoder.js，纯 WASM，浏览器可用）。
 *
 * 流程: 按说话者(xuid/entity)分组 → tick 排序 → 静音间隙(>800ms)切段
 *       → decodeFrames 逐段解码 → Float32 PCM → WAV Blob（时间轴保留）
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

interface OpusDecoderApi {
  new (): {
    ready: Promise<void>
    decodeFrames(frames: Uint8Array[]): Promise<{
      channelData: Float32Array[]
      samplesDecoded: number
      sampleRate: number
    }>
    reset(): Promise<void>
    free(): void
  }
}

const g = (typeof window !== 'undefined' ? window : globalThis) as {
  'opus-decoder'?: { OpusDecoder: OpusDecoderApi }
}

function getDecoder(): OpusDecoderApi | null {
  return g['opus-decoder']?.OpusDecoder ?? null
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
  const Decoder = getDecoder()
  if (!Decoder) throw new Error('Opus 解码器未加载')
  console.log('[decodeVoice] decoder ok, msgs:', result.voiceMsgs.length)

  const groups = groupFrames(result.voiceMsgs)
  console.log('[decodeVoice] groups:', groups.size)
  const total = [...groups.values()].reduce((s, f) => s + splitSegments(f).length, 0)
  console.log('[decodeVoice] total segments:', total)
  let done = 0
  const out: VoiceSegmentWav[] = []

  const decoder = new Decoder()
  await decoder.ready

  const nameOf = (key: string): string | undefined => {
    const xuid = key.startsWith('xuid:') ? key.slice(5) : undefined
    if (!xuid) return undefined
    return result.players.find((p) => p.steamId === xuid)?.name
  }

  for (const [key, frames] of groups) {
    for (const seg of splitSegments(frames)) {
      try {
        // 逐帧解码（批量 decodeFrames 对含异常帧的序列不稳，单帧最可靠）
        const chunks: Float32Array[] = []
        let rate = 48000
        let ok = false
        for (const f of seg) {
          try {
            const r = await decoder.decodeFrames([base64ToBytes(f.voiceData)])
            if (r.channelData?.[0] && r.channelData[0].length > 0) {
              chunks.push(r.channelData[0])
              rate = r.sampleRate || rate
              ok = true
            }
          } catch (err) {
            /* 单帧失败跳过（丢包/坏帧） */
            if (process.env['DEBUG_VOICE'] === '1') {
              console.error('[voice] frame fail', String((err as Error)?.message ?? err))
            }
          }
        }
        if (!ok) {
          done++
          continue
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0)
        const pcm = new Float32Array(totalLen)
        let off = 0
        for (const c of chunks) {
          pcm.set(c, off)
          off += c.length
        }
        out.push({
          playerKey: key,
          playerName: nameOf(key),
          startTick: seg[0].tick,
          endTick: seg[seg.length - 1].tick,
          durationSec: pcm.length / rate,
          wav: pcmToWavBlob(pcm, rate)
        })
      } catch (err) {
        console.warn('[voice] segment decode failed', err)
      }
      done++
      onProgress?.(done, total)
      await decoder.reset()
    }
  }
  decoder.free()
  return out.sort((a, b) => a.startTick - b.startTick)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
