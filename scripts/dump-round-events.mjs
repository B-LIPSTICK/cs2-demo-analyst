/**
 * 调试：dump demo 开头的回合相关事件时间线
 * 用法: node --experimental-strip-types scripts/dump-round-events.mjs <demo路径> [前N秒]
 * 输出: round_prestart / begin_new_match / round_announce_match_start / round_officially_ended /
 *       player_death / bomb_* 的时间（秒，64tick）
 */
import { createReadStream } from 'node:fs'
import { PassThrough } from 'node:stream'
import { InterceptorStage, MessagePacketType, Parser } from '@deademx/cs2'

const [, , demoPath, maxSecArg] = process.argv
if (!demoPath) {
  console.error('用法: node scripts/dump-round-events.mjs <demo路径> [前N秒]')
  process.exit(1)
}
const maxSec = maxSecArg ? Number(maxSecArg) : 180
const TICK = 64

const parser = new Parser()
const descriptors = new Map()
const WANT = new Set([
  'round_prestart',
  'round_start',
  'begin_new_match',
  'round_announce_match_start',
  'round_announce_begin',
  'round_announce_last_round_half',
  'round_announce_final',
  'round_officially_ended',
  'round_end',
  'player_death',
  'bomb_planted',
  'bomb_defused',
  'bomb_exploded',
  'cs_win_panel_match',
  'match_end',
  'match_start'
])

parser.registerPostInterceptor(
  InterceptorStage.MESSAGE_PACKET,
  async (_demoPacket, messagePacket) => {
    if (!messagePacket) return
    const tick = _demoPacket.tick
    const sec = tick / TICK
    if (sec > maxSec) return
    switch (messagePacket.type) {
      case MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST: {
        const data = messagePacket.data
        for (const d of data?.descriptors ?? []) descriptors.set(d.eventid, d)
        break
      }
      case MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT: {
        const data = messagePacket.data
        const desc = descriptors.get(data?.eventid)
        const name = desc?.name ?? `ev#${data?.eventid}`
        if (WANT.has(name)) {
          console.log(`[${sec.toFixed(1)}s tick=${tick}] ${name}`)
        }
        break
      }
      default:
        break
    }
  }
)

const stream = createReadStream(demoPath)
const counter = new PassThrough()
stream.pipe(counter)

try {
  await parser.parse(counter)
} catch (err) {
  console.error('parse error:', err.message)
}
console.log('--- done (maxSec=' + maxSec + ') ---')
