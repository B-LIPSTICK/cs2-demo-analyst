/**
 * dump SVC_VOICE_DATA 完整字段（含 sequenceBytes 等）
 * 用法: node scripts/dump-voice-full.mjs <demo.dem> [count]
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const demo = process.argv[2]
const MAX = Number(process.argv[3] ?? 5)

const parser = new Parser(
  new ParserConfiguration({ messagePacketTypes: [MessagePacketType.SVC_VOICE_DATA] })
)

let shown = 0
parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (mp.type !== MessagePacketType.SVC_VOICE_DATA || shown >= MAX) return
  shown++
  const d = mp.data
  console.log(`\n=== voice msg #${shown} tick=${dp.tick} ===`)
  for (const [k, v] of Object.entries(d ?? {})) {
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      const b = Buffer.from(v)
      console.log(`  ${k}: bytes=${b.length} hex=${b.subarray(0, 60).toString('hex')}`)
    } else if (typeof v === 'object' && v !== null) {
      const s = JSON.stringify(v)
      console.log(`  ${k}: ${s.slice(0, 400)}`)
    } else {
      console.log(`  ${k}: ${JSON.stringify(v)}`)
    }
  }
})

await parser.parse(createReadStream(demo))
await parser.dispose()
console.log(`\ntotal shown ${shown}`)
