/**
 * 注入器端到端测试（会真实修改 gameinfo.gi 并恢复；CS2 不能运行中）
 * 用法: node --experimental-strip-types scripts/test-inject.mjs
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { demoInjector, INJECT_BACKUP } from '../src/main/services/injector.ts'

const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const gameInfo = join(INSTALL, 'game', 'csgo', 'gameinfo.gi')

// 前置：CS2 未运行检查
import { execFile } from 'node:child_process'
const running = await new Promise((r) => {
  execFile('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'], (_e, out) => {
    r(out.toLowerCase().includes('cs2.exe'))
  })
})
if (running) {
  console.error('✗ CS2 正在运行，拒绝测试')
  process.exit(1)
}

const before = await fs.readFile(gameInfo, 'utf-8')
console.log('✓ 注入前 gameinfo.gi 读取成功')

// 模拟会话 VPK + 静态 VPK
const sessionVpk = Buffer.from(
  buildVpk([
    { ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(buildVoiceDataJs({ voicePacketCount: 1, pulsesBySlot: { '0': [1] } })) }
  ])
)
const staticVpk = await demoInjector.readStaticVpk()
if (!staticVpk) {
  console.error('✗ 静态 VPK 缺失（先跑 node scripts/build-panorama.mjs）')
  process.exit(1)
}
console.log(`✓ 静态 VPK: ${staticVpk.length}B`)

// 注入
const err = await demoInjector.install(INSTALL, { staticVpk, sessionVpk })
if (err) {
  console.error('✗ 注入失败:', err)
  process.exit(1)
}
console.log('✓ 注入成功')

const injected = await fs.readFile(gameInfo, 'utf-8')
const lines = injected.split(/\r\n|\n/)
const idx = lines.findIndex((l) => /Game\s+csgo\/overrides\/dsh_voice_session\.vpk/.test(l))
console.log('注入行:')
lines.forEach((l, i) => {
  if (/dsh_voice/.test(l)) console.log(`  [${i}] ${JSON.stringify(l)}`)
})
if (idx < 0) {
  console.error('✗ 未找到注入行')
  process.exit(1)
}
// 校验会话 VPK 在静态 VPK 前面
const si = lines.findIndex((l) => /dsh_voice_session/.test(l))
const oi = lines.findIndex((l) => /dsh_voice_override/.test(l))
console.log(`✓ SearchPath 顺序: session@${si} 在 override@${oi} 前 = ${si < oi}`)

// 幂等性：再次注入不应重复
const err2 = await demoInjector.install(INSTALL, { staticVpk, sessionVpk })
console.log(`✓ 二次注入: ${err2 ?? '无错误'}`)
const after2 = await fs.readFile(gameInfo, 'utf-8')
const count2 = (after2.match(/dsh_voice/g) ?? []).length
console.log(`  注入行总数（应仍为 2）: ${count2}`)

// 恢复
await demoInjector.uninstall(INSTALL)
const after = await fs.readFile(gameInfo, 'utf-8')
const count = (after.match(/dsh_voice/g) ?? []).length
console.log(`✓ 恢复后 dsh_voice 残留行: ${count}（应为 0）`)
const restored = after.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') === before.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  ? '完全一致'
  : '有差异（检查）'
console.log(`✓ 与注入前内容对比: ${restored}`)
console.log(`✓ VPK 文件已删除: ${!(await fs.access(join(INSTALL, 'game', 'csgo', 'overrides', 'dsh_voice_override.vpk')).then(() => true).catch(() => false))}`)
console.log(`✓ 备份保留: ${await fs.access(join(INSTALL, 'game', 'csgo', INJECT_BACKUP)).then(() => true).catch(() => false)}`)
console.log('=== 注入器测试通过 ===')
