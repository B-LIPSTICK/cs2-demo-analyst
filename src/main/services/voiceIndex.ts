/**
 * 语音说话者索引：解析 demo 的 SVC_VOICE_DATA 消息，得到
 * 「槽位(slot=entity-1) → 说话 tick 列表」脉冲数据（游戏内语音 HUD 用）。
 */
import { Parser, ParserConfiguration, InterceptorStage, MessagePacketType } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

export interface VoiceIndex {
  voicePacketCount: number
  malformedPacketCount: number
  /** slot(0-based, entity-1) → 说话 tick 列表（升序、相邻去重） */
  pulsesBySlot: Record<string, number[]>
  /** xuid → slot（说话者 SteamID 到槽位的映射，供 HUD 匹配） */
  slotByXuid: Record<string, number>
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
