/**
 * 全自动诊断：完整应用播放流程（准备→启动→监控→日志→自动清理）
 * 一条命令跑完，消除手动操作乱序。
 *
 * 用法: node --experimental-strip-types scripts/diag-run-full.mjs
 */
import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { extractVoiceIndex } from '../src/main/services/voiceIndex.ts'
import { demoInjector } from '../src/main/services/injector.ts'

const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'
const STAGED = 'D:\\dsh-demo\\diag-play.dem'
const EXE = join(INSTALL, 'game', 'bin', 'win64', 'cs2.exe')
const CSGO = join(INSTALL, 'game', 'csgo')

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const isCs2Running = () =>
  new Promise((r) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'], (_e, out) => r(out.toLowerCase().includes('cs2.exe')))
  })

// 前置：CS2 不能运行
if (await isCs2Running()) {
  console.log('✗ CS2 正在运行，请先关闭再跑本脚本')
  process.exit(1)
}

// ① 暂存 demo（校验）
await fs.mkdir('D:\\dsh-demo', { recursive: true })
await fs.copyFile(DEMO, STAGED)
console.log('① demo 暂存:', STAGED)

// ② 语音索引 + 注入
const minimal = process.argv.includes('--minimal')
const index = await extractVoiceIndex(DEMO)
console.log('② 语音索引:', index.voicePacketCount, '包')
const js = buildVoiceDataJs({ voicePacketCount: index.voicePacketCount, pulsesBySlot: index.pulsesBySlot, players: {} })
const sessionVpk = Buffer.from(buildVpk([{ ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(js) }]))
let staticVpk
if (minimal) {
  // 最小模式：静态 VPK 只含占位数据文件（无布局/逻辑 JS）——定位是机制还是内容问题
  staticVpk = Buffer.from(
    buildVpk([
      { ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource('"use strict";var DshVoiceData={schemaVersion:1,generated:false,holdTicks:30,voicePacketCount:0,pulsesBySlot:{},players:{}};') }
    ])
  )
} else {
  staticVpk = await demoInjector.readStaticVpk()
  if (!staticVpk) throw new Error('静态 VPK 缺失')
}
const err = await demoInjector.install(INSTALL, { staticVpk, sessionVpk })
if (err) throw new Error('注入失败: ' + err)
console.log('③ 注入完成' + (minimal ? '（最小模式：静态 VPK 仅占位数据）' : ''))

// ③b 播放 cfg（与应用完全一致）
const cfg = ['demo_ui_mode 2', 'cl_demo_predict 0', 'tv_listen_voice_indices -1', 'tv_listen_voice_indices_h -1', `playdemo "${STAGED}"`].join('\n') + '\n'
await fs.writeFile(join(CSGO, 'cfg', 'dsh-play.cfg'), cfg, 'utf-8')
console.log('④ 播放 cfg 已写')

// ④ 启动（cwd 可开关: --cwd-exe 用 game/bin/win64（应用同款），默认项目根（手动同款））
const LOG_PATH = join(CSGO, 'dsh_hud.log')
const useInsecure = process.argv.includes('--insecure')
const cwdExe = process.argv.includes('--cwd-exe')
const args = useInsecure
  ? ['+exec', 'dsh-play.cfg', '-insecure', '-novid', '-consolelog', 'dsh_hud.log']
  : ['+exec', 'dsh-play.cfg', '-novid', '-consolelog', 'dsh_hud.log']
console.log('⑤ 启动 CS2:', args.join(' '), '| cwd =', cwdExe ? dirname(EXE) : process.cwd())
const child = spawn(EXE, args, { cwd: cwdExe ? dirname(EXE) : process.cwd(), detached: false, stdio: 'inherit', windowsHide: false })
child.on('error', (e) => console.log('✗ spawn 错误:', e.message))
child.on('exit', (code, signal) => console.log(`✗ CS2 进程退出: code=${code} signal=${signal}`))
child.unref()

// ⑤ 监控 90s（WMI 抓 cs2.exe 详细状态：参数/窗口/进程数）
const t0 = Date.now()
const psDetails = () =>
  new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='cs2.exe'\" | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress"
      ],
      { windowsHide: true, timeout: 10000 },
      (_e, stdout) => {
        try {
          const d = JSON.parse(stdout)
          resolve(Array.isArray(d) ? d : d ? [d] : [])
        } catch {
          resolve([])
        }
      }
    )
  })
const mainTitle = (pid) =>
  new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`],
      { windowsHide: true, timeout: 8000 },
      (_e, out) => resolve(out.trim())
    )
  })

let lastLogLen = 0
while (Date.now() - t0 < 90000) {
  await new Promise((r) => setTimeout(r, 5000))
  const procs = await psDetails()
  const sec = Math.round((Date.now() - t0) / 1000)
  for (const p of procs) {
    console.log(`  [${sec}s] PID=${p.ProcessId} 父=${p.ParentProcessId} 窗口="${await mainTitle(p.ProcessId)}"`)
    console.log(`        参数: ${String(p.CommandLine ?? '').slice(0, 200)}`)
  }
  if (procs.length === 0) console.log(`  [${sec}s] 无 cs2.exe 进程`)
  try {
    const st = await fs.stat(LOG_PATH)
    if (st.size !== lastLogLen) {
      lastLogLen = st.size
      console.log(`  [${sec}s] 日志 ${st.size}B`)
      const text = await fs.readFile(LOG_PATH, 'utf-8')
      text.split('\n').filter((l) => /dsh-play|playdemo|couldn|panic|FATAL|assert/i.test(l)).slice(-6).forEach((l) => console.log('    |', l.trim()))
    }
  } catch { /* 无日志 */ }
  if (procs.length === 0 && Date.now() - t0 > 30000) break
}
const aliveNow = await isCs2Running()
console.log('⑥ CS2 当前:', aliveNow ? '运行中' : '已退出')

// ⑦ 日志关键行汇总
try {
  const text = await fs.readFile(LOG_PATH, 'utf-8')
  const lines = text.split('\n')
  console.log(`⑦ 日志共 ${lines.length} 行; demo/exec/崩溃相关:`)
  lines.filter((l) => /dsh-play|playdemo|demo_ui|exec:|couldn|panic|crash|assert|ERROR/i.test(l)).slice(-15).forEach((l) => console.log('   |', l.trim()))
} catch {
  console.log('⑦ dsh_hud.log 未生成！')
}

// ⑧ 清理（CS2 退出后）
if (!aliveNow) {
  await demoInjector.uninstall(INSTALL)
  await fs.unlink(join(CSGO, 'cfg', 'dsh-play.cfg')).catch(() => {})
  console.log('⑧ 已自动清理（恢复 gameinfo + 删 VPK/cfg）')
} else {
  console.log('⑧ CS2 仍在运行，请手动关闭后清理: node --experimental-strip-types scripts/diag-inject-launch.mjs cleanup')
}
