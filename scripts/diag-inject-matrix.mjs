/**
 * 注入启动失败 · 全自动变量矩阵 v2（Steam -applaunch，单 VPK 分离 + Steam 空闲门控）
 *
 * 模式 A: 基线（无注入）                       → Steam 启动方式本身
 * 模式 B: 仅 gameinfo 注入行（无 VPK）          → 行格式/解析
 * 模式 C: 行 + 仅参考 VPK(SwiftDemoUIPro 生产版) → 参考 VPK 加载
 * 模式 D: 行 + 仅手写 static VPK                → 手写 static 产物
 * 模式 E: 行 + 仅手写 session VPK               → 手写 session 产物
 * 模式 F: 行 + 参考 VPK + 手写 session VPK      → 复现 v1 的 C（组合崩溃?）
 *
 * v2 改进:
 *  - 每模式前 waitSteamIdle(): gameinfo.gi 存在 + downloading/730 消失 + 稳定 30s
 *  - CS2 退出/崩溃后立即读 consolelog（kill 之前）
 *  - 单 VPK 部署（绕过 install 的双 VPK 约束）
 *  - 模式 C/D 不解析 demo（省时），E/F 才 extractVoiceIndex
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { extractVoiceIndex } from '../src/main/services/voiceIndex.ts'
import { demoInjector, STATIC_VPK, SESSION_VPK } from '../src/main/services/injector.ts'

const STEAM = 'D:\\11-Steam\\steam.exe'
const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const STEAM_ROOT = 'D:\\11-Steam'
const CSGO = join(INSTALL, 'game', 'csgo')
const BIN = join(INSTALL, 'game', 'bin', 'win64')
const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'
const REF_VPK = join(process.cwd(), 'scripts', 'swift-ref.vpk')
const OUR_VPK = join(process.cwd(), 'assets', 'panorama', STATIC_VPK)
const WATCH_MS = 120000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isCs2Running = () =>
  new Promise((r) => execFile('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'], (_e, out) => r(out.toLowerCase().includes('cs2.exe'))))
const killCs2 = async () => {
  execFile('taskkill', ['/IM', 'cs2.exe', '/F'], () => {})
  for (let i = 0; i < 30; i++) {
    if (!(await isCs2Running())) return
    await sleep(500)
  }
}
const listDumps = async () => {
  const m = await fs.readdir(BIN).catch(() => [])
  return m.filter((f) => f.endsWith('.mdmp')).sort()
}
const steamBusy = async () => {
  try {
    await fs.access(join(STEAM_ROOT, 'steamapps', 'downloading', '730'))
    return true
  } catch {
    return false
  }
}
const giMissing = async () => {
  try {
    await fs.access(join(CSGO, 'gameinfo.gi'))
    return false
  } catch {
    return true
  }
}
/** 等 Steam 空闲：gameinfo.gi 存在 + 无 downloading/730 + 连续 30s 稳定 */
async function waitSteamIdle(label) {
  console.log(`  等待 Steam 空闲（${label}）……`)
  for (let i = 0; i < 60; i++) {
    if (!(await giMissing()) && !(await steamBusy()) && !(await isCs2Running())) {
      // 稳定观察 30s
      let stable = true
      for (let j = 0; j < 6; j++) {
        await sleep(5000)
        if ((await giMissing()) || (await steamBusy()) || (await isCs2Running())) {
          stable = false
          break
        }
      }
      if (stable) {
        console.log(`  ✓ Steam 空闲（等 ${(i * 5 + 30) / 60}min 内稳定）`)
        return
      }
    }
    await sleep(5000)
  }
  console.log('  ✗ 等待超时（Steam 持续忙碌/验证中），继续尝试……')
}
const consoleLog = async () => {
  for (const p of [join(BIN, 'dsh_hud.log'), join(CSGO, 'dsh_hud.log')]) {
    try {
      const s = await fs.stat(p)
      if (s.size > 0) {
        const buf = await fs.readFile(p)
        return { path: p, tail: buf.subarray(Math.max(0, buf.length - 2500)).toString('utf8').replace(/\r/g, '') }
      }
    } catch { /* next */ }
  }
  return null
}

// ---- gameinfo 行注入（不写 VPK）----
async function injectLinesOnly() {
  const gi = join(CSGO, 'gameinfo.gi')
  const buf = await fs.readFile(gi)
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const text = (bom ? buf.subarray(3) : buf).toString('utf8')
  if (/dsh_voice/.test(text)) return
  const lines = text.split(/\r\n|\n/)
  let idx = -1
  let indent = '\t\t\t'
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)Game\s+csgo\s*(?:\/\/.*)?$/i.exec(lines[i])
    if (m) {
      indent = m[1]
      idx = i
      break
    }
  }
  if (idx < 0) throw new Error('gameinfo.gi 找不到 Game csgo 行')
  lines.splice(idx, 0, indent + `Game\tcsgo/overrides/${SESSION_VPK}`, indent + `Game\tcsgo/overrides/${STATIC_VPK}`)
  await fs.writeFile(gi, (bom ? '\ufeff' : '') + lines.join('\n'), 'utf8')
}

/** 注入行 + 写指定 VPK 列表（覆盖 install 的双 VPK 约束） */
async function deployExact(vpks) {
  await demoInjector.uninstall(INSTALL)
  await injectLinesOnly()
  const ov = join(CSGO, 'overrides')
  await fs.mkdir(ov, { recursive: true })
  for (const [name, data] of vpks) {
    const tmp = join(ov, name + '.tmp')
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, join(ov, name))
  }
}

// ---- 部署一个模式 ----
async function deploy(mode) {
  await demoInjector.uninstall(INSTALL)
  if (mode === 'A') return
  if (mode === 'B') {
    await injectLinesOnly()
    return
  }
  if (mode === 'C') {
    await deployExact([[STATIC_VPK, Buffer.from(await fs.readFile(REF_VPK))]])
    return
  }
  if (mode === 'D') {
    await deployExact([[STATIC_VPK, Buffer.from(await fs.readFile(OUR_VPK))]])
    return
  }
  // E / F 需要 session VPK
  const index = await extractVoiceIndex(DEMO)
  const js = buildVoiceDataJs({ voicePacketCount: index.voicePacketCount, pulsesBySlot: index.pulsesBySlot })
  const sessionVpk = Buffer.from(buildVpk([{ ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(js) }]))
  if (mode === 'E') {
    await deployExact([[SESSION_VPK, sessionVpk]])
    return
  }
  // F: 参考 + session
  await deployExact([
    [STATIC_VPK, Buffer.from(await fs.readFile(REF_VPK))],
    [SESSION_VPK, sessionVpk]
  ])
}

// ---- 跑一个模式 ----
async function runMode(mode) {
  console.log(`\n===== 模式 ${mode} =====`)
  await waitSteamIdle('deploy 前')
  await deploy(mode)
  await waitSteamIdle('deploy 后')
  await killCs2()
  const dumpsBefore = await listDumps()
  await fs.unlink(join(BIN, 'dsh_hud.log')).catch(() => {})
  await fs.unlink(join(CSGO, 'dsh_hud.log')).catch(() => {})

  const args = ['-applaunch', '730', '-insecure', '-novid', '-consolelog', 'dsh_hud.log']
  console.log(`  steam.exe ${args.join(' ')}`)
  const child = spawn(STEAM, args, { cwd: process.cwd(), stdio: 'ignore', detached: false })
  child.on('error', (e) => console.log('  spawn error:', e.message))
  child.unref()

  let firstSeen = -1
  let lastAlive = -1
  const t0 = Date.now()
  while (Date.now() - t0 < WATCH_MS) {
    await sleep(2000)
    const alive = await isCs2Running()
    const el = Math.round((Date.now() - t0) / 1000)
    if (alive) {
      if (firstSeen < 0) firstSeen = el
      lastAlive = el
      if (el % 10 === 0) console.log(`    [${el}s] cs2 存活中`)
    } else if (firstSeen >= 0 && lastAlive === el - 2) {
      console.log(`    [${el}s] cs2 已退出!`)
      break
    }
  }

  // 崩溃后立即读日志（kill 之前）
  const log = await consoleLog()
  const dumpsAfter = await listDumps()
  const newDumps = dumpsAfter.filter((f) => !dumpsBefore.includes(f))
  const survived = firstSeen >= 0 && lastAlive - firstSeen >= 50
  let verdict
  if (survived && newDumps.length === 0) verdict = 'SUCCESS'
  else if (firstSeen >= 0) verdict = 'CRASH'
  else verdict = 'NOLAUNCH'
  console.log(`  → 首次出现 ${firstSeen < 0 ? '无' : firstSeen + 's'} | 最后存活 ${lastAlive < 0 ? '无' : lastAlive + 's'} | 新 minidump: ${newDumps.length}`)
  if (newDumps.length) console.log('  minidump:', newDumps)
  if (log) console.log(`  consolelog(${log.path.replace(INSTALL, '…')}):\n${'-'.repeat(20)}\n${log.tail}\n${'-'.repeat(20)}`)
  else console.log('  (无 consolelog 内容)')

  await killCs2()
  await demoInjector.uninstall(INSTALL)
  return { mode, verdict, firstSeen, lastAlive, newDumps: newDumps.length }
}

// ---- 主流程 ----
if (await isCs2Running()) {
  console.log('✗ CS2 正在运行，请先关闭再跑矩阵')
  process.exit(1)
}
console.log('矩阵 v2 开始（单 VPK 分离 + Steam 空闲门控，约 15-20 分钟）……')
const results = []
for (const mode of ['A', 'B', 'C', 'D', 'E', 'F']) {
  results.push(await runMode(mode))
  await sleep(5000)
}
console.log('\n===== 汇总 =====')
for (const r of results) console.log(`  模式 ${r.mode}: ${r.verdict} (出现 ${r.firstSeen < 0 ? '-' : r.firstSeen + 's'}, 存活 ${r.lastAlive < 0 ? '-' : r.lastAlive + 's'}, mdmp ${r.newDumps})`)
console.log('\n对照结论:')
console.log('  A/B 失败 → 启动方式/注入行问题')
console.log('  C 失败 → 参考 VPK 加载崩溃（与手写产物无关，需查 Swift 的 VPK 与 CS2 版本兼容）')
console.log('  D 失败 → 手写 static VPK 产物问题')
console.log('  E 失败 → 手写 session VPK 产物问题')
console.log('  C 成功 D 成功 E 失败 → 组合/顺序问题（F 验证）')
console.log('  C/D/E 全成功 → 注入机制 OK，之前失败是 Steam 验证时序干扰')
