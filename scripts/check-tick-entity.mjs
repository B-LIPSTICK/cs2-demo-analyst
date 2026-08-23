/**
 * 决定性: 击杀 tick 时刻的实体 idx→名字，与击杀 uid 比对
 * 击杀事件在 MESSAGE_PACKET 拦截（tick N），实体采样在 DEMO_PACKET（tick N）——同一 tick
 * 若 uid=5 击杀对应实体 idx=5 名字一致 → uid=实体idx（无偏移）
 */
import { Parser, ParserConfiguration, InterceptorStage, MessagePacketType } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'

const parser = new Parser(new ParserConfiguration({
  messagePacketTypes: [
    MessagePacketType.SVC_PACKET_ENTITIES,
    MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST,
    MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT
  ],
  entityClasses: ['CCSPlayerController']
}))
const stream = createReadStream(DEMO)

const valueOf = (key) => {
  if (!key) return null
  switch (key.type) {
    case 1: return key.valString
    case 2: return key.valFloat
    case 3: return key.valLong
    case 4: return key.valShort
    case 5: return key.valByte
    case 6: return key.valBool
    case 7: return key.valUint64
    case 8: return key.valLong
    case 9: return key.valShort
    default: return null
  }
}

let desc = null
let kills = []
const idxTeamSnap = new Map()

parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET, async (dp) => {
  if (dp.getIsInitial()) return
  // 每 tick 采样（密集，验证用）
  const players = parser.getDemo().getEntitiesByClassName('CCSPlayerController')
  idxTeamSnap.clear()
  for (const p of players) {
    const name = String(p.getField('m_iszPlayerName') || '')
    if (!name || ['SourceTV', 'GOTV', '5EGOTV', '完美世界竞技平台CSTV'].includes(name)) continue
    idxTeamSnap.set(p._index, { name, team: Number(p.getField('m_iTeamNum')) })
  }
})

parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (!mp) return
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST) {
    desc = mp.data.descriptors
    return
  }
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT && desc) {
    const d = desc.find((x) => x.eventid === mp.data.eventid)
    if (!d || d.name !== 'player_death') return
    const ev = {}
    mp.data.keys.forEach((k, i) => { ev[d.keys[i]?.name || i] = valueOf(k) })
    const v = idxTeamSnap.get(ev.userid)
    const a = idxTeamSnap.get(ev.attacker)
    kills.push({
      tick: dp.tick,
      uid: ev.userid, vName: v?.name, vTeam: v?.team,
      attacker: ev.attacker, aName: a?.name, aTeam: a?.team,
      weapon: ev.weapon
    })
  }
})

await parser.parse(stream)
stream.destroy()
await parser.dispose().catch(() => {})

console.log('前 30 条击杀（uid→同tick实体idx）:')
for (const k of kills.slice(0, 30)) {
  const vT = k.vTeam === 2 ? 'T' : k.vTeam === 3 ? 'CT' : '?'
  const aT = k.aTeam === 2 ? 'T' : k.aTeam === 3 ? 'CT' : '?'
  console.log(`  @${Math.round(k.tick / 64)}s uid=${k.uid}(${k.vName}/${vT}) ← atk=${k.attacker}(${k.aName}/${aT}) [${k.weapon}]`)
}
