/**
 * 语音说话者索引：解析 demo 的 SVC_VOICE_DATA 消息，得到
 * 「槽位(slot=entity-1) → 说话 tick 列表」脉冲数据（游戏内语音 HUD 用）。
 */
import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Parser, ParserConfiguration, InterceptorStage, MessagePacketType } from '@deademx/cs2'

export interface VoiceIndex {
  voicePacketCount: number
  malformedPacketCount: number
  /** slot(0-based, entity-1) → 说话 tick 列表（升序、相邻去重） */
  pulsesBySlot: Record<string, number[]>
  /** xuid → slot（说话者 SteamID 到槽位的映射，供 HUD 匹配） */
  slotByXuid: Record<string, number>
}

/** 语音索引磁盘缓存结构版本；提取逻辑或字段变化时 +1 使旧缓存失效 */
export const VOICE_INDEX_CACHE_VERSION = 2

interface VoiceIndexCacheEntry extends VoiceIndex {
  /** 原始 demo 路径：用于清理已删除 demo 的孤儿缓存 */
  demoPath: string
  mtimeMs: number
  sizeBytes: number
  version: number
}

/** 缓存目录固定在 userData/voice-index，不写游戏目录或原始 demo 目录 */
async function voiceIndexCachePath(demoPath: string, demoId?: string): Promise<string> {
  // 延迟加载 electron：诊断脚本会直接 import 本模块并调用 extractVoiceIndex，
  // 在纯 Node 下没有 app；缓存入口不可用时由调用方回退到无缓存提取。
  const electron = (await import('electron')) as typeof import('electron') & {
    default?: typeof import('electron')
  }
  const app = electron.app ?? electron.default?.app
  if (!app) throw new Error('Electron app 不可用')

  // 有调用方提供的 demoId 时优先使用；否则用规范化路径哈希，避免大小写差异产生多份缓存。
  // 文件名保持稳定，sizeBytes/mtimeMs 作为 JSON 指纹校验；demo 变化时覆盖同一份缓存，不堆积旧文件。
  const safeDemoId =
    demoId && demoId.length <= 64 && /^[A-Za-z0-9_-]+$/.test(demoId) ? demoId : null
  const key =
    safeDemoId ??
    createHash('sha1')
      .update(resolve(demoPath).replace(/\\/g, '/').toLowerCase())
      .digest('hex')
      .slice(0, 24)
  return join(app.getPath('userData'), 'voice-index', `${key}.json`)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 64
}

/** 校验缓存内容；版本、demo 指纹或字段结构不匹配时按未命中处理 */
function parseVoiceIndexCache(
  raw: string,
  sizeBytes: number,
  mtimeMs: number
): (VoiceIndex & { demoPath: string }) | null {
  try {
    const data = JSON.parse(raw) as Partial<VoiceIndexCacheEntry>
    if (!data || typeof data !== 'object') return null
    if (data.version !== VOICE_INDEX_CACHE_VERSION) return null
    if (data.sizeBytes !== sizeBytes || data.mtimeMs !== mtimeMs) return null
    if (typeof data.demoPath !== 'string' || !data.demoPath) return null
    if (!isCount(data.voicePacketCount) || !isCount(data.malformedPacketCount)) return null

    const rawPulses = data.pulsesBySlot
    const rawXuids = data.slotByXuid
    if (!rawPulses || typeof rawPulses !== 'object' || Array.isArray(rawPulses)) return null
    if (!rawXuids || typeof rawXuids !== 'object' || Array.isArray(rawXuids)) return null

    const pulsesBySlot: Record<string, number[]> = {}
    for (const [key, ticks] of Object.entries(rawPulses)) {
      const slot = Number(key)
      if (!isSlot(slot)) return null
      if (
        !Array.isArray(ticks) ||
        !ticks.every(
          (tick: unknown) => typeof tick === 'number' && Number.isFinite(tick) && tick >= 0
        )
      ) {
        return null
      }
      // HUD 会对 pulsesBySlot 做二分查找，缓存中的 tick 必须保持非降序
      for (let i = 1; i < ticks.length; i++) {
        if (ticks[i] < ticks[i - 1]) return null
      }
      pulsesBySlot[String(slot)] = ticks.slice()
    }

    const slotByXuid: Record<string, number> = {}
    for (const [xuid, slotValue] of Object.entries(rawXuids)) {
      // SteamID64 为纯数字；拒绝异常键名，避免污染普通对象原型
      if (!/^\d+$/.test(xuid)) return null
      const slot = Number(slotValue)
      if (!isSlot(slot)) return null
      slotByXuid[xuid] = slot
    }

    return {
      voicePacketCount: data.voicePacketCount,
      malformedPacketCount: data.malformedPacketCount,
      pulsesBySlot,
      slotByXuid,
      demoPath: data.demoPath
    }
  } catch {
    return null
  }
}

async function readVoiceIndexCache(
  cachePath: string,
  sizeBytes: number,
  mtimeMs: number
): Promise<VoiceIndex | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8')
    return parseVoiceIndexCache(raw, sizeBytes, mtimeMs)
  } catch {
    // 缓存不存在、不可读或 JSON 损坏都按未命中处理，由调用方重建
    return null
  }
}

let cacheWriteSeq = 0

/** 唯一临时文件 + rename 原子替换，避免并发/崩溃留下半截 JSON */
async function writeVoiceIndexCache(cachePath: string, entry: VoiceIndexCacheEntry): Promise<void> {
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const tmp = `${cachePath}.${process.pid}.${++cacheWriteSeq}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf-8')
    try {
      await fs.rename(tmp, cachePath)
    } catch {
      // Windows 上目标已存在或被短暂占用时，先移除再重试
      await fs.unlink(cachePath).catch(() => {})
      await fs.rename(tmp, cachePath)
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

/** 提取语音说话者索引（可中断：abort 时抛错） */
export async function extractVoiceIndex(
  demoPath: string,
  opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
): Promise<VoiceIndex> {
  const parser = new Parser(
    new ParserConfiguration({
      messagePacketTypes: [MessagePacketType.SVC_VOICE_DATA]
    })
  )

  const pulses = new Map<number, number[]>()
  const slotByXuid = new Map<string, number>()
  let voicePacketCount = 0
  let malformedPacketCount = 0
  let lastPulseTick = -1
  let lastPulseSlot = -1

  const throwIfAborted = () => {
    if (opts?.signal?.aborted) {
      const e = new Error('已取消')
      e.name = 'AbortError'
      throw e
    }
  }

  parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (_dp, messagePacket) => {
    throwIfAborted()
    if (!messagePacket || messagePacket.type !== MessagePacketType.SVC_VOICE_DATA) return
    const tick = _dp.tick
    const d = messagePacket.data as {
      entity?: number
      clientDeprecated?: number
      xuid?: string
    } | null
    if (!d) return
    voicePacketCount++
    const entity = Number.isInteger(d.entity) && (d.entity as number) >= 1 && (d.entity as number) <= 64
      ? (d.entity as number)
      : Number.isInteger(d.clientDeprecated) && (d.clientDeprecated as number) >= 0 && (d.clientDeprecated as number) < 64
        ? (d.clientDeprecated as number) + 1
        : 0
    if (!entity) {
      malformedPacketCount++
      return
    }
    const slot = entity - 1
    // 相邻同槽位同 tick 去重
    if (tick === lastPulseTick && slot === lastPulseSlot) return
    lastPulseTick = tick
    lastPulseSlot = slot
    let list = pulses.get(slot)
    if (!list) {
      list = []
      pulses.set(slot, list)
    }
    list.push(tick)
    const xuidStr = d.xuid != null ? String(d.xuid) : ''
    if (xuidStr && !slotByXuid.has(xuidStr)) slotByXuid.set(xuidStr, slot)
  })

  const stream = createReadStream(demoPath)
  try {
    await parser.parse(stream)
  } finally {
    stream.destroy()
    await parser.dispose().catch(() => {})
  }

  const pulsesBySlot: Record<string, number[]> = {}
  for (const [slot, ticks] of pulses) pulsesBySlot[String(slot)] = ticks
  const slotByXuidOut: Record<string, number> = {}
  for (const [xuid, slot] of slotByXuid) slotByXuidOut[xuid] = slot

  return {
    voicePacketCount,
    malformedPacketCount,
    pulsesBySlot,
    slotByXuid: slotByXuidOut
  }
}

/**
 * 带磁盘缓存的语音索引提取（原 extractVoiceIndex API 保持不变）。
 * - 缓存路径：userData/voice-index/<demoId 或路径哈希>.json；
 * - 读取时校验 version、sizeBytes、mtimeMs，demo 变化自动失效并重建；
 * - 缓存损坏、旧版或字段异常均忽略，重新完整解析后原子覆盖。
 */
export async function extractVoiceIndexCached(
  demoPath: string,
  demoId?: string
): Promise<VoiceIndex> {
  const st = await fs.stat(demoPath).catch(() => null)
  if (!st || !st.isFile()) {
    // stat 失败时交给原提取逻辑给出准确错误，保持原有调用方行为
    return extractVoiceIndex(demoPath)
  }

  let cachePath: string
  try {
    cachePath = await voiceIndexCachePath(demoPath, demoId)
  } catch {
    // 非 Electron 环境（如诊断脚本）没有 userData 路径，直接走无缓存提取
    return extractVoiceIndex(demoPath)
  }
  const cached = await readVoiceIndexCache(cachePath, st.size, st.mtimeMs)
  if (cached) {
    // 读取缓存期间 demo 若被替换，按新指纹重新解析，避免 HUD 使用旧脉冲
    const current = await fs.stat(demoPath).catch(() => null)
    if (current && current.size === st.size && current.mtimeMs === st.mtimeMs) return cached
  }

  const index = await extractVoiceIndex(demoPath)

  // 解析期间 demo 被覆盖时，不写入旧指纹，避免下次误命中
  const after = await fs.stat(demoPath).catch(() => null)
  if (!after || after.size !== st.size || after.mtimeMs !== st.mtimeMs) return index

  const entry: VoiceIndexCacheEntry = {
    ...index,
    demoPath,
    mtimeMs: st.mtimeMs,
    sizeBytes: st.size,
    version: VOICE_INDEX_CACHE_VERSION
  }
  await writeVoiceIndexCache(cachePath, entry).catch(() => {
    // 缓存只是加速层：写入失败不阻断 HUD，下次播放重新提取
  })
  return index
}

/** 删除某个 demo 的语音索引缓存（demo 移出资料库时调用，避免 userData 长期堆积） */
export async function removeVoiceIndexCache(demoPath: string): Promise<void> {
  try {
    const cachePath = await voiceIndexCachePath(demoPath)
    await fs.unlink(cachePath).catch(() => {})
  } catch {
    // 非 Electron 环境或缓存目录不可用：没有可删除的缓存
  }
}

/**
 * 清理语音索引缓存中的孤儿条目：
 * - 旧版本缓存（无 demoPath 字段）无法反查来源，直接删除；
 * - demoPath 已不存在（demo 被删除/移走）的缓存删除；
 * - 读取失败或 JSON 损坏的文件也视为孤儿删除。
 * 只在资料库索引正常加载后调用，避免索引损坏时误删。
 */
export async function pruneVoiceIndexCache(): Promise<void> {
  let dir: string
  try {
    const electron = (await import('electron')) as typeof import('electron') & {
      default?: typeof import('electron')
    }
    const app = electron.app ?? electron.default?.app
    if (!app) return
    dir = join(app.getPath('userData'), 'voice-index')
  } catch {
    return
  }

  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const full = join(dir, file)
    let demoPath: string | null = null
    try {
      const raw = await fs.readFile(full, 'utf-8')
      const data = JSON.parse(raw) as Partial<VoiceIndexCacheEntry>
      if (data.version === VOICE_INDEX_CACHE_VERSION && typeof data.demoPath === 'string') {
        demoPath = data.demoPath
      }
    } catch {
      // 损坏/半截文件：按孤儿删除
    }
    if (!demoPath) {
      await fs.unlink(full).catch(() => {})
      continue
    }
    const st = await fs.stat(demoPath).catch(() => null)
    if (st && st.isFile()) continue
    // 父目录也不可访问时可能只是离线/盘符未挂载，保留缓存等待恢复
    const parent = await fs.stat(dirname(demoPath)).catch(() => null)
    if (!parent || !parent.isDirectory()) continue
    await fs.unlink(full).catch(() => {})
  }
}