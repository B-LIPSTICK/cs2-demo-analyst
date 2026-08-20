/**
 * 调试：dump demo 中出现的所有游戏事件名/计数、服务端信息字段、string table 名
 * 用法: node scripts/dump-events.mjs <demo.dem>
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const demo = process.argv[2]
const events = new Map()
const serverInfoKeys = new Set()
let serverInfo = null

const parser = new Parser(
  new ParserConfiguration({
    messagePacketTypes: [
      MessagePacketType.SVC_SERVER_INFO,
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST,
      MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT,
      MessagePacketType.SVC_CREATE_STRING_TABLE,
      MessagePacketType.SVC_UPDATE_STRING_TABLE
    ]
  })
)

const descriptors = new Map()

parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (mp.type === MessagePacketType.SVC_SERVER_INFO) {
    serverInfo = mp.data
    for (const k of Object.keys(mp.data ?? {})) serverInfoKeys.add(k)
  }
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST) {
    for (const d of mp.data.descriptors ?? []) descriptors.set(d.eventid, d)
  }
  if (mp.type === MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT) {
    const d = descriptors.get(mp.data.eventid)
    const name = d?.name ?? `id${mp.data.eventid}`
    events.set(name, (events.get(name) ?? 0) + 1)
  }
})

await parser.parse(createReadStream(demo))
await parser.dispose()

console.log('=== game events ===')
for (const [name, count] of [...events.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(6)}  ${name}`)
}
console.log('\n=== serverInfo keys ===')
console.log([...serverInfoKeys].join(', '))
if (serverInfo) {
  console.log('mapname =', JSON.stringify(serverInfo.mapname))
  console.log('map_name =', JSON.stringify(serverInfo.map_name))
  console.log('full sample:', JSON.stringify(serverInfo).slice(0, 300))
}
