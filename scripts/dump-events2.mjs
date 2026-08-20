/**
 * 调试2：打印关键事件的字段名/样例值 + 实体类名 + string table
 * 用法: node scripts/dump-events2.mjs <demo.dem>
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage, StringTableType } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const demo = process.argv[2]
const INTEREST = new Set([
  'round_prestart', 'round_poststart', 'round_freeze_end', 'round_officially_ended',
  'player_death', 'player_team', 'cs_win_panel_match', 'bomb_planted', 'bomb_defused', 'bomb_exploded',
  'round_mvp', 'begin_new_match', 'round_announce_match_start', 'round_announce_warmup'
])
const samples = new Map() // name -> {keys: string[], first: object}
const descriptors = new Map()
const classesSeen = new Set()

const parser = new Parser(
  new ParserConfiguration({
    messagePacketTypes: [
      MessagePacketType.SVC_SERVER_INFO,
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST,
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT,
      MessagePacketType.SVC_CREATE_STRING_TABLE,
      MessagePacketType.SVC_UPDATE_STRING_TABLE,
      MessagePacketType.SVC_PACKET_ENTITIES
    ],
    entityClasses: ['CCSPlayerController', 'CSTeam', 'CCSGameRulesProxy', 'CCSTeam']
  })
)

const zip = (desc, keys) => {
  const out = {}
  for (let i = 0; i < desc.keys.length; i++) out[desc.keys[i].name] = keys[i]?.valString ?? keys[i]?.valLong ?? keys[i]?.valShort ?? keys[i]?.valByte ?? keys[i]?.valFloat ?? keys[i]?.valBool ?? keys[i]?.valUint64 ?? null
  return out
}

parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST) {
    for (const d of mp.data.descriptors ?? []) descriptors.set(d.eventid, d)
  }
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT) {
    const d = descriptors.get(mp.data.eventid)
    if (!d) return
    if (INTEREST.has(d.name) && !samples.has(d.name)) {
      samples.set(d.name, {
        keys: d.keys.map((k) => k.name),
        first: zip(d, mp.data.keys)
      })
    }
  }
  if (mp.type === MessagePacketType.SVC_PACKET_ENTITIES) {
    // 不在此处理
  }
})

await parser.parse(createReadStream(demo))

console.log('=== event fields ===')
for (const [name, s] of samples) {
  console.log(`\n[${name}]`)
  console.log('  keys:', s.keys.join(', '))
  console.log('  first:', JSON.stringify(s.first))
}
console.log('\n=== entity classes (Team/Rules) ===')
const demoState = parser.getDemo()
const classes = demoState.getClasses()
for (const c of classes) {
  if (/team|rules/i.test(c.name)) console.log(`  ${c.name}`)
}

console.log('\n=== string tables ===')
for (const t of demoState.stringTableContainer.getTables()) {
  console.log(`  ${t.name} (${t.getEntriesCount()})`)
}

try {
  const teams = demoState.getEntitiesByClassName('CCSTeam')
  console.log('\nCCSTeam entities:', teams.length)
  for (const t of teams) {
    console.log(`  teamNum=${t.getField('m_iTeamNum')} name=${JSON.stringify(t.getField('m_szTeamname'))} score=${t.getField('m_iScore')} half1=${t.getField('m_scoreFirstHalf')} half2=${t.getField('m_scoreSecondHalf')}`)
  }
  const rules = demoState.getEntitiesByClassName('CCSGameRulesProxy')
  console.log('CCSGameRulesProxy entities:', rules.length)
  for (const r of rules.slice(0, 2)) {
    console.log('  rules fields:', [...r.fieldNames()].filter((f) => /score|team|phase|round/i.test(f)).slice(0, 25).join(', '))
    const results = []
    for (let i = 0; i < 32; i++) {
      const v = r.getField(`m_pGameRules.m_iMatchStats_RoundResults.${String(i).padStart(4, '0')}`)
      if (v === undefined) break
      results.push(v)
    }
    console.log('  roundResults:', JSON.stringify(results))
    console.log('  roundWinStatus:', r.getField('m_pGameRules.m_iRoundWinStatus'), 'roundWinReason:', r.getField('m_pGameRules.m_eRoundWinReason'))
  }
} catch (e) {
  console.log('CCSTeam error:', e.message)
}
await parser.dispose()
