/**
 * 播放诊断：注入 → Steam 启动播放 demo → 全程采样 gameinfo 行/overrides/日志/进程
 * 用法: node --experimental-strip-types scripts/diag-play-hud.mjs
 * 期间请盯屏幕：CS2 是否启动、demo 是否播放、左下角是否有说话者胶囊、Steam 是否弹验证
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { extractVoiceIndex } from '../src/main/services/voiceIndex.ts'
import { demoInjector, STATIC_VPK, SESSION_VPK } from '../src/main/services/injector.ts'

const STEAM = 'D:\\11-Steam\\steam.exe'
const STEAM_ROOT = 'D:\\11-Steam'
const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const CSGO = join(INSTALL, 'game', 'csgo')
const BIN = join(INSTALL, 'game', 'bin', 'win64')
const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'
const WATCH_MS = 150000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isCs2Running = () =>
  new Promise((r) => execFile('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'], (_e, out) => r(out.toLowerCase().includes('cs2.exe'))))
const giLines = async () => {
  try {
    const t = await fs.readFile(join(CSGO, 'gameinfo.gi'), 'utf-8')
    return t.split(/\r\n|\n/).filter((l) => /dsh_voice/.test(l)).length
  } catch {
    return -1 // 文件缺失
  }
}
const overrides = async () => {
  const names = await fs.readdir(join(CSGO, 'overrides')).catch(() => [])
  return names.filter((n) => n.includes('dsh')).sort().join(',') || '(空)'
}
const logInfo = async () => {
  const out = []
  for (const p of [join(CSGO, 'dsh_hud.log'), join(BIN, 'dsh_hud.log')]) {
    try {
      const st = await fs.stat(p)
      out.push(`${p.includes('csgo') ? 'csgo' : 'bin'}=${st.size}B`)
    } catch { /* none */ }
  }
  return out.join(' ') || '无日志'
}
const steamBusy = async () => {
  try { await fs.access(join(STEAM_ROOT, 'steamapps', 'downloading', '730')); return true } catch { return false }
}

// ① 注入（会话 VPK 用真实语音索引）
if (await isCs2Running()) {
  console.log('✗ CS2 正在运行！请先完全退出 CS2（注入需写 overrides 目录）')
  process.exit(1)
}
await demoInjector.uninstall(INSTALL)
const staticVpk = Buffer.from(await fs.readFile(join(process.cwd(), 'assets', 'panorama', STATIC_VPK)))
console.log('提取语音索引…')
const index = await extractVoiceIndex(DEMO)
const js = buildVoiceDataJs({ voicePacketCount: index.voicePacketCount, pulsesBySlot: index.pulsesBySlot })
const sessionVpk = Buffer.from(buildVpk([{ ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(js) }]))
const err = await demoInjector.install(INSTALL, { staticVpk, sessionVpk })
if (err) throw new Error('注入失败: ' + err)
console.log(`✓ 注入完成: 静态 ${staticVpk.length}B + 会话 ${sessionVpk.length}B（${index.voicePacketCount} 语音包）`)

// ② 写播放 cfg
const staged = 'D:\\dsh-demo\\dsh-hud-verify.dem'
await fs.mkdir('D:\\dsh-demo', { recursive: true })
await fs.copyFile(DEMO, staged)
const cfgLines = ['demo_ui_mode 2', 'cl_demo_predict 0', 'tv_listen_voice_indices -1', 'tv_listen_voice_indices_h -1', `playdemo "${staged}"`]
await fs.writeFile(join(CSGO, 'cfg', 'dsh-play.cfg'), cfgLines.join('\n') + '\n', 'utf-8')
console.log('✓ cfg 已写（含 playdemo）')

// ③ Steam 启动
// ★参数顺序: +exec 必须放最后（-applaunch 透传时 +exec 之后的参数会被吞，SwiftDemoUIPro 同款）
//   -console: 游戏内按 ~ 打开控制台看 Panorama 错误
console.log(`Steam 启动: -applaunch 730 -insecure -novid -console -consolelog dsh_hud.log +exec dsh-play.cfg`)
const child = spawn(STEAM, ['-applaunch', '730', '-insecure', '-novid', '-console', '-consolelog', 'dsh_hud.log', '+exec', 'dsh-play.cfg'], {
  cwd: STEAM_ROOT, detached: false, stdio: 'ignore', windowsHide: false
})
child.on('error', (e) => console.log('spawn error:', e.message))
child.unref()

// ④ 采样监控
console.log('\n=== 监控开始（150s，每 10s 采样；请盯屏幕）===')
const t0 = Date.now()
let seenCs2 = false
let lastAlive = -1
while (Date.now() - t0 < WATCH_MS) {
  await sleep(10000)
  const el = Math.round((Date.now() - t0) / 1000)
  const alive = await isCs2Running()
  if (alive) { seenCs2 = true; lastAlive = el }
  const gi = await giLines()
  const ov = await overrides()
  const log = await logInfo()
  const busy = await steamBusy()
  console.log(`  [${el}s] cs2=${alive ? '运行' : '未运行'} 注入行=${gi === -1 ? '文件缺失!' : gi} overrides=${ov} ${log} steamBusy=${busy}`)
  if (!alive && seenCs2) {
    console.log(`  [${el}s] CS2 已退出（存活 ${lastAlive}s）`)
    break
  }
}

// ⑤ 报告 + 读日志
const aliveNow = await isCs2Running()
console.log(`\n=== 结果 ===`)
console.log(`CS2 状态: ${aliveNow ? '运行中' : '未运行'} | 曾出现: ${seenCs2} | 最长存活: ${lastAlive}s`)
for (const p of [join(CSGO, 'dsh_hud.log'), join(BIN, 'dsh_hud.log')]) {
  try {
    const buf = await fs.readFile(p)
    console.log(`\n--- ${p.replace(INSTALL, '…')} (${buf.length}B) ---`)
    const txt = buf.toString('utf8').replace(/\r/g, '')
    const lines = txt.split('\n')
    const dsh = lines.filter((l) => /DshVoice|Panorama|Error|error|Failed|failed|script/i.test(l))
    console.log(dsh.slice(-25).join('\n') || '(无 DshVoice/Panorama 行，显示最后 15 行)')
    if (!dsh.length) console.log(lines.slice(-15).join('\n'))
  } catch { /* none */ }
}

// ⑥ 询问结果（交互）
const { createInterface } = await import('node:readline')
const rl = createInterface({ input: process.stdin, output: process.stdout })
await new Promise((r) => rl.question('\n你刚才看到说话者 HUD 了吗？(y/n): ', (a) => { console.log(`用户回答: ${a}`); rl.close(); r() }))

// ⑦ 清理
if (!aliveNow) {
  await demoInjector.uninstall(INSTALL)
  console.log('✓ 已清理（VPK + 注入行恢复）')
} else {
  console.log('CS2 仍在运行，稍后退出后应用会自动清理')
}
