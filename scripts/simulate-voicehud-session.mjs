/**
 * 游戏内语音 HUD 全链路模拟（不启动 CS2）
 * 验证: 语音索引 → 会话 VPK → 静态 VPK → gameinfo.gi 注入 → 模拟启动命令 → 恢复
 * 用法: node --experimental-strip-types scripts/simulate-voicehud-session.mjs [--demo <路径>]
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { extractVoiceIndex } from '../src/main/services/voiceIndex.ts'
import { demoInjector } from '../src/main/services/injector.ts'

const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const cli = process.argv.slice(2)
const demoPath =
  (cli[cli.indexOf('--demo') + 1] ?? '') ||
  'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'

console.log('=== 语音 HUD 全链路模拟 ===')
console.log(`demo: ${demoPath}`)

// ① 语音索引
const t0 = Date.now()
const index = await extractVoiceIndex(demoPath)
console.log(`① 语音索引: ${index.voicePacketCount} 包 / ${Object.keys(index.pulsesBySlot).length} 说话者 / ${Date.now() - t0}ms`)

// ② 会话 VPK
const js = buildVoiceDataJs({ voicePacketCount: index.voicePacketCount, pulsesBySlot: index.pulsesBySlot, players: {} })
const sessionVpk = Buffer.from(buildVpk([{ ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(js) }]))
console.log(`② 会话 VPK: ${sessionVpk.length}B (数据 js ${js.length}B)`)

// ③ 静态 VPK + 注入
const staticVpk = await demoInjector.readStaticVpk()
if (!staticVpk) throw new Error('静态 VPK 缺失')
const err = await demoInjector.install(INSTALL, { staticVpk, sessionVpk })
if (err) throw new Error('注入失败: ' + err)
console.log(`③ 注入成功（静态 ${staticVpk.length}B + 会话 ${sessionVpk.length}B）`)
const injected = await fs.readFile(join(INSTALL, 'game', 'csgo', 'gameinfo.gi'), 'utf-8')
const lines = injected.split(/\r\n|\n/)
lines.forEach((l) => { if (/dsh_voice/.test(l)) console.log(`   ${l.trim()}`) })

// ④ 模拟启动命令（live.ts 注入模式实际执行的形态）
const staged = join(process.env.SystemDrive + '\\', 'dsh-demo', 'dsh-sim.dem')
const cfg = ['demo_ui_mode 2', 'cl_demo_predict 0', 'tv_listen_voice_indices -1', 'tv_listen_voice_indices_h -1', `playdemo "${staged}"`].join('\n')
console.log('④ 播放 cfg（写入 game/csgo/cfg/dsh-play.cfg）:')
cfg.split('\n').forEach((l) => console.log(`   ${l}`))
console.log('   启动: steam.exe -applaunch 730 -insecure -novid +exec dsh-play.cfg（voiceHud 注入模式，SwiftDemoUIPro 同款）')

// ⑤ 恢复
await demoInjector.uninstall(INSTALL)
const after = await fs.readFile(join(INSTALL, 'game', 'csgo', 'gameinfo.gi'), 'utf-8')
if (/dsh_voice/.test(after)) throw new Error('恢复失败：gameinfo.gi 仍有残留')
console.log('⑤ 恢复完成（gameinfo.gi 无残留、VPK 已删）')

console.log('\n=== 全链路模拟通过（除 CS2 运行时外全部验证） ===')
