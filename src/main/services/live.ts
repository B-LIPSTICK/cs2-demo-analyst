/**
 * 实况服务：CS2 进程检测、VConsole2 注入、GSI 状态读取、一键启动。
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import http from 'node:http'
import { shell } from 'electron'
import type { GsiGameState, LaunchResult, LiveStatus } from '@shared/types'
import { VConsoleClient } from './vconsole'

export interface LiveEvents {
  status: (s: LiveStatus) => void
  gsi: (s: GsiGameState) => void
  consoleLine: (channel: string, text: string) => void
}

const GSI_CFG_NAME = 'gamestate_integration_demoanalyst.cfg'

export class LiveService {
  private vc: VConsoleClient | null = null
  private status: LiveStatus = {
    state: 'idle',
    cs2Running: false,
    vconsoleConnected: false,
    gsiActive: false
  }
  private detectTimer: NodeJS.Timeout | null = null
  private events: LiveEvents
  private gsiServer: http.Server | null = null
  private gsiPort = 30070
  private vconsolePort = 29000
  private lastGsi: GsiGameState = {}
  private mockCs2 = false

  constructor(events: LiveEvents) {
    this.events = events
  }

  /** 开发模式：模拟 CS2 进程存在（配合 VConsole mock 服务端） */
  setMockCs2(on: boolean): void {
    this.mockCs2 = on
    if (on) {
      this.status.cs2Running = true
      this.emitStatus()
      void this.connect()
    }
  }

  setPorts(vconsolePort: number, gsiPort: number): void {
    this.vconsolePort = vconsolePort
    this.gsiPort = gsiPort
    this.restartGsiServer()
  }

  start(): void {
    this.detectTimer = setInterval(() => void this.poll(), 4000)
    void this.poll()
  }

  stop(): void {
    if (this.detectTimer) clearInterval(this.detectTimer)
    this.vc?.close()
    this.gsiServer?.close()
  }

  // ─── 进程检测 ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const running = this.mockCs2 || (await isCs2Running())
    const changed = running !== this.status.cs2Running
    this.status.cs2Running = running
    if (changed) {
      if (running) {
        // 尝试自动挂接
        if (!this.status.vconsoleConnected) void this.connect()
      } else {
        this.status.state = 'idle'
        this.status.vconsoleConnected = false
        this.vc?.close()
        this.vc = null
      }
      this.emitStatus()
    }
  }

  // ─── VConsole 挂接 ───────────────────────────────────────────────────────

  async connect(): Promise<LiveStatus> {
    if (this.status.vconsoleConnected) return this.status
    this.status.state = 'connecting'
    this.emitStatus()

    this.vc?.close()
    this.vc = new VConsoleClient(
      {
        onConnected: () => {
          this.status.vconsoleConnected = true
          this.status.state = 'live'
          this.status.lastError = undefined
          this.emitStatus()
          // 问候指令：拉取演示信息
          this.vc?.sendCommand('demo_info')
        },
        onDisconnected: (err) => {
          const wasLive = this.status.vconsoleConnected
          this.status.vconsoleConnected = false
          this.status.state = this.status.cs2Running ? 'detected' : 'idle'
          if (err) this.status.lastError = err.message
          this.emitStatus()
          if (wasLive) {
            // 尝试重连
            setTimeout(() => {
              if (this.status.cs2Running && !this.status.vconsoleConnected) void this.connect()
            }, 5000)
          }
        },
        onLine: (channel, text) => {
          this.events.consoleLine(channel, text)
        }
      },
      '127.0.0.1',
      this.vconsolePort
    )
    this.vc.connect()
    // 3 秒内未连上则降级
    setTimeout(() => {
      if (this.status.state === 'connecting' && !this.status.vconsoleConnected) {
        this.status.state = this.status.cs2Running ? 'detected' : 'idle'
        this.status.lastError = this.status.cs2Running
          ? 'VConsole 未响应：请确认 CS2 以 -tools 模式启动（设置页可一键引导）'
          : '未检测到 CS2'
        this.emitStatus()
        this.vc?.close()
      }
    }, 3000)
    return this.status
  }

  sendCommand(cmd: string): boolean {
    return this.vc?.sendCommand(cmd) ?? false
  }

  // ─── 注入指令集 ─────────────────────────────────────────────────────────

  jumpTick(tick: number): boolean {
    return this.sendCommand(`demo_gototick ${Math.round(tick)}`)
  }

  pause(): boolean {
    return this.sendCommand('demo_pause')
  }

  resume(): boolean {
    return this.sendCommand('demo_resume')
  }

  setTimescale(x: number): boolean {
    return this.sendCommand(`demo_timescale ${x}`)
  }

  specNext(): boolean {
    return this.sendCommand('spec_next')
  }

  specPrev(): boolean {
    return this.sendCommand('spec_prev')
  }

  specGoto(userid: number): boolean {
    return this.sendCommand(`spec_goto ${Math.round(userid)}`)
  }

  // ─── GSI ─────────────────────────────────────────────────────────────────

  private restartGsiServer(): void {
    this.gsiServer?.close()
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(200)
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200)
        res.end()
        try {
          const data = JSON.parse(body) as {
            map?: { name?: string; phase?: string; mode?: string; round?: number }
            round?: { phase?: string; bomb?: string }
            player?: { state?: { health?: number; money?: number } }
            allplayers?: Record<string, { state?: { health?: number; money?: number }; team?: string }>
            team?: { t?: { score?: number }; ct?: { score?: number } }
          }
          const state: GsiGameState = {
            map: data.map?.name,
            phase: data.map?.phase ?? data.round?.phase,
            round: data.map?.round,
            scoreT: data.team?.t?.score,
            scoreCT: data.team?.ct?.score,
            bomb: (data.round?.bomb as GsiGameState['bomb']) ?? null
          }
          // 存活人数
          let aliveT = 0
          let aliveCT = 0
          for (const p of Object.values(data.allplayers ?? {})) {
            const hp = p?.state?.health ?? 0
            if (hp > 0) {
              if (p.team === 'T') aliveT++
              else if (p.team === 'CT') aliveCT++
            }
          }
          state.playersAliveT = aliveT
          state.playersAliveCT = aliveCT
          this.lastGsi = state
          if (!this.status.gsiActive) {
            this.status.gsiActive = true
            this.emitStatus()
          }
          this.events.gsi(state)
        } catch {
          /* 忽略坏 JSON */
        }
      })
    })
    server.on('error', () => {
      /* 端口占用等 */
    })
    server.listen(this.gsiPort, '127.0.0.1')
    this.gsiServer = server
  }

  getGsi(): GsiGameState {
    return this.lastGsi
  }

  /** 生成 GSI 配置文件（写进 CS2 的 csgo/cfg，游戏启动时加载） */
  async installGsiCfg(installPath?: string): Promise<string | null> {
    const base = installPath ?? (await locateCs2Install())
    if (!base) return null
    const cfgDir = join(base, 'game', 'csgo', 'cfg')
    const cfg = [
      '// CS2 Demo Analyst - Game State Integration（官方功能）',
      `"CS2DemoAnalyst_GSI"`,
      '{',
      `  "uri" "http://127.0.0.1:${this.gsiPort}"`,
      '  "timeout" "5.0"',
      '  "buffer" "0.1"',
      '  "throttle" "0.1"',
      '  "heartbeat" "10.0"',
      '  "data"',
      '  {',
      '    "provider" "1"',
      '    "map" "1"',
      '    "round" "1"',
      '    "player_id" "1"',
      '    "player_state" "1"',
      '    "allplayers_state" "1"',
      '    "allplayers_match_stats" "1"',
      '    "allplayers_weapons" "1"',
      '    "team" "1"',
      '  }',
      '}'
    ].join('\n')
    await fs.mkdir(cfgDir, { recursive: true })
    const dest = join(cfgDir, GSI_CFG_NAME)
    await fs.writeFile(dest, cfg, 'utf-8')
    return dest
  }

  // ─── 启动器 ──────────────────────────────────────────────────────────────

  /** 以 -tools 模式启动 CS2（steam:// URL，args 经 steam 透传） */
  launchCs2(toolsMode: boolean, playDemoPath?: string, extra: string[] = []): { ok: boolean; url: string } {
    const args: string[] = [...extra]
    if (toolsMode && !extra.includes('-tools')) args.push('-tools')
    if (playDemoPath) args.push(`+playdemo "${playDemoPath}"`)
    const argStr = args.length ? `//${encodeURIComponent(args.join(' '))}` : ''
    const url = `steam://run/730${argStr}`
    return { ok: true, url }
  }

  /** 一键启动/播放 */
  async launch(
    opts?: { toolsMode?: boolean; playDemoPath?: string },
    userArgs?: string
  ): Promise<LaunchResult> {
    const toolsMode = opts?.toolsMode ?? true
    const demoPath = opts?.playDemoPath
    // 用户自定义启动项（空格分隔），如 "-tools -insecure"
    const extra: string[] = (userArgs ?? '').match(/\S+/g) ?? []

    // ① 已连接 VConsole（CS2 正在 -tools 模式运行）→ 直接注入 playdemo 指令，最稳
    if (demoPath && this.status.vconsoleConnected) {
      const sent = this.sendCommand(`playdemo ${demoPath}`)
      if (sent) return { ok: true, url: '', injected: true }
    }

    // ①b CS2 已在运行但控制台未连：CS2 是单实例，直接启动会被吞掉参数（只启动不播放），
    //     因此尝试自动连接 VConsole 后注入 playdemo；连不上则给出明确提示
    if (demoPath) {
      const running = await isCs2Running()
      if (running && !this.status.vconsoleConnected) {
        await this.connect()
        await new Promise((r) => setTimeout(r, 1500))
        if (this.status.vconsoleConnected) {
          const sent = this.sendCommand(`playdemo ${demoPath}`)
          if (sent) return { ok: true, url: '', injected: true }
        }
        return {
          ok: false,
          url: '',
          error:
            'CS2 正在运行，但控制台（VConsole）未连接，无法注入播放指令。\n请确认 CS2 以 -tools 模式启动，然后在「实况」页点「连接控制台」，再回来点「CS2 中播放」。'
        }
      }
    }

    // ② CS2 未运行 → 直接启动 cs2.exe（数组传参，路径带空格/中文都可靠；steam:// 对引号透传不稳）
    const install = await locateCs2Install()
    if (install) {
      const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
      try {
        await fs.access(exe)
        const args: string[] = [...extra]
        // 用户启动项里没有 -tools 且需要 tools 模式时自动补上（保证控制台可注入）
        if (toolsMode && !extra.includes('-tools') && !extra.some((a) => a.startsWith('-tools'))) {
          args.push('-tools')
        }
        if (demoPath) args.push('+playdemo', demoPath)
        const child = spawn(exe, args, {
          cwd: dirname(exe),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.on('error', () => {})
        child.unref()
        return { ok: true, url: '', direct: true, exe }
      } catch {
        /* exe 不存在 → 回退 steam:// */
      }
    }

    // ③ 回退：steam:// URL（无法定位安装目录时），合并用户启动项
    const { url } = this.launchCs2(toolsMode, demoPath, extra)
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (err) {
      return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 写入 GSI 配置到 CS2 的 csgo/cfg 目录（优先设置里的路径，否则自动定位） */
  async installGsi(): Promise<string | null> {
    return this.installGsiCfg()
  }

  /** 定位 CS2 安装目录（Steam 注册表 → libraryfolders.vdf） */
  async locateInstall(): Promise<string | null> {
    return locateCs2Install()
  }

  getStatus(): LiveStatus {
    return { ...this.status }
  }

  private emitStatus(): void {
    this.events.status({ ...this.status })
  }
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (_err, stdout) => {
      resolve(stdout || '')
    })
  })
}

export async function isCs2Running(): Promise<boolean> {
  const out = await runCmd('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'])
  return out.includes('cs2.exe')
}

/** 定位 CS2 安装目录（Steam 注册表 → libraryfolders.vdf） */
export async function locateCs2Install(): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process')
    const reg = await new Promise<string>((resolve) => {
      execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (_e, out) => resolve(out))
    })
    const m = reg.match(/SteamPath\s+REG_SZ\s+(.+)/i)
    if (!m) return null
    const steamPath = m[1].trim()
    const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
    const vdfText = await fs.readFile(vdf, 'utf-8').catch(() => '')
    const libs: string[] = [join(steamPath, 'steamapps')]
    const re = /"path"\s+"([^"]+)"/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(vdfText))) {
      libs.push(join(mm[1].trim(), 'steamapps'))
    }
    for (const lib of libs) {
      const candidate = join(lib, 'common', 'Counter-Strike Global Offensive')
      try {
        const st = await fs.stat(join(candidate, 'game', 'csgo', 'csgo.exe'))
        if (st.isFile()) return candidate
      } catch {
        /* 下一个库 */
      }
    }
    return null
  } catch {
    return null
  }
}
