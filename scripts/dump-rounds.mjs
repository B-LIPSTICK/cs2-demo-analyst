/**
 * 调试3：round_prestart 与炸弹事件按 tick 对齐 + roundResults 数组
 * 用法: node scripts/dump-rounds.mjs <demo.dem>
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const demo = process.argv[2]
const events = []
const descriptors = new Map()
const parser = new Parser(
  new ParserConfiguration({
    messagePacketTypes: [
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST,
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT,
      MessagePacketType.SVC_PACKET_ENTITIES
    ],
    entityClasses: ['CCSGameRulesProxy']
  })
)

parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST) {
    for (const d of mp.data.descriptors ?? []) descriptors.set(d.eventid, d)
  }
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT) {
    const d = descriptors.get(mp.data.eventid)
    if (!d) return
    if (['round_prestart', 'round_poststart', 'round_officially_ended', 'bomb_planted', 'bomb_defused', 'bomb_exploded', 'round_announce_warmup', 'begin_new_match', 'round_announce_match_start', 'round_announce_last_round_half', 'cs_win_panel_match', 'round_announce_match_point'].includes(d.name)) {
      events.push({ name: d.name, tick: dp.tick })
    }
  }
})

await parser.parse(createReadStream(demo))

console.log('=== event timeline ===')
for (const e of events) {
  console.log(`${String(e.tick).padStart(7)}  ${e.name}`)
}

const rules = parser.getDemo().getEntitiesByClassName('CCSGameRulesProxy')
for (const r of rules) {
  const results = []
  for (let i = 0; i < 32; i++) {
    const v = r.getField(`m_pGameRules.m_iMatchStats_RoundResults.${String(i).padStart(4, '0')}`)
    if (v === undefined) break
    results.push(v)
  }
  console.log('\nroundResults:', JSON.stringify(results))
}
await parser.dispose()
