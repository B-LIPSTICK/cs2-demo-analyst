/**
 * CS2 回放与进程服务：CS2 进程检测、纯净原生回放（+exec cfg）、游戏内语音 HUD 注入。
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, parse } from 'node:path'
import { shell } from 'electron'
import type { LaunchResult, LiveStatus } from '@shared/types'
import { extractVoiceIndex } from './voiceIndex'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from './vpk'
import { demoInjector } from './injector'
import { VConsoleClient } from './vconsole'

export interface LiveEvents {
  status: (s: LiveStatus) => void
  consoleLine?: (channel: string, text: string) => void
  gsi?: (s: unknown) => void
}

export class LiveService {
  private status: LiveStatus = {
    state: 'idle',
    cs2Running: false,
    vconsoleConnected: false,
    gsiActive: false
  }
  private vc: VConsoleClient | null = null
  private vconsolePort = 29000
  private pendingPlayDemo: string | null = null
  private pendingStartTick: number | null = null
  private detectTimer: NodeJS.Timeout | null = null
  /** 普通模式播放 cfg（dsh-play.cfg）退出后清理定时器 */
  private playCfgCleanupTimer: NodeJS.Timeout | null = null
  private events: LiveEvents
  private mockCs2 = false
  private installPath?: string

  constructor(events: LiveEvents) {
    this.events = events
  }

  /** 设置用户指定的 CS2 安装路径 */
  setInstallPath(p?: string): void {
    this.installPath = p
  }

  /** 开发模式：模拟 CS2 进程存在 */
  setMockCs2(on: boolean): void {
    this.mockCs2 = on
    if (on) {
      this.status.cs2Running = true
      this.status.state = 'live'
      this.emitStatus()
    }
  }

  /** 设置 VConsole 端口 */
  setPorts(vconsolePort?: number, _gsiPort?: number): void {
    if (vconsolePort && vconsolePort > 0) this.vconsolePort = vconsolePort
  }

  start(): void {
    this.detectTimer = setInterval(() => void this.poll(), 4000)
    void this.poll()
    // 启动时清理残留注入（上次会话异常退出可能留下 gameinfo.gi SearchPath + VPK）
    void this.cleanupStaleInjection()
  }

  /**
   * 残留注入清理：gameinfo.gi 含本工具注入行但 CS2 未运行 → 恢复。
   */
  async cleanupStaleInjection(): Promise<void> {
    try {
      const install = await locateCs2Install(this.installPath)
      if (!install) return
      if (await demoInjector.isInjected(install)) {
        const running = await isCs2Running()
        if (!running) {
          await demoInjector.uninstall(install)
          if (process.env['DEBUG_LIVE'] === '1') console.log('[live] 已清理残留的语音 HUD 注入')
        }
      }
      // 顺带清理残留播放 cfg
      await fs.unlink(join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')).catch(() => {})
    } catch {
      /* 清理失败不阻塞启动 */
    }
  }

  stop(): void {
    if (this.detectTimer) clearInterval(this.detectTimer)
    if (this.playCfgCleanupTimer) clearTimeout(this.playCfgCleanupTimer)
    this.vc?.close()
    this.vc = null
  }

  // ─── 进程检测 ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const running = this.mockCs2 || (await isCs2Running())
    const changed = running !== this.status.cs2Running
    this.status.cs2Running = running

    if (running) {
      if (!this.vc && !this.mockCs2) {
        void this.connect()
      }
    } else {
      if (this.vc) {
        this.vc.close()
        this.vc = null
        this.status.vconsoleConnected = false
      }
    }

    if (changed || (running && this.status.vconsoleConnected && this.status.state !== 'live')) {
      this.status.state = running ? (this.status.vconsoleConnected ? 'live' : 'detected') : 'idle'
      this.emitStatus()
    }
  }

  // ─── VConsole 控制台与指令 ───────────────────────────────────────────────

  async connect(): Promise<LiveStatus> {
    if (this.vc && this.status.vconsoleConnected) return this.status
    if (this.vc) {
      this.vc.close()
      this.vc = null
    }
    this.status.state = 'connecting'
    this.emitStatus()

    this.vc = new VConsoleClient(
      {
        onConnected: () => {
          this.status.vconsoleConnected = true
          this.status.state = 'live'
          this.emitStatus()
          if (process.env['DEBUG_LIVE'] === '1') console.log('[live] VConsole connected')
        },
        onReady: () => {
          if (process.env['DEBUG_LIVE'] === '1') console.log('[live] VConsole ready')
          if (this.pendingPlayDemo) {
            const name = this.pendingPlayDemo
            this.pendingPlayDemo = null
            this.vc?.sendCommand(`playdemo ${name}`)
            if (this.pendingStartTick) {
              const tick = this.pendingStartTick
              this.pendingStartTick = null
              setTimeout(() => {
                this.vc?.sendCommand(`demo_gototick ${tick}`)
              }, 600)
            }
          }
        },
        onDisconnected: (_err) => {
          this.status.vconsoleConnected = false
          this.status.state = this.status.cs2Running ? 'detected' : 'idle'
          this.emitStatus()
          this.vc = null
        },
        onLine: (channel, text) => {
          this.events.consoleLine?.(channel, text)
        }
      },
      '127.0.0.1',
      this.vconsolePort
    )
    this.vc.connect()
    return this.status
  }

  sendCommand(cmd: string): boolean {
    return this.vc?.sendCommand(cmd) ?? false
  }

  jumpTick(tick: number): boolean {
    if (this.vc && this.status.vconsoleConnected) {
      const t = Math.round(tick)
      return this.vc.sendCommand(`demo_gototick ${t}`)
    }
    return false
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
    return this.sendCommand(`spec_goto ${userid}`)
  }

  /**
   * 为 VConsole / -tools 模式准备 demo：复制到 game/csgo/ 根目录
   * （CS2 VConsole 的 playdemo 命令只按文件名加载——须放 game/csgo/ 根目录）。
   * 返回可注入的文件名；失败返回 null。
   */
  private async stageDemoForPlay(demoPath: string, installPath?: string): Promise<string | null> {
    const install = installPath ?? this.installPath ?? (await locateCs2Install(this.installPath))
    if (!install) return null
    const destDir = join(install, 'game', 'csgo')
    try {
      await fs.access(destDir)
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
   * 为普通模式播放准备 demo：复制到「盘根:\dsh-demo\」目录（5E 同款思路）。
   * 普通模式 +playdemo 的路径参数不能含空格/非 Latin 字符（真机验证 + cs-dm issue #992），
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

  /**
   * 游戏内语音 HUD 准备：提取语音说话者索引 → 生成会话 VPK（vjs_c 内嵌数据）
   * → 部署静态 VPK + 会话 VPK + gameinfo.gi SearchPath 注入。
   */
  private async prepareVoiceHud(demoPath: string, install: string): Promise<string | null> {
    try {
      const index = await extractVoiceIndex(demoPath)
      const js = buildVoiceDataJs({
        voicePacketCount: index.voicePacketCount,
        pulsesBySlot: index.pulsesBySlot,
        players: {}
      })
      const sessionVpk = Buffer.from(
        buildVpk([
          {
            ext: 'vjs_c',
            path: 'panorama/scripts/hud',
            name: 'dsh_voice_data',
            data: buildVjsResource(js)
          }
        ])
      )
      const staticVpk = await demoInjector.readStaticVpk()
      if (!staticVpk) return '游戏内语音 HUD 资源缺失（请重新构建应用）'
      return await demoInjector.install(install, { staticVpk, sessionVpk })
    } catch (err) {
      return `语音索引提取失败: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /** CS2 退出后自动清理会话残留（dsh-play.cfg + 注入恢复） */
  private scheduleSessionCleanup(install: string, voiceHud: boolean): void {
    if (this.playCfgCleanupTimer) clearTimeout(this.playCfgCleanupTimer)
    const cfgFile = join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')
    const check = () => {
      void isCs2Running().then((running) => {
        if (!running) {
          void fs.unlink(cfgFile).catch(() => {})
          if (voiceHud) void demoInjector.uninstall(install).catch(() => {})
        } else {
          this.playCfgCleanupTimer = setTimeout(check, 5000)
        }
      })
    }
    this.playCfgCleanupTimer = setTimeout(check, 15000)
  }

  /** 定位 steam.exe（注册表 SteamPath；找不到返回 null）——voiceHud 注入模式经 Steam 启动 */
  private async locateSteamExe(): Promise<string | null> {
    try {
      const { execFile } = await import('node:child_process')
      const reg = await new Promise<string>((resolve) => {
        execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (_e, out) => resolve(out))
      })
      const m = reg.match(/SteamPath\s+REG_SZ\s+(.+)/i)
      if (m) {
        const exe = join(m[1].trim(), 'steam.exe')
        await fs.access(exe)
        return exe
      }
    } catch {
      /* noop */
    }
    for (const p of [
      'C:\\Program Files (x86)\\Steam\\steam.exe',
      'D:\\11-Steam\\steam.exe',
      'D:\\Steam\\steam.exe'
    ]) {
      try {
        await fs.access(p)
        return p
      } catch {
        /* next */
      }
    }
    return null
  }

  /** 一键启动/原生回放 */
  async launch(
    opts?: { toolsMode?: boolean; playDemoPath?: string; voiceHud?: boolean; startTick?: number },
    userArgs?: string,
    installPath?: string,
    _display?: { mode?: string; resolution?: string }
  ): Promise<LaunchResult> {
    const toolsMode = opts?.toolsMode ?? true
    const demoPath = opts?.playDemoPath
    const voiceHud = !!opts?.voiceHud
    const startTick = typeof opts?.startTick === 'number' && opts.startTick > 0 ? opts.startTick : undefined
    const extra: string[] = (userArgs ?? '').match(/\S+/g) ?? []

    if (demoPath) {
      const running = await isCs2Running()
      // ① CS2 正在运行
      if (running) {
        if (this.status.vconsoleConnected) {
          const name = await this.stageDemoForPlay(demoPath, installPath)
          if (name) {
            const sent = this.sendCommand(`playdemo ${name}`)
            if (sent) {
              if (startTick) {
                setTimeout(() => this.sendCommand(`demo_gototick ${startTick}`), 600)
              }
              return { ok: true, url: '', injected: true, demoFile: name }
            }
          }
          return {
            ok: false,
            url: '',
            error: '无法准备 demo 文件（复制到 CS2 目录失败）。请检查 CS2 安装路径设置。'
          }
        }
        return {
          ok: false,
          url: '',
          error: 'CS2 正在运行中（控制台未直连）。请先退出 CS2，再点击播放 Demo 录像。'
        }
      }

      // ② CS2 未运行：根据 toolsMode 决定启动方式
      const install = await locateCs2Install(installPath)
      if (install) {
        const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
        try {
          await fs.access(exe)

          // 2.1 直连跳转模式 (toolsMode)：原生分辨率 + -tools -noassetbrowser，VConsole 远程控制
          if (toolsMode && !voiceHud) {
            const name = await this.stageDemoForPlay(demoPath, install)
            if (!name) {
              return {
                ok: false,
                url: '',
                error: '无法准备 demo 文件（复制到 CS2 目录失败）。请检查磁盘空间或 CS2 路径设置。'
              }
            }
            this.pendingPlayDemo = name
            this.pendingStartTick = startTick ?? null

            const args: string[] = ['-tools', '-noassetbrowser', '-novid', ...extra]
            const child = spawn(exe, args, {
              cwd: dirname(exe),
              detached: true,
              stdio: 'ignore',
              windowsHide: false
            })
            child.on('error', () => {})
            child.unref()

            setTimeout(() => void this.connect(), 1500)
            return { ok: true, url: '', direct: true, exe, demoFile: name, starting: true }
          }

          // 2.2 普通原生模式或带 voiceHud：+exec dsh-play.cfg 秒播
          const staged = await this.stageDemoForPlayNoSpace(demoPath, install)
          if (!staged) {
            return {
              ok: false,
              url: '',
              error: '无法准备 demo 文件（写入暂存目录失败）。请检查磁盘空间或 CS2 路径设置。'
            }
          }
          // 游戏内语音 HUD：提取语音索引 → 会话 VPK → 部署 VPK + gameinfo.gi 注入
          if (voiceHud) {
            const err = await this.prepareVoiceHud(demoPath, install)
            if (err) return { ok: false, url: '', error: err }
          }
          // 写播放 cfg（完美平台同款原生机制；退出后自动清理）
          const cfgFile = join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')
          const cfgLines = voiceHud
            ? ['demo_ui_mode 2', 'cl_demo_predict 0', 'tv_listen_voice_indices -1', 'tv_listen_voice_indices_h -1', `playdemo "${staged}"`]
            : ['demo_ui_mode 2', 'cl_demo_predict 0', `playdemo "${staged}"`]
          if (startTick) {
            cfgLines.push(`demo_gototick ${startTick}`)
            cfgLines.push(`bind "F8" "demo_gototick ${startTick}"`)
          }
          await fs.writeFile(cfgFile, cfgLines.join('\n') + '\n', 'utf-8')

          const tickArgs = startTick ? ['+demo_gototick', String(startTick)] : []

          // voiceHud 走 Steam -applaunch 避免 Steam 本地验证干扰
          if (voiceHud) {
            const steamExe = await this.locateSteamExe()
            if (!steamExe) {
              return {
                ok: false,
                url: '',
                error: '未找到 Steam（语音 HUD 需经 Steam 启动 CS2）。请确认 Steam 已安装且登录。'
              }
            }
            const args = ['-applaunch', '730', '-insecure', '-novid', '-console', '-consolelog', 'dsh_hud.log', '+exec', 'dsh-play.cfg', ...tickArgs, ...extra]
            const child = spawn(steamExe, args, {
              cwd: dirname(steamExe),
              detached: true,
              stdio: 'ignore',
              windowsHide: false
            })
            child.on('error', () => {})
            child.unref()
            this.scheduleSessionCleanup(install, voiceHud)
            return { ok: true, url: '', direct: true, exe: steamExe, demoFile: staged }
          }

          const args: string[] = ['+exec', 'dsh-play.cfg', '+cl_demo_predict', '0', '-novid', ...tickArgs, ...extra]
          const child = spawn(exe, args, {
            cwd: dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.on('error', () => {})
          child.unref()
          this.scheduleSessionCleanup(install, voiceHud)
          return { ok: true, url: '', direct: true, exe, demoFile: staged }
        } catch {
          /* 回退 steam:// */
        }
      }

      // 无法直启时的回退（steam:// URL）
      const fallbackTools = toolsMode ? '-tools -noassetbrowser ' : ''
      const url = `steam://run/730//${fallbackTools}-novid%20${encodeURIComponent(extra.join(' '))}`
      try {
        await shell.openExternal(url)
        return { ok: true, url }
      } catch (err) {
        return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
      }
    }

    // ③ 无 Demo 时直接启动 CS2（设置页测试启动）
    const install = await locateCs2Install(installPath)
    if (install) {
      const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
      try {
        await fs.access(exe)
        const args: string[] = toolsMode
          ? ['-tools', '-noassetbrowser', '-novid', ...extra]
          : ['-novid', ...extra]
        const child = spawn(exe, args, {
          cwd: dirname(exe),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.on('error', () => {})
        child.unref()
        if (toolsMode) {
          setTimeout(() => void this.connect(), 1500)
        }
        return { ok: true, url: '', direct: true, exe }
      } catch {
        /* noop */
      }
    }

    const fallbackTools = toolsMode ? '-tools -noassetbrowser ' : ''
    const url = `steam://run/730//${fallbackTools}-novid%20${encodeURIComponent(extra.join(' '))}`
    try {
      await shell.openExternal(url)
      return { ok: true, url }
    } catch (err) {
      return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 兼容性保留：GSI 已移除 */
  async installGsi(): Promise<string | null> {
    return null
  }

  /** 定位 CS2 安装目录 */
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
