/**
 * 调试：dump SVC_VOICE_DATA 原始消息结构与样本数据
 * 用法: node scripts/dump-voice.mjs <demo.dem> [--count N]
 */
import { Parser, ParserConfiguration, MessagePacketType, InterceptorStage } from '@deademx/cs2'
import { createReadStream } from 'node:fs'

const demo = process.argv[2]
const MAX = Number(process.argv[3] ?? 5)

const parser = new Parser(
  new ParserConfiguration({
    messagePacketTypes: [MessagePacketType.SVC_VOICE_DATA]
  })
)

let shown = 0
parser.registerPostInterceptor(InterceptorStage.MESSAGE_PACKET, async (dp, mp) => {
  if (mp.type !== MessagePacketType.SVC_VOICE_DATA || shown >= MAX) return
  shown++
  const d = mp.data
  const keys = Object.keys(d ?? {})
  console.log(`\n=== voice msg #${shown} tick=${dp.tick} ===`)
  console.log('keys:', keys.join(', '))
  for (const k of keys) {
    const v = d[k]
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
      const b = Buffer.from(v)
      console.log(`  ${k}: bytes=${b.length} head=${b.subarray(0, 40).toString('hex')}`)
      console.log(`  ${k}: ascii=${JSON.stringify(b.subarray(0, 40).toString('latin1'))}`)
    } else {
      console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 120)}`)
    }
  }
})

await parser.parse(createReadStream(demo))
await parser.dispose()
console.log(`\ntotal shown ${shown}`)
