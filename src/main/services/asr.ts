/**
 * 语音提取（csgove sidecar）与转写编排（本地 whisper.cpp / 云端 OpenAI 兼容）
 */
import { app, net } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { cpus } from 'node:os'
import type { DemoDetail, VoiceSegment } from '@shared/types'
import {
  ensureCsgove,
  ensureWhisperCli,
  ensureWhisperModel,
  csgoveDir,
  csgoveExe,
  whisperExe,
  whisperModelPath
} from './engines'

export interface AsrEvents {
  progress: (stage: string, done: number, total: number, message?: string) => void
  segment: (segment: VoiceSegment) => void
}

// ─── 静音裁剪（能量 VAD）───────────────────────────────────────────────────

export interface SpeechChunk {
  start: number // 秒（原轨时间）
  end: number
}

/**
 * 能量门限语音检测：20ms 帧 RMS，合并间隙 <0.4s，丢弃 <0.3s 的碎片。
 * 输入须为规范 16-bit PCM WAV（normalizeWav 之后）。
 */
export async function detectSpeech(wavPath: string): Promise<SpeechChunk[]> {
  const buf = await fs.readFile(wavPath)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return []
  const bits = buf.readUInt16LE(34)
  if (bits !== 16) return []
  const rate = buf.readUInt32LE(24)
  let dataStart = 44
  // 找 data 块
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') {
      dataStart = pos + 8
      break
    }
    pos += 8 + size + (size % 2)
  }

  const frameLen = Math.max(1, Math.floor(rate / 50)) // 20ms
  const totalFrames = Math.floor((buf.length - dataStart) / 2 / frameLen)
  if (totalFrames <= 0) return []
  const THRESH = 200 // int16 RMS 阈值（≈满幅 0.6%）

  const isSpeech = new Array<boolean>(totalFrames)
  let sum = 0
  let count = 0
  for (let f = 0; f < totalFrames; f++) {
    sum = 0
    count = 0
    const base = dataStart + f * frameLen * 2
    for (let i = 0; i < frameLen && base + i * 2 + 1 < buf.length; i++) {
      const s = buf.readInt16LE(base + i * 2)
      sum += s * s
      count++
    }
    const rms = count ? Math.sqrt(sum / count) : 0
    isSpeech[f] = rms >= THRESH
  }

  const chunks: SpeechChunk[] = []
  let curStart = -1
  let lastSpeechFrame = -1
  for (let f = 0; f <= totalFrames; f++) {
    const speaking = f < totalFrames && isSpeech[f]
    if (speaking) {
      if (curStart < 0) curStart = f
      lastSpeechFrame = f
    } else if (curStart >= 0) {
      // 静音间隙超过 0.4s 才切段
      if (f - lastSpeechFrame > 20) {
        chunks.push({ start: curStart * 0.02, end: lastSpeechFrame * 0.02 + 0.02 })
        curStart = -1
      }
    }
  }
  if (curStart >= 0) {
    chunks.push({ start: curStart * 0.02, end: lastSpeechFrame * 0.02 + 0.02 })
  }
  return chunks.filter((c) => c.end - c.start >= 0.3)
}

/**
 * 把多个语音片段拼接成紧凑 WAV，返回 {path, offsets}。
 * offsets[i] = 第 i 段在原始轨道的起始秒。
 */
export async function buildCompactWav(
  wavPath: string,
  chunks: SpeechChunk[]
): Promise<{ path: string; offsets: number[] } | null> {
  const buf = await fs.readFile(wavPath)
  const rate = buf.readUInt32LE(24)
  const channels = buf.readUInt16LE(22)
  const dataStart = 44
  const bytesPerSec = rate * channels * 2

  const parts: Buffer[] = []
  const offsets: number[] = []
  let totalBytes = 0
  for (const c of chunks) {
    const from = dataStart + Math.floor(c.start * bytesPerSec)
    const to = dataStart + Math.floor(c.end * bytesPerSec)
    if (to > from && from < buf.length) {
      parts.push(buf.subarray(from, Math.min(to, buf.length)))
      totalBytes += Math.min(to, buf.length) - from
      offsets.push(c.start)
    }
  }
  // 空语音（VAD 没切出有效片段）→ 不拼接，让调用方转写原文件
  if (parts.length === 0 || totalBytes < 4096) return null

  const out = Buffer.alloc(44 + totalBytes)
  buf.copy(out, 0, 0, 44)
  out.writeUInt32LE(36 + totalBytes, 4)
  out.writeUInt32LE(totalBytes, 40)
  let o = 44
  for (const p of parts) {
    p.copy(out, o)
    o += p.length
  }
  const compactPath = wavPath.replace(/\.wav$/i, '.compact.wav')
  await fs.writeFile(compactPath, out)
  return { path: compactPath, offsets }
}

/** 把紧凑文件里的段时间映射回原始轨道时间 */
export function mapCompactSegments(
  segs: { start: number; end: number; text: string }[],
  chunks: SpeechChunk[],
  offsets: number[]
): { start: number; end: number; text: string }[] {
  let chunkIdx = 0
  let consumed = 0 // 已消费的紧凑时间
  const out: { start: number; end: number; text: string }[] = []
  for (const s of segs) {
    // 前进到 s.start 所属片段
    while (
      chunkIdx < chunks.length - 1 &&
      consumed + (chunks[chunkIdx].end - chunks[chunkIdx].start) < s.start + 0.05
    ) {
      consumed += chunks[chunkIdx].end - chunks[chunkIdx].start
      chunkIdx++
    }
    const base = offsets[chunkIdx] ?? chunks[chunkIdx]?.start ?? 0
    const local = Math.max(0, s.start - consumed)
    const localEnd = Math.max(local, s.end - consumed)
    out.push({
      start: base + local,
      end: base + localEnd,
      text: s.text
    })
  }
  return out
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void; signal?: AbortSignal }
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // 关键：stdio 用 ignore（不用管道捕获输出）。
    // 受限环境（沙箱/无管道）下 spawn 的管道 stdio 会 EPERM 或挂起导致子进程卡死；
    // csgove 用退出码判断、whisper-cli 用 -oj 输出 json 文件，都不依赖 stdout 捕获。
    const child = spawn(cmd, args, {
      windowsHide: true,
      cwd: opts.cwd,
      stdio: 'ignore',
      signal: opts.signal
    })
    let output = ''
    child.on('error', (err) => {
      console.error('[asr] spawn failed', cmd, args, err)
      reject(err)
    })
    child.on('exit', (code) => resolve({ code, output }))
  })
}

export interface WavItem {
  playerName: string
  steamId?: string
  team: VoiceSegment['team']
  path: string
}

function voicesDir(demoId: string): string {
  return join(app.getPath('userData'), 'voices', demoId)
}

/**
 * 语音切片播放：从该玩家整轨 WAV（48kHz/16bit 单声道，extractVoice 产物）中
 * 切出 [startSec, endSec) 时间段，返回独立的小 WAV Buffer（供 renderer 播放）。
 * 找不到对应文件 / 越界时返回 null。
 */
export async function sliceVoiceWav(
  demoId: string,
  steamId: string | undefined,
  playerName: string,
  startSec: number,
  endSec: number
): Promise<Buffer | null> {
  if (!(endSec > startSec) || startSec < 0) return null
  const dir = voicesDir(demoId)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return null
  }
  // 文件名形如 <demo>_<name>_<steamid>.wav 或 <steamid>.wav；优先按 steamId 精确匹配
  const wav = files.find((f) => {
    if (!f.toLowerCase().endsWith('.wav')) return false
    if (steamId) {
      if (f === `${steamId}.wav` || f.endsWith(`_${steamId}.wav`)) return true
    }
    // 中文/特殊字符玩家名可能被文件名转义，fallback：名字前缀匹配
    if (playerName && f.includes(playerName)) return true
    return false
  })
  if (!wav) return null
  const full = join(dir, wav)

  // 解析 WAV 头（可含 LIST/fact 等扩展块，须按块扫描定位 data）
  let hdr = Buffer.alloc(256)
  const fh = await fs.open(full, 'r')
  try {
    await fh.read(hdr, 0, 256, 0)
  } catch {
    await fh.close().catch(() => {})
    return null
  }
  if (hdr.toString('ascii', 0, 4) !== 'RIFF' || hdr.toString('ascii', 8, 12) !== 'WAVE') {
    await fh.close().catch(() => {})
    return null
  }
  const channels = hdr.readUInt16LE(22)
  const rate = hdr.readUInt32LE(24)
  const bits = hdr.readUInt16LE(34)
  const bytesPerSample = bits / 8
  const blockAlign = channels * bytesPerSample
  let dataStart = -1
  let dataSize = 0
  let pos = 12
  // 头可能超过 256 字节（罕见），循环读块头定位 data
  while (pos + 8 <= 1024 * 1024) {
    if (pos + 8 > hdr.length) {
      const ext = Buffer.alloc(4096)
      const { bytesRead } = await fh.read(ext, 0, 4096, pos)
      if (bytesRead < 8) break
      hdr = Buffer.concat([hdr, ext])
    }
    const id = hdr.toString('ascii', pos, pos + 4)
    const size = hdr.readUInt32LE(pos + 4)
    if (id === 'data') {
      dataStart = pos + 8
      dataSize = size
      break
    }
    pos += 8 + size + (size % 2)
  }
  if (dataStart < 0 || bytesPerSample < 2) {
    await fh.close().catch(() => {})
    return null
  }

  // 需要读取的样本区间（含 60ms 前后缓冲，便于听感）
  const padSamples = Math.floor(rate * 0.06)
  const fromSample = Math.max(0, Math.floor(startSec * rate) - padSamples)
  const toSample = Math.min(
    Math.floor(dataSize / blockAlign),
    Math.floor(endSec * rate) + padSamples
  )
  const nSamples = toSample - fromSample
  if (nSamples <= 0) {
    await fh.close().catch(() => {})
    return null
  }

  // 只读需要的字节段
  const dataBuf = Buffer.alloc(nSamples * blockAlign)
  await fh.read(dataBuf, 0, dataBuf.length, dataStart + fromSample * blockAlign)
  await fh.close().catch(() => {})

  // 组装独立小 WAV（规范 44 字节头）
  const out = Buffer.alloc(44 + dataBuf.length)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + dataBuf.length, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(rate, 24)
  out.writeUInt32LE(rate * blockAlign, 28)
  out.writeUInt16LE(blockAlign, 32)
  out.writeUInt16LE(bits, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataBuf.length, 40)
  dataBuf.copy(out, 44)
  return out
}

/**
 * 规范化 csgove 输出的 WAV（已知怪癖：fmt=1 PCM 但 bits=32）。
 * 实测（research-voice-decode.md）：csgove 写入的是**真正的 int32 PCM**，
 * 语音有效位在**高 16 位**（int(v * MaxInt32) 满幅），低 16 位是量化残差。
 * 因此必须取高 16 位（>>16）转换，不能取低 16 位，否则音频变成噪声，
 * whisper 会产出「广播幻觉」（MING PAO CANADA / 字幕製作:貝爾 之类）。
 * 重写为规范 16-bit PCM。
 */
export async function normalizeWav(filePath: string): Promise<void> {
  let buf: Buffer
  try {
    buf = await fs.readFile(filePath)
  } catch {
    return
  }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return
  const fmtCode = buf.readUInt16LE(20)
  const channels = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  if (!(fmtCode === 1 && bits === 32)) return // 仅处理受影响的输出

  // 解析 RIFF 块定位 data
  let dataStart = -1
  let dataSize = 0
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') {
      dataStart = pos + 8
      dataSize = Math.min(size, buf.length - dataStart)
      break
    }
    pos += 8 + size + (size % 2)
  }
  if (dataStart < 0) return

  const newBits = 16
  const blockAlign = channels * (newBits / 8)
  const byteRate = rate * blockAlign
  const nSamples = Math.floor(dataSize / 4)
  const newDataSize = nSamples * 2

  const out = Buffer.alloc(44 + newDataSize)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + newDataSize, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(rate, 24)
  out.writeUInt32LE(byteRate, 28)
  out.writeUInt16LE(blockAlign, 32)
  out.writeUInt16LE(newBits, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(newDataSize, 40)
  for (let i = 0; i < nSamples; i++) {
    // 取 int32 高 16 位（真实音频），低 16 位是残差噪声
    const v = buf.readInt32LE(dataStart + i * 4)
    out.writeInt16LE(v >> 16, 44 + i * 2)
  }
  const tmp = `${filePath}.norm.tmp`
  await fs.writeFile(tmp, out)
  await fs.rename(tmp, filePath)
  console.log(`[asr] normalized wav ${basename(filePath)} (csgove 32bit -> 16bit high-word)`)
}

/** 提取 demo 内全部玩家语音（split-full：全时长带静音，时间轴与 demo 对齐） */
export async function extractVoice(
  detail: DemoDetail,
  events: AsrEvents,
  signal?: AbortSignal
): Promise<WavItem[]> {
  const demo = detail.meta
  const outDir = voicesDir(demo.id)
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  await ensureCsgove((p) => {
    events.progress('voice-extract', Math.round((p.received / Math.max(1, p.total)) * 100), 100)
  })

  events.progress('voice-extract', 0, 1)
  const res = await run(csgoveExe(), ['-mode', 'split-full', '-output', outDir, demo.path], {
    // csgove 从 CWD 查找 vaudio_celt.dll 等库文件
    cwd: csgoveDir(),
    signal
  })
  if (res.code !== 0) {
    throw new Error(`csgove 退出码 ${res.code}: ${res.output.slice(-600)}`)
  }

  // 输出: 每玩家一个 WAV；命名形如 <demo>_<name>_<steamid>.wav 或 <steamid>.wav
  const files = (await fs.readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.wav'))
  const items: WavItem[] = []
  for (const f of files) {
    const full = join(outDir, f)
    await normalizeWav(full)
    const stem = basename(f, '.wav')
    const sidMatch = stem.match(/_(\d{17})$/)
    const sid = sidMatch ? sidMatch[1] : stem
    const player = (demo.players ?? []).find((p) => p.steamId === sid)
    const nameFromFile = sidMatch ? stem.slice(0, stem.lastIndexOf('_')) : stem
    items.push({
      playerName: player?.name ?? nameFromFile,
      steamId: sid,
      team: player?.team ?? 'NONE',
      path: full
    })
  }
  return items
}

interface WhisperSeg {
  start: number
  end: number
  text: string
}

/** 本地 whisper.cpp 转写（-l auto, JSON 输出） */
export async function transcribeLocal(
  wavPath: string,
  model: 'base' | 'small' | 'medium',
  signal?: AbortSignal
): Promise<WhisperSeg[]> {
  await ensureWhisperCli(() => {})
  await ensureWhisperModel(model, () => {})
  const outPrefix = wavPath.replace(/\.wav$/i, '')
  const threads = Math.max(2, cpus().length - 2)
  const res = await run(
    whisperExe(),
    ['-m', whisperModelPath(model), '-f', wavPath, '-l', 'auto', '-t', String(threads), '-oj', '-of', outPrefix, '--no-prints'],
    { signal }
  )
  if (res.code !== 0 && res.code !== null) {
    throw new Error(`whisper 退出码 ${res.code}: ${res.output.slice(-400)}`)
  }
  const jsonPath = `${outPrefix}.json`
  let raw = await fs.readFile(jsonPath, 'utf-8').catch(() => '')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const data = JSON.parse(raw || '{}') as {
    transcription?: {
      offsets?: { from: number; to: number }
      timestamps?: { from?: string; to?: string }
      text: string
    }[]
  }
  const parseTs = (s: string | undefined): number | null => {
    if (!s) return null
    const m = s.match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/)
    if (!m) return null
    const h = m[1] ? Number(m[1]) : 0
    return (h * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4])
  }
  const segs: WhisperSeg[] = []
  for (const t of data.transcription ?? []) {
    const text = t.text?.trim()
    if (!text) continue
    let from: number | null = null
    let to: number | null = null
    if (t.offsets && Number.isFinite(t.offsets.from)) {
      from = t.offsets.from
      to = t.offsets.to
    } else {
      from = parseTs(t.timestamps?.from)
      to = parseTs(t.timestamps?.to)
    }
    if (from !== null && to !== null) {
      segs.push({ start: from / 1000, end: to / 1000, text })
    }
  }
  return segs
}

/** 云端 OpenAI 兼容转写（默认 Groq whisper-large-v3-turbo，verbose_json 带时间戳） */
export async function transcribeCloud(
  wavPath: string,
  cfg: { baseUrl: string; apiKey: string; model: string },
  signal?: AbortSignal
): Promise<WhisperSeg[]> {
  if (!cfg.apiKey) throw new Error('未配置云端 API Key（设置 → 转写引擎 → 获取免费 Key）')
  const base = cfg.baseUrl.replace(/\/+$/, '')
  // 手动构造 multipart/form-data（Node 全局 FormData 与 Electron net.fetch 不完全兼容，
  // 用 Buffer 拼接最稳）
  const boundary = `----cs2danalyst${Date.now().toString(16)}`
  const fileBuf = await fs.readFile(wavPath)
  const parts: Buffer[] = []
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="voice.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
    ),
    fileBuf,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${cfg.model}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`),
    Buffer.from(`--${boundary}--\r\n`)
  )
  const body = Buffer.concat(parts)
  // 用 Electron net.fetch（走 Chromium 网络栈，跟随系统代理）：
  // 全局 fetch 不走 Windows 系统代理，国内网络访问 Groq 等会被墙（403/连接失败）
  const res = await net.fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body,
    signal
  })
  if (!res.ok) {
    const bodyText = (await res.text().catch(() => '')).slice(0, 300)
    const hint =
      res.status === 403
        ? '（403：服务商拒绝，常见于直连被墙 —— 请确认系统代理已开启，或换用可直连的服务商如硅基流动）'
        : res.status === 401
          ? '（401：API Key 无效，请检查设置中的 Key）'
          : ''
    throw new Error(`云端转写失败 HTTP ${res.status}${hint}: ${bodyText}`)
  }
  const data = (await res.json()) as { segments?: { start: number; end: number; text: string }[] }
  const segs: WhisperSeg[] = []
  for (const s of data.segments ?? []) {
    const text = s.text?.trim()
    if (text) segs.push({ start: s.start, end: s.end, text })
  }
  return segs
}

export interface TranscribeOptions {
  engine: 'local' | 'cloud'
  localModel: 'base' | 'small' | 'medium'
  cloudBaseUrl: string
  cloudApiKey: string
  cloudModel: string
  players?: string[]
}

/**
 * 完整转写流程：提取 → 逐玩家 ASR → 时间戳映射到 tick/回合
 */
export async function transcribeDemo(
  detail: DemoDetail,
  options: TranscribeOptions,
  events: AsrEvents,
  signal?: AbortSignal
): Promise<VoiceSegment[]> {
  const tickRate = detail.meta.tickRate ?? 64
  const segments: VoiceSegment[] = []

  events.progress('voice-extract', 0, 1)
  let items = await extractVoice(detail, events, signal)
  if (options.players?.length) {
    items = items.filter((i) => options.players!.includes(i.playerName))
  }
  if (items.length === 0) {
    throw new Error('该 Demo 未提取到任何语音（MM 天梯 demo 不含语音）')
  }

  const roundOf = (tick: number): number | undefined => {
    for (const r of detail.rounds) {
      if (tick >= r.startTick && tick < r.endTick) return r.roundNum
    }
    return undefined
  }

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break
    const item = items[i]
    events.progress(
      options.engine === 'cloud' ? 'asr-cloud' : 'asr-local',
      i,
      items.length
    )
    let segs: WhisperSeg[]
    try {
      // 阶段①：VAD 静音裁剪（读 100+MB 整轨算能量，耗时数秒，先提示）
      events.progress(
        options.engine === 'cloud' ? 'asr-cloud' : 'asr-local',
        i,
        items.length,
        `${item.playerName} · 裁剪中…`
      )
      const chunks = await detectSpeech(item.path)
      let effective: { start: number; end: number; text: string }[]
      if (chunks.length === 0) {
        console.log(`[asr] ${item.playerName}: no speech detected, skipping`)
        events.progress(options.engine === 'cloud' ? 'asr-cloud' : 'asr-local', i + 1, items.length)
        continue
      }
      const totalSec = chunks.reduce((s, c) => s + (c.end - c.start), 0)
      const speechRatio = totalSec / Math.max(1, (await fs.stat(item.path)).size / (48000 * 2))
      let compact: { path: string; offsets: number[] } | null = null
      if (chunks.length > 1 || chunks[0].start > 1 || speechRatio < 0.9) {
        compact = await buildCompactWav(item.path, chunks)
      }
      // VAD 没切出有效语音 → 直接转写原文件（避免 0 字节紧凑文件导致 whisper 卡死）
      const targetWav = compact?.path ?? item.path
      // 阶段②：ASR 转写
      events.progress(
        options.engine === 'cloud' ? 'asr-cloud' : 'asr-local',
        i,
        items.length,
        `${item.playerName} · 转写中${compact ? `（${chunks.length} 段已裁剪）` : '（整轨）'}`
      )
      if (options.engine === 'cloud') {
        const raw = await transcribeCloud(targetWav, {
          baseUrl: options.cloudBaseUrl,
          apiKey: options.cloudApiKey,
          model: options.cloudModel
        }, signal)
        effective = compact ? mapCompactSegments(raw, chunks, compact.offsets) : raw
      } else {
        const raw = await transcribeLocal(targetWav, options.localModel, signal)
        effective = compact ? mapCompactSegments(raw, chunks, compact.offsets) : raw
      }
      if (compact) {
        await fs.unlink(compact.path).catch(() => {})
      }
      segs = effective
    } catch (err) {
      if (signal?.aborted) break
      console.error(`[asr] ${item.playerName} failed`, err)
      continue
    }
    for (const s of segs) {
      const tick = Math.round(s.start * tickRate)
      const endTick = Math.round(s.end * tickRate)
      const seg: VoiceSegment = {
        tick,
        endTick,
        timeSec: s.start,
        endSec: s.end,
        playerName: item.playerName,
        steamId: item.steamId,
        team: item.team,
        text: s.text,
        roundNum: roundOf(tick),
        engine: options.engine
      }
      segments.push(seg)
      events.segment(seg)
    }
    events.progress(options.engine === 'cloud' ? 'asr-cloud' : 'asr-local', i + 1, items.length)
  }

  return segments
}

/** 语音分割结果（无文字，仅分段信息，供直接听） */
export interface VoiceSplitSegment {
  playerName: string
  steamId?: string
  team: VoiceSegment['team']
  startSec: number
  endSec: number
  tick: number
  endTick: number
}

/**
 * 语音分割：提取（csgove）→ VAD 静音切段 → 返回每段的时间/玩家（不转写，无需 API Key）。
 * 适合只想要语音片段、不转文字的用户（配合播放按钮直接听）。
 */
export async function splitVoice(
  detail: DemoDetail,
  events: AsrEvents,
  signal?: AbortSignal
): Promise<VoiceSplitSegment[]> {
  const tickRate = detail.meta.tickRate ?? 64
  const out: VoiceSplitSegment[] = []
  let items: WavItem[]
  try {
    items = await extractVoice(detail, events, signal)
  } catch (err) {
    throw new Error(`语音提取失败：${err instanceof Error ? err.message : String(err)}`)
  }
  if (items.length === 0) {
    throw new Error('该 Demo 未提取到任何语音（MM 天梯 demo 不含语音）')
  }
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break
    const item = items[i]
    events.progress('voice-split', i, items.length, `${item.playerName} · 分割中…`)
    try {
      const chunks = await detectSpeech(item.path)
      for (const c of chunks) {
        out.push({
          playerName: item.playerName,
          steamId: item.steamId,
          team: item.team,
          startSec: c.start,
          endSec: c.end,
          tick: Math.round(c.start * tickRate),
          endTick: Math.round(c.end * tickRate)
        })
      }
    } catch (err) {
      console.error(`[asr] split ${item.playerName} failed`, err)
    }
    events.progress('voice-split', i + 1, items.length, `${item.playerName} · 完成`)
  }
  return out.sort((a, b) => a.tick - b.tick)
}
