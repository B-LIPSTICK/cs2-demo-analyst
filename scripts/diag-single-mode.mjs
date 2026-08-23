/**
 * 单模式快速验证（Steam 稳定后跑）：只跑指定模式，缩短 Steam 干扰窗口
 * 用法: node --experimental-strip-types scripts/diag-single-mode.mjs [D|E|F]
 * 默认 D（手写静态 VPK，最关键）
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from '../src/main/services/vpk.ts'
import { extractVoiceIndex } from '../src/main/services/voiceIndex.ts'
import { demoInjector, STATIC_VPK, SESSION_VPK } from '../src/main/services/injector.ts'

const MODE = (process.argv[2] || 'D').toUpperCase()
const STEAM = 'D:\\11-Steam\\steam.exe'
const STEAM_ROOT = 'D:\\11-Steam'
const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const CSGO = join(INSTALL, 'game', 'csgo')
const BIN = join(INSTALL, 'game', 'bin', 'win64')
const DEMO = 'C:\\Users\\LIPSTICK\\AppData\\Roaming\\CS2 Demo Analyst\\cache\\zips\\ab2740f46d7b6bb6\\9215247295256571660_0.dem'
const REF_VPK = join(process.cwd(), 'scripts', 'swift-ref.vpk')
const OUR_VPK = join(process.cwd(), 'assets', 'panorama', STATIC_VPK)
const WATCH_MS = 90000

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
const listDumps = async () => (await fs.readdir(BIN).catch(() => [])).filter((f) => f.endsWith('.mdmp')).sort()
const steamBusy = async () => {
  try { await fs.access(join(STEAM_ROOT, 'steamapps', 'downloading', '730')); return true } catch { return false }
}
const giMissing = async () => {
  try { await fs.access(join(CSGO, 'gameinfo.gi')); return false } catch { return true }
}

async function waitSteamIdle(label) {
  console.log(`  等待 Steam 空闲（${label}）……`)
  for (let i = 0; i < 90; i++) {
    if (!(await giMissing()) && !(await steamBusy()) && !(await isCs2Running())) {
      let stable = true
      for (let j = 0; j < 6; j++) {
        await sleep(5000)
        if ((await giMissing()) || (await steamBusy()) || (await isCs2Running())) { stable = false; break }
      }
      if (stable) { console.log('  ✓ Steam 空闲'); return }
    }
    await sleep(5000)
  }
  console.log('  ✗ Steam 持续忙碌，继续尝试……')
}

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
    if (m) { indent = m[1]; idx = i; break }
  }
  if (idx < 0) throw new Error('找不到 Game csgo 行')
  lines.splice(idx, 0, indent + `Game\tcsgo/overrides/${SESSION_VPK}`, indent + `Game\tcsgo/overrides/${STATIC_VPK}`)
  await fs.writeFile(gi, (bom ? '\ufeff' : '') + lines.join('\n'), 'utf8')
}

async function deploy(mode) {
  await demoInjector.uninstall(INSTALL)
  if (mode === 'D') {
    await injectLinesOnly()
    const ov = join(CSGO, 'overrides')
    await fs.mkdir(ov, { recursive: true })
    const tmp = join(ov, STATIC_VPK + '.tmp')
    await fs.writeFile(tmp, Buffer.from(await fs.readFile(OUR_VPK)))
    await fs.rename(tmp, join(ov, STATIC_VPK))
    return
  }
  if (mode === 'C') {
    await injectLinesOnly()
    const ov = join(CSGO, 'overrides')
    await fs.mkdir(ov, { recursive: true })
    const tmp = join(ov, STATIC_VPK + '.tmp')
    await fs.writeFile(tmp, Buffer.from(await fs.readFile(REF_VPK)))
    await fs.rename(tmp, join(ov, STATIC_VPK))
    return
  }
  // E: 仅 session
  const index = await extractVoiceIndex(DEMO)
  const js = buildVoiceDataJs({ voicePacketCount: index.voicePacketCount, pulsesBySlot: index.pulsesBySlot })
  const sessionVpk = Buffer.from(buildVpk([{ ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: buildVjsResource(js) }]))
  await injectLinesOnly()
  const ov = join(CSGO, 'overrides')
  await fs.mkdir(ov, { recursive: true })
  const tmp = join(ov, SESSION_VPK + '.tmp')
  await fs.writeFile(tmp, sessionVpk)
  await fs.rename(tmp, join(ov, SESSION_VPK))
}

const consoleLog = async () => {
  for (const p of [join(BIN, 'dsh_hud.log'), join(CSGO, 'dsh_hud.log')]) {
    try {
      const s = await fs.stat(p)
      if (s.size > 0) {
        const buf = await fs.readFile(p)
        return { path: p, tail: buf.subarray(Math.max(0, buf.length - 2000)).toString('utf8').replace(/\r/g, '') }
      }
    } catch { /* next */ }
  }
  return null
}

console.log(`单模式验证: ${MODE}`)
if (await isCs2Running()) { console.log('✗ CS2 运行中'); process.exit(1) }
await waitSteamIdle('deploy 前')
await deploy(MODE)
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

const log = await consoleLog()
const dumpsAfter = await listDumps()
const newDumps = dumpsAfter.filter((f) => !dumpsBefore.includes(f))
const survived = firstSeen >= 0 && lastAlive - firstSeen >= 50
const verdict = survived && newDumps.length === 0 ? 'SUCCESS' : firstSeen >= 0 ? 'CRASH' : 'NOLAUNCH'
console.log(`  → 首次出现 ${firstSeen < 0 ? '无' : firstSeen + 's'} | 最后存活 ${lastAlive < 0 ? '无' : lastAlive + 's'} | 新 minidump: ${newDumps.length}`)
if (newDumps.length) console.log('  minidump:', newDumps)
if (log) console.log(`  consolelog:\n${'-'.repeat(20)}\n${log.tail}\n${'-'.repeat(20)}`)
else console.log('  (无 consolelog 内容)')

await killCs2()
await demoInjector.uninstall(INSTALL)
console.log(`\n=== 模式 ${MODE}: ${verdict} ===`)
