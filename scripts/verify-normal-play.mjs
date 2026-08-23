/**
 * 验证：普通模式（无 -tools）+playdemo 能否播放 demo（变体矩阵 v3）
 *
 * 逆向 5E 客户端 app.asar 得到的真实链路（2026-08-26）：
 *   playDemo → demo 暂存到 D:\5EDemocache（无空格路径）→
 *   spawn(cs2.exe, ["-console", "+demoui", "+playdemo", "<完整路径>", "-insecure", <附加>])
 * 关键差异 vs 我们之前的测试：-console 与 +demoui 两个参数（+命令可能仅在
 * console 系统就绪后执行）；demo 用 5E 自己的（保证与当前 CS2 版本兼容）。
 *
 * 变体：
 *   v10  v9 + +cl_demo_predict 0（完美平台参数里的 demo 预测开关，嫌疑：预测干扰导播镜头）
 *   v11  v10 + 观战设置（cl_obs_interp_enable true / spec_show_xray 0 / spec_replay_autostart true）
 *   v9  完美平台式: demo 暂存盘根 → 写 dsh-play.cfg → spawn cs2.exe +exec dsh-play.cfg
 *   v6  5E 原样:  -console +demoui +playdemo "<5E demo 完整路径>" -insecure
 *   v7  走 Steam: steam.exe -applaunch 730 + v6 参数
 *   v8  5E 参数 + 暂存库 demo
 *   v1..v5 历史变体
 *
 * 用法：
 *   node scripts/verify-normal-play.mjs [--variant 10|11|9|6|7|8|1..5] [--install <路径>] [--demo <路径>] [--kill]
 *   默认 --variant 9。CS2 会保持运行，请直接看屏幕确认；验证后 --kill 清理。
 */
import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, dirname, parse } from 'node:path'
import http from 'node:http'
import os from 'node:os'

const STAGED = 'dsh-vfy.dem'
const LOG_NAME = 'dsh_vfy.log'
const GSI_PORT = 30070
const WATCH_MS = 180_000
const POLL_MS = 5_000

const cliArgs = process.argv.slice(2)
const getArg = (name) => {
  const i = cliArgs.indexOf(name)
  return i >= 0 ? cliArgs[i + 1] : undefined
}
const FLAG_KILL = cliArgs.includes('--kill')
const VARIANT = Number(getArg('--variant') ?? '9')

const out = []
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
  out.push(line)
  console.log(line)
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

const userData = join(os.homedir(), 'AppData', 'Roaming', 'CS2 Demo Analyst')

async function readJson(p) {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    execFile(cmd, cmdArgs, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

/**
 * 进程检测：true=在跑 / false=不在 / null=无法检测（权限被拒等）
 */
async function isProcessAlive(name) {
  const r = await run('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`, '/FO', 'CSV', '/NH'])
  if (r.stdout.toLowerCase().includes(`${name}.exe`)) return true
  if (r.stderr.trim() && !r.stderr.toLowerCase().includes('no tasks')) return null
  return false
}

// ─── 定位 ─────────────────────────────────────────────────────────────────

async function locateInstall() {
  const cli = getArg('--install')
  if (cli) return cli
  const settings = await readJson(join(userData, 'settings.json'))
  if (settings?.cs2?.installPath) return settings.cs2.installPath
  return 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
}

async function locateSteamUserdata() {
  const r = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
  const m = r.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
  if (!m) return null
  const steamPath = m[1].trim()
  try {
    const ids = await fs.readdir(join(steamPath, 'userdata'))
    for (const id of ids) {
      const dir = join(steamPath, 'userdata', id, '730', 'remote', 'csgo', 'demos')
      try {
        await fs.access(dir)
        return dir
      } catch { /* 下一个 id */ }
    }
    // 没有现成目录也返回第一个 id 的路径
    return ids.length ? join(steamPath, 'userdata', ids[0], '730', 'remote', 'csgo', 'demos') : null
  } catch {
    return null
  }
}

async function pickDemo() {
  const cli = getArg('--demo')
  if (cli) return cli
  const idx = await readJson(join(userData, 'library', 'index.json'))
  if (!idx) return null
  const demos = Object.values(idx).filter((d) => d && typeof d.path === 'string')
  demos.sort((a, b) => a.sizeBytes - b.sizeBytes)
  return demos[0]?.path ?? null
}

// ─── GSI 监听（可选证据） ─────────────────────────────────────────────────

function startGsiProbe() {
  return new Promise((resolve) => {
    const probe = { posts: 0, maps: new Set(), phases: new Set(), lastAt: 0 }
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200)
        res.end()
        try {
          const j = JSON.parse(body)
          probe.posts++
          probe.lastAt = Date.now()
          if (j?.map?.name) probe.maps.add(j.map.name)
          if (j?.map?.phase) probe.phases.add(j.map.phase)
        } catch { /* ignore */ }
      })
    })
    server.on('error', (e) => resolve({ probe, error: e.message }))
    server.listen(GSI_PORT, '127.0.0.1', () => resolve({ probe, server }))
  })
}

// ─── 控制台日志（con_logfile 候选位置） ───────────────────────────────────

async function readConLog(install) {
  const candidates = [
    join(install, 'game', 'csgo', LOG_NAME),
    join(install, 'game', LOG_NAME),
    join(install, 'game', 'bin', 'win64', LOG_NAME)
  ]
  for (const p of candidates) {
    try {
      const t = await fs.readFile(p, 'utf-8')
      return { path: p, text: t }
    } catch { /* next */ }
  }
  return null
}

// ─── 清理 ─────────────────────────────────────────────────────────────────

async function cleanup(install, officialDemosDir) {
  try { await fs.unlink(join(install, 'game', 'csgo', STAGED)) } catch { /* noop */ }
  if (officialDemosDir) {
    try { await fs.unlink(join(officialDemosDir, STAGED)) } catch { /* noop */ }
  }
  try { await fs.unlink(join('D:\\5EDemocache', STAGED)) } catch { /* noop */ }
  try { await fs.unlink(join(parse(install).root, 'dsh-demo', STAGED)) } catch { /* noop */ }
  try { await fs.unlink(join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')) } catch { /* noop */ }
  for (const p of [join(install, 'game', 'csgo', LOG_NAME), join(install, 'game', LOG_NAME), join(install, 'game', 'bin', 'win64', LOG_NAME)]) {
    try { await fs.unlink(p) } catch { /* noop */ }
  }
  try { await fs.unlink(join(install, 'game', 'csgo', 'dsh_vfy.log')) } catch { /* noop */ }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const install = await locateInstall()
  const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
  const csgoDir = join(install, 'game', 'csgo')
  const officialDemosDir = await locateSteamUserdata()

  log('=== 普通模式 +playdemo 验证（变体 v' + VARIANT + '）===')
  log(`install: ${install}`)
  log(`官方 demos 目录: ${officialDemosDir ?? '未找到'}`)

  if (FLAG_KILL) {
    await run('taskkill', ['/IM', 'cs2.exe', '/F'])
    await cleanup(install, officialDemosDir)
    log('已结束 cs2.exe 并清理 staged 文件')
    return
  }

  // ① 前置检查（canary 写测试：任何一步失败都不启动 CS2）
  try {
    await fs.access(exe)
  } catch {
    log(`✗ cs2.exe 不存在: ${exe}`)
    return
  }
  try {
    const testFile = join(csgoDir, '.dsh-canary')
    await fs.writeFile(testFile, 'ok')
    await fs.unlink(testFile)
  } catch {
    log(`✗ 无法写入 game/csgo（沙箱/权限）: ${csgoDir}`)
    return
  }
  const cs2Alive = await isProcessAlive('cs2')
  if (cs2Alive === true) {
    log('✗ cs2.exe 已在运行（单实例），请先关闭 CS2 再验证')
    return
  }
  if (cs2Alive === null) {
    log('✗ 无法检测进程状态（tasklist 被拒/无权限），中止')
    return
  }
  const steamAlive = await isProcessAlive('steam')
  log(steamAlive ? '✓ Steam 运行中' : '⚠ Steam 未检测到（直接启动 cs2.exe 可能失败或拉起 Steam）')

  // ② 挑选 demo
  // v6/v7: 用 5E 自己的 demo（D:\5EDemocache，保证兼容 + 无空格路径）
  // v8/v9: 库 demo 暂存到盘根无空格目录
  const FIVE_DEMO_DIR = 'D:\\5EDemocache'
  const DSH_DEMO_DIR = join(parse(install).root, 'dsh-demo')
  const cliDemo = getArg('--demo')
  let demoArgPath
  let stagedFrom
  if (VARIANT === 6 || VARIANT === 7) {
    demoArgPath = cliDemo
    if (!demoArgPath) {
      try {
        const files = await fs.readdir(FIVE_DEMO_DIR)
        const dem = files.find((f) => f.endsWith('.dem'))
        if (dem) demoArgPath = join(FIVE_DEMO_DIR, dem)
      } catch { /* 目录不存在 */ }
    }
    if (!demoArgPath) {
      const lib = await pickDemo()
      if (!lib) {
        log('✗ 找不到 5E demo（D:\\5EDemocache 无 .dem 且库为空）；可用 --demo 指定')
        return
      }
      demoArgPath = lib
      log(`⚠ v6/v7 要求路径无空格且 Basic Latin，库 demo 路径: ${lib}`)
    }
    try {
      await fs.access(demoArgPath)
    } catch {
      log(`✗ demo 文件不存在: ${demoArgPath}`)
      return
    }
    if (/[\s\u4e00-\u9fff]/.test(demoArgPath)) {
      log(`✗ v6/v7 的 demo 路径含空格或非 Latin 字符（${demoArgPath}），请用 --demo 指定无空格路径或改用 v8`)
      return
    }
    const st = await fs.stat(demoArgPath)
    log(`✓ demo: ${demoArgPath} (${Math.round(st.size / 1e6)}MB)`)
  } else {
    const demoPath = cliDemo ?? (await pickDemo())
    if (!demoPath) {
      log('✗ 找不到可播放的 demo（--demo 指定或库为空）')
      return
    }
    try {
      await fs.access(demoPath)
    } catch {
      log(`✗ demo 文件不存在: ${demoPath}`)
      return
    }
    if (VARIANT === 5) {
      if (!officialDemosDir) {
        log('✗ 找不到 Steam userdata demos 目录，v5 无法进行')
        return
      }
      await fs.mkdir(officialDemosDir, { recursive: true })
      demoArgPath = join(officialDemosDir, STAGED)
    } else if (VARIANT === 8) {
      await fs.mkdir(FIVE_DEMO_DIR, { recursive: true })
      demoArgPath = join(FIVE_DEMO_DIR, STAGED)
    } else {
      // v9 及历史变体: 盘根无空格目录（完美平台同款思路）
      await fs.mkdir(DSH_DEMO_DIR, { recursive: true })
      demoArgPath = join(DSH_DEMO_DIR, STAGED)
    }
    try {
      const st = await fs.stat(demoPath)
      try {
        const st2 = await fs.stat(demoArgPath)
        if (st2.size !== st.size) await fs.copyFile(demoPath, demoArgPath)
      } catch {
        await fs.copyFile(demoPath, demoArgPath)
      }
      stagedFrom = demoPath
      log(`✓ demo staged: ${demoArgPath} (${Math.round(st.size / 1e6)}MB, 源: ${demoPath})`)
    } catch (e) {
      log(`✗ 复制 demo 失败: ${e.message}`)
      return
    }
  }

  // ③ GSI 探针
  const gsi = await startGsiProbe()
  if (gsi.error) log(`⚠ GSI 30070 被占用，跳过 GSI 证据（${gsi.error}）`)
  else log('✓ GSI 探针监听 127.0.0.1:30070')

  // ④ 组装启动参数
  const quoted = (p) => `"${p}"`
  let launchArgs
  let target = exe
  // v9/v10/v11: 完美平台式 —— 写 dsh-play.cfg 后 +exec（引擎就绪后执行 playdemo）
  const PLAY_CFG = 'dsh-play.cfg'
  if (VARIANT === 9 || VARIANT === 10 || VARIANT === 11) {
    const cfgPath = join(csgoDir, 'cfg', PLAY_CFG)
    await fs.writeFile(cfgPath, `playdemo ${quoted(demoArgPath)}\n`, 'utf-8')
    log(`✓ cfg 写入: ${cfgPath}`)
  }
  switch (VARIANT) {
    case 10:
      launchArgs = ['+exec', PLAY_CFG, '+cl_demo_predict', '0', '-novid', '-consolelog', 'dsh_vfy.log']
      break
    case 11: {
      // v10 + 观战设置（写进 cfg，模仿完美平台 pwa_userconfig 里的观战项）
      const cfgPath = join(csgoDir, 'cfg', PLAY_CFG)
      const extraCfg =
        '\ncl_obs_interp_enable "true"\nspec_show_xray "0"\nspec_usenumberkeys_nobinds "true"\nspec_replay_autostart "true"\n'
      await fs.appendFile(cfgPath, extraCfg, 'utf-8')
      log(`✓ cfg 追加观战设置`)
      launchArgs = ['+exec', PLAY_CFG, '+cl_demo_predict', '0', '-novid', '-consolelog', 'dsh_vfy.log']
      break
    }
    case 9:
      launchArgs = ['+exec', PLAY_CFG, '-novid', '-consolelog', 'dsh_vfy.log']
      break
    case 6:
      launchArgs = ['-console', '+demoui', '+playdemo', demoArgPath, '-insecure', '+con_logfile', LOG_NAME]
      break
    case 7: {
      // 走 Steam: steam.exe -applaunch 730 <args>
      const r = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
      const m = r.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      if (!m) {
        log('✗ v7 找不到 Steam 路径（注册表）')
        return
      }
      target = join(m[1].trim(), 'steam.exe')
      launchArgs = ['-applaunch', '730', '-console', '+demoui', '+playdemo', demoArgPath, '-insecure', '+con_logfile', LOG_NAME]
      break
    }
    case 8:
      launchArgs = ['-console', '+demoui', '+playdemo', demoArgPath, '-insecure', '+con_logfile', LOG_NAME]
      break
    case 2:
      launchArgs = ['-insecure', '-novid', '+con_logfile', LOG_NAME, '+playdemo', quoted(STAGED)]
      break
    case 3:
      launchArgs = ['-novid', '+con_logfile', LOG_NAME, '+playdemo', quoted(demoArgPath)]
      break
    case 4:
      launchArgs = ['-novid', '+con_logfile', LOG_NAME, '+playdemo', quoted(STAGED)]
      break
    case 5:
      launchArgs = ['-insecure', '-novid', '+con_logfile', LOG_NAME, '+playdemo', quoted(demoArgPath)]
      break
    case 1:
    default:
      launchArgs = ['-insecure', '-novid', '+con_logfile', LOG_NAME, '+playdemo', quoted(demoArgPath)]
      break
  }

  log(`spawn: ${target}`)
  log(`args: ${launchArgs.join(' ')}`)
  const child = spawn(target, launchArgs, {
    cwd: dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.on('error', (e) => log(`✗ spawn 错误: ${e.message}`))
  child.unref()

  // ⑤ 轮询观察
  const t0 = Date.now()
  let lastLogLen = -1
  let aliveAt = []
  let matched = []
  while (Date.now() - t0 < WATCH_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const alive = await isProcessAlive('cs2')
    aliveAt.push(Math.round((Date.now() - t0) / 1000))
    const con = await readConLog(install)
    if (con) {
      if (con.text.length !== lastLogLen) {
        lastLogLen = con.text.length
        log(`… con_logfile(${con.path}) ${con.text.length}B, cs2 alive=${alive}`)
        for (const line of con.text.split('\n')) {
          if (/playdemo|demo|couldn|error|failed|loading|playing|unknown|not found/i.test(line)) {
            const m = line.trim()
            if (m && !matched.includes(m)) matched.push(m)
          }
        }
      }
    } else {
      log(`… ${Math.round((Date.now() - t0) / 1000)}s: cs2 alive=${alive}`)
    }
    if (matched.some((m) => /couldn|not found|failed to load/i.test(m))) break
    if (alive === false && Date.now() - t0 > 30000) break
  }

  const aliveNow = await isProcessAlive('cs2')
  const con = await readConLog(install)

  // ⑥ 结论
  log('')
  log('=== 结论（变体 v' + VARIANT + '）===')
  const aliveDesc = aliveNow === true ? '运行中' : aliveNow === false ? '已退出' : '无法检测'
  log(`cs2 进程: 观察 ${Math.round((Date.now() - t0) / 1000)}s（轮询 ${aliveAt.join('/')}s），当前 ${aliveDesc}`)
  if (gsi.probe.posts > 0) {
    log(`GSI 推送: ${gsi.probe.posts} 次, maps=${[...gsi.probe.maps].join(',')}, phases=${[...gsi.probe.phases].join(',')}`)
    log('  → 收到 GSI 说明进入了地图/对局，demo 很可能在播放')
  } else {
    log('GSI 推送: 0 次')
  }
  if (con) {
    const lines = con.text.split('\n').filter(Boolean)
    log(`con_logfile: ${con.path} (${con.text.length}B, ${lines.length} 行)`)
    const tail = lines.slice(-25).map((l) => l.trim()).filter(Boolean)
    log('  ── 末尾 25 行 ──')
    for (const l of tail) log('  | ' + l)
    const play = matched.filter((m) => /play|demo|loading/i.test(m))
    if (play.length) {
      log('  ── 播放相关行 ──')
      for (const m of play.slice(-15)) log('  * ' + m)
    }
  } else {
    log('con_logfile: 未找到（+con_logfile 也未生效）')
  }
  log('')
  log(aliveNow
    ? 'CS2 保持运行中：请直接看屏幕确认（在播放 demo = 成功；停在主菜单 = 未生效）。'
    : 'CS2 已退出：可能是启动失败（Steam 未运行/单实例冲突）。')
  log('换变体再测: node scripts/verify-normal-play.mjs --variant N；清理: node scripts/verify-normal-play.mjs --kill')

  const resultFile = join(process.cwd(), 'scripts', 'verify-normal-play-result.txt')
  await fs.writeFile(resultFile, out.join('\n') + '\n', 'utf-8')
  log(`\n结果已写入 ${resultFile}`)
}

main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})
