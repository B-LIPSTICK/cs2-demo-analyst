/**
 * 实况服务：CS2 进程检测、VConsole2 注入、GSI 状态读取、一键启动。
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, parse } from 'node:path'
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
  private videoRestoreTimer: NodeJS.Timeout | null = null
  /** 等待播放的 demo 文件名（VConsole 缓冲就绪后自动注入） */
  private pendingPlayDemo: string | null = null
  /** 普通模式播放 cfg（dsh-play.cfg）退出后清理定时器 */
  private playCfgCleanupTimer: NodeJS.Timeout | null = null
  private events: LiveEvents
  private gsiServer: http.Server | null = null
  private gsiPort = 30070
  private vconsolePort = 29000
  private lastGsi: GsiGameState = {}
  private mockCs2 = false
  private installPath?: string

  constructor(events: LiveEvents) {
    this.events = events
  }

  /** 设置用户指定的 CS2 安装路径（优先用于定位/启动/GSI） */
  setInstallPath(p?: string): void {
    this.installPath = p
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
    if (this.videoRestoreTimer) clearTimeout(this.videoRestoreTimer)
    if (this.playCfgCleanupTimer) clearTimeout(this.playCfgCleanupTimer)
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
        onReady: () => {
          // 缓冲就绪：自动注入等待播放的 demo（解决"第一次点播放没生效"）
          if (this.pendingPlayDemo) {
            const name = this.pendingPlayDemo
            this.pendingPlayDemo = null
            const sent = this.vc?.sendCommand(`playdemo ${name}`)
            if (process.env['DEBUG_LIVE'] === '1') {
              console.log(`[live] auto playdemo ${name} sent=${sent}`)
            }
          }
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
    // 3 秒内未连上则降级；若 CS2 在运行（可能刚启动 29000 未就绪）则自动重试
    setTimeout(() => {
      if (this.status.state === 'connecting' && !this.status.vconsoleConnected) {
        this.status.state = this.status.cs2Running ? 'detected' : 'idle'
        this.status.lastError = this.status.cs2Running
          ? 'VConsole 未响应：请确认 CS2 以 -tools 模式启动（设置页可一键引导）'
          : '未检测到 CS2'
        this.emitStatus()
        this.vc?.close()
        this.vc = null
        // CS2 运行中：每 3 秒重连（CS2 启动初期 29000 可能还没监听），最多 60 秒
        if (this.status.cs2Running && this.pendingPlayDemo) {
          let tries = 0
          const retry = () => {
            if (this.status.vconsoleConnected || tries++ > 20) return
            void this.connect()
            setTimeout(retry, 3000)
          }
          setTimeout(retry, 3000)
        }
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
    const base = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
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

  /** 以指定模式启动 CS2（steam:// URL，args 经 steam 透传；仅作为无法直启时的回退） */
  launchCs2(toolsMode: boolean, playDemoPath?: string, extra: string[] = []): { ok: boolean; url: string } {
    const args: string[] = [...extra]
    if (toolsMode) {
      if (!extra.includes('-tools')) args.push('-tools')
      if (!extra.includes('-noassetbrowser')) args.push('-noassetbrowser')
      if (playDemoPath) args.push(`+playdemo "${playDemoPath}"`)
    } else if (playDemoPath) {
      // 普通模式（完美平台同款：cfg 已写好，+exec 在引擎就绪后执行 playdemo）
      args.push('+exec', 'dsh-play.cfg')
    }
    const argStr = args.length ? `//${encodeURIComponent(args.join(' '))}` : ''
    const url = `steam://run/730${argStr}`
    return { ok: true, url }
  }

  /**
   * 为 CS2 播放准备 demo：复制到 game/csgo/ 目录（CS2 VConsole 的 playdemo
   * 只能按文件名加载——完整路径会被截断/找不到，实测须放 game/csgo/ 根目录）。
   * 返回可注入的文件名；失败返回 null。
   */
  private async stageDemoForPlay(demoPath: string, installPath?: string): Promise<string | null> {
    const install = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
    if (!install) return null
    const destDir = join(install, 'game', 'csgo')
    try {
      await fs.access(destDir)
      // 文件名带 hash 前缀避免覆盖/冲突：playtest-<hash>.dem
      const hash = createHash('sha1').update(demoPath).digest('hex').slice(0, 10)
      const name = `dsh-${hash}.dem`
      const dest = join(destDir, name)
      try {
        await fs.access(dest)
      } catch {
        await fs.copyFile(demoPath, dest)
      }
      return name
    } catch {
      return null
    }
  }

  /**
   * -tools 模式会用 cs2_video_tools.txt（默认 1280x720 小窗口）而非用户正常配置。
   * 启动前把显示配置写入 tools 配置（备份原文件，CS2 退出后恢复）：
   *   display='auto' → 复制用户正常配置（跟随用户当前设置）
   *   display 指定 mode/resolution → 生成对应配置（全屏/无边框/窗口化 + 分辨率）
   * 返回 { backup, tools }；失败返回 null。
   */
  private async mirrorVideoConfig(
    installPath?: string,
    display?: { mode?: string; resolution?: string }
  ): Promise<{ backup: string; tools: string } | null> {
    const install = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
    if (!install) return null
    let userdataRoot = join(dirname(install), '..', '..', 'userdata')
    try {
      const { execFile } = await import('node:child_process')
      const reg = await new Promise<string>((resolve) => {
        execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (_e, out) => resolve(out))
      })
      const m = reg.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      if (m) userdataRoot = join(m[1].trim(), 'userdata')
    } catch {
      /* 注册表不可用时用备选路径 */
    }
    try {
      const ids = await fs.readdir(userdataRoot)
      for (const id of ids) {
        const cfgDir = join(userdataRoot, id, '730', 'local', 'cfg')
        const normal = join(cfgDir, 'cs2_video.txt')
        const tools = join(cfgDir, 'cs2_video_tools.txt')
        try {
          await fs.access(normal)
          let content: string
          if (display && display.mode && display.mode !== 'auto') {
            // 按用户选择生成 tools 配置（基于用户正常配置改显示字段）
            content = await fs.readFile(normal, 'utf-8')
            const parsedRes = parseResolution(display.resolution)
            const w = parsedRes?.[0]
            const h = parsedRes?.[1]
            const mode = display.mode
            const patch: [string, number][] = [
              ['setting.fullscreen', mode === 'fullscreen' ? 1 : 0],
              ['setting.nowindowborder', mode === 'borderless' ? 1 : 0]
            ]
            if (w && h) {
              patch.push(['setting.defaultres', w], ['setting.defaultresheight', h])
            }
            for (const [key, val] of patch) {
              const re = new RegExp(`("${key}"\\s+)"\\d+"`)
              content = re.test(content) ? content.replace(re, `$1"${val}"`) : content + `\t"${key}"\t\t"${val}"\n`
            }
          } else {
            content = await fs.readFile(normal, 'utf-8')
          }
          const backup = `${tools}.dshbak`
          try {
            await fs.copyFile(tools, backup)
          } catch {
            /* 无原文件 */
          }
          await fs.writeFile(tools, content, 'utf-8')
          if (process.env['DEBUG_LIVE'] === '1') {
            console.log(`[live] mirrored video config: ${normal} -> ${tools} (mode=${display?.mode ?? 'auto'})`)
          }
          return { backup, tools }
        } catch {
          /* 该 id 无配置，继续找 */
        }
      }
    } catch {
      /* noop */
    }
    return null
  }

  /**
   * 为普通模式播放准备 demo：复制到「盘根:\dsh-demo\」目录（5E 同款思路）。
   * 普通模式 +playdemo 的路径参数不能含空格/非 Latin 字符（真机验证 + cs-dm issue #992），
   * game/csgo 路径本身带空格（"Counter-Strike Global Offensive"）不可用。
   * 返回完整暂存路径；失败返回 null。
   */
  private async stageDemoForPlayNoSpace(demoPath: string, installPath?: string): Promise<string | null> {
    const install = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
    if (!install) return null
    const dir = join(parse(install).root, 'dsh-demo')
    try {
      await fs.mkdir(dir, { recursive: true })
      const hash = createHash('sha1').update(demoPath).digest('hex').slice(0, 10)
      const name = `dsh-${hash}.dem`
      const dest = join(dir, name)
      try {
        await fs.access(dest)
      } catch {
        await fs.copyFile(demoPath, dest)
      }
      return dest
    } catch {
      return null
    }
  }

  /** CS2 退出后自动删除 dsh-play.cfg（普通模式播放残留清理） */
  private schedulePlayCfgCleanup(install: string): void {
    if (this.playCfgCleanupTimer) clearTimeout(this.playCfgCleanupTimer)
    const cfgFile = join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')
    const check = () => {
      void isCs2Running().then((running) => {
        if (!running) {
          void fs.unlink(cfgFile).catch(() => {})
        } else {
          this.playCfgCleanupTimer = setTimeout(check, 5000)
        }
      })
    }
    this.playCfgCleanupTimer = setTimeout(check, 15000)
  }

  /** 恢复被镜像覆盖的 tools 视频配置（备份存在时） */
  private async restoreVideoConfig(backupPath?: string): Promise<void> {
    if (!backupPath) return
    const tools = backupPath.replace(/\.dshbak$/, '')
    try {
      await fs.copyFile(backupPath, tools)
      await fs.unlink(backupPath).catch(() => {})
    } catch {
      /* noop */
    }
  }

  /** 读用户正常模式的分辨率（cs2_video.txt），供 -w/-h 启动参数用 */
  private async readUserResolution(installPath?: string): Promise<[number, number] | null> {
    const install = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
    if (!install) return null
    let userdataRoot = join(dirname(install), '..', '..', 'userdata')
    try {
      const { execFile } = await import('node:child_process')
      const reg = await new Promise<string>((resolve) => {
        execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (_e, out) => resolve(out))
      })
      const m = reg.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      if (m) userdataRoot = join(m[1].trim(), 'userdata')
    } catch {
      /* 注册表不可用时用备选路径 */
    }
    try {
      const ids = await fs.readdir(userdataRoot)
      for (const id of ids) {
        const cfgDir = join(userdataRoot, id, '730', 'local', 'cfg')
        const normal = join(cfgDir, 'cs2_video.txt')
        try {
          const content = await fs.readFile(normal, 'utf-8')
          const w = content.match(/"setting\.defaultres"\s+"(\d+)"/)
          const h = content.match(/"setting\.defaultresheight"\s+"(\d+)"/)
          if (w && h) return [Number(w[1]), Number(h[1])]
        } catch {
          /* 继续找下一个 id */
        }
      }
    } catch {
      /* noop */
    }
    return null
  }

  /** 一键启动/播放 */
  async launch(
    opts?: { toolsMode?: boolean; playDemoPath?: string },
    userArgs?: string,
    installPath?: string,
    display?: { mode?: string; resolution?: string }
  ): Promise<LaunchResult> {
    const toolsMode = opts?.toolsMode ?? true
    const demoPath = opts?.playDemoPath
    // 用户自定义启动项（空格分隔），如 "-tools -insecure"
    const extra: string[] = (userArgs ?? '').match(/\S+/g) ?? []

    // ① 普通模式播放（完美平台同款机制，2026-08-26 真机验证）:
    //    demo 暂存到盘根无空格目录 → 写 game/csgo/cfg/dsh-play.cfg（playdemo "路径"）
    //    → cs2.exe +exec dsh-play.cfg 启动。
    //    ★关键：+playdemo 作为启动参数会在引擎早期被静默丢弃（播放器半初始化 →
    //    时间走但导播镜头不动）；cfg 里的 playdemo 在引擎就绪后执行 → 导播正常。
    //    CS2 内置播放器：秒播、内置语音显示；无 VConsole 通道（普通模式无远程控制台），
    //    因此 CS2 已在运行时无法注入，须先关闭。
    if (demoPath && !toolsMode) {
      const running = await isCs2Running()
      if (running) {
        return {
          ok: false,
          url: '',
          error: 'CS2 正在运行：普通模式无法注入播放指令，请先关闭 CS2 再播放。\n（若需要运行中跳转/控制，可切换为工具模式 -tools）'
        }
      }
      const install = await locateCs2Install(installPath)
      if (install) {
        const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
        try {
          await fs.access(exe)
          const staged = await this.stageDemoForPlayNoSpace(demoPath, install)
          if (!staged) {
            return {
              ok: false,
              url: '',
              error: '无法准备 demo 文件（写入无空格暂存目录失败）。请检查磁盘权限或 CS2 安装路径设置。'
            }
          }
          // 写播放 cfg（完美平台 pwa.cfg 同款；退出后自动清理）
          const cfgFile = join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')
          await fs.writeFile(cfgFile, `playdemo "${staged}"\n`, 'utf-8')
          // +cl_demo_predict 0 必须：demo 播放预测开启（默认）会干扰导播镜头 → 时间走但镜头不动
          //（完美平台参数逆向 + 真机单变量验证 2026-08-23）
          const args: string[] = ['+exec', 'dsh-play.cfg', '+cl_demo_predict', '0', '-novid', ...extra]
          const child = spawn(exe, args, {
            cwd: dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.on('error', () => {})
          child.unref()
          this.schedulePlayCfgCleanup(install)
          return { ok: true, url: '', direct: true, exe, demoFile: staged }
        } catch {
          /* exe 不存在/写 cfg 失败 → 回退 steam:// */
        }
      }
      // 无法直启时的回退（steam:// URL）
      const { url } = this.launchCs2(toolsMode, demoPath, extra)
      try {
        await shell.openExternal(url)
        return { ok: true, url }
      } catch (err) {
        return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
      }
    }

    // ② 已连接 VConsole（CS2 正在 -tools 模式运行）→ 复制 demo 到 game/csgo/ 并注入文件名
    if (demoPath && this.status.vconsoleConnected) {
      const name = await this.stageDemoForPlay(demoPath, installPath)
      if (name) {
        const sent = this.sendCommand(`playdemo ${name}`)
        if (sent) return { ok: true, url: '', injected: true, demoFile: name }
      }
      return {
        ok: false,
        url: '',
        error: '无法准备 demo 文件（复制到 CS2 目录失败）。请检查 CS2 安装路径设置。'
      }
    }

    // ①b CS2 已在运行但控制台未连：CS2 是单实例，直接启动会被吞掉参数（只启动不播放），
    //     因此尝试自动连接 VConsole 后注入 playdemo；连不上则给出明确提示
    if (demoPath) {
      const running = await isCs2Running()
      if (running && !this.status.vconsoleConnected) {
        await this.connect()
        // 轮询等连接（最长 8 秒），连接后 vconsole 会自动在缓冲就绪时发送
        const t0 = Date.now()
        while (Date.now() - t0 < 8000 && !this.status.vconsoleConnected) {
          await new Promise((r) => setTimeout(r, 500))
        }
        if (this.status.vconsoleConnected) {
          const name = await this.stageDemoForPlay(demoPath, installPath)
          if (name) {
            const sent = this.sendCommand(`playdemo ${name}`)
            if (sent) return { ok: true, url: '', injected: true, demoFile: name }
          }
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
    //   注意：+playdemo 启动参数在部分 CS2 版本不生效（实测停在主菜单），
    //   因此改为：启动后轮询等 VConsole 连上，再注入 playdemo 文件名。
    const install = await locateCs2Install(installPath)
    if (install) {
      const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
      try {
        await fs.access(exe)
        const args: string[] = [...extra]
        // 用户启动项里没有 -tools 且需要 tools 模式时自动补上（保证控制台可注入）
        if (toolsMode && !extra.includes('-tools') && !extra.some((a) => a.startsWith('-tools'))) {
          args.push('-tools')
        }
        // -tools 模式默认弹 assetbrowser：用官方参数禁掉；-novid 跳过开场动画提速
        if (toolsMode && !args.includes('-noassetbrowser')) {
          args.push('-noassetbrowser')
        }
        if (!args.includes('-novid')) {
          args.push('-novid')
        }
        // -tools 模式用小窗口（cs2_video_tools.txt 1280x720）：写入用户选择的显示配置
        // + 用 -w/-h 启动参数强制窗口尺寸（CS2 可能启动时重置 tools 配置，参数最可靠）
        // 注意：显示配置失败绝不能影响启动（独立 try/catch）
        let videoBackup: string | undefined
        if (toolsMode) {
          try {
            const v = await this.mirrorVideoConfig(installPath, display)
            if (v) videoBackup = v.backup
            const parsed = parseResolution(display?.resolution)
            const userRes = parsed ?? (await this.readUserResolution(installPath))
            if (userRes && !args.some((a) => a.startsWith('-w'))) {
              args.push('-w', String(userRes[0]), '-h', String(userRes[1]))
            }
          } catch (err) {
            if (process.env['DEBUG_LIVE'] === '1') {
              console.error('[live] display config failed (ignored):', err)
            }
          }
        }
        const child = spawn(exe, args, {
          cwd: dirname(exe),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.on('error', () => {})
        child.unref()
        // CS2 退出后恢复 tools 视频配置
        this.videoRestoreTimer && clearTimeout(this.videoRestoreTimer)
        const checkRestore = () => {
          void isCs2Running().then((running) => {
            if (!running && videoBackup) {
              void this.restoreVideoConfig(videoBackup)
              videoBackup = undefined
            } else if (videoBackup) {
              this.videoRestoreTimer = setTimeout(checkRestore, 5000)
            }
          })
        }
        this.videoRestoreTimer = setTimeout(checkRestore, 10000)
        // 有 demo：准备文件 + 设置自动播放（VConsole 就绪后自动注入，不等轮询）
        if (demoPath && toolsMode) {
          const name = await this.stageDemoForPlay(demoPath, installPath)
          if (name) {
            this.pendingPlayDemo = name
            // 立即尝试连接（若 CS2 已监听则快速注入；否则等待 poll 自动连接后 onReady 注入）
            if (!this.status.vconsoleConnected) {
              void this.connect()
            }
            // 兜底：已连接但缓冲未就绪 → 排队（sendCommand 内部处理）
            if (this.status.vconsoleConnected) {
              const ok = this.sendCommand(`playdemo ${name}`)
              if (ok) {
                this.pendingPlayDemo = null
                return { ok: true, url: '', injected: true, exe, demoFile: name }
              }
            }
            // 未连上：等待 onReady 自动注入（不阻塞返回，提示启动中）
            return { ok: true, url: '', direct: true, exe, demoFile: name, starting: true }
          }
        }
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

  /** 定位 CS2 安装目录（优先设置里的路径，否则 Steam 注册表 → libraryfolders.vdf） */
  async locateInstall(): Promise<string | null> {
    return locateCs2Install(this.installPath)
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

/**
 * 定位 CS2 安装目录。
 * 优先使用用户指定的路径（设置 → CS2 → 安装路径，验证 game/bin/win64/cs2.exe 存在）；
 * 否则 Steam 注册表 → libraryfolders.vdf 自动检测。
 */
export async function locateCs2Install(preferred?: string): Promise<string | null> {
  // ① 用户指定路径（带容错：可填到 game 目录或根目录，自动补全）
  if (preferred) {
    const candidates = [
      preferred,
      join(preferred, 'game'),
      join(preferred, '..')
    ]
    for (const c of candidates) {
      try {
        const st = await fs.stat(join(c, 'game', 'bin', 'win64', 'cs2.exe'))
        if (st.isFile()) return join(c)
      } catch {
        /* 下一个候选 */
      }
    }
  }
  // ② Steam 自动检测
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
        const st = await fs.stat(join(candidate, 'game', 'bin', 'win64', 'cs2.exe'))
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

/** 解析 "1920x1080" → [1920, 1080]；无效返回 null */
function parseResolution(res?: string): [number, number] | null {
  if (!res) return null
  const m = res.toLowerCase().match(/^(\d+)\s*[x×]\s*(\d+)$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}
