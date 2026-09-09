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

  /** 兼容性保留 */
  setPorts(_vconsolePort?: number, _gsiPort?: number): void {}

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
  }

  // ─── 进程检测 ────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const running = this.mockCs2 || (await isCs2Running())
    const changed = running !== this.status.cs2Running
    this.status.cs2Running = running
    if (changed) {
      this.status.state = running ? 'live' : 'idle'
      this.emitStatus()
    }
  }

  // ─── 指令兼容性桩 ───────────────────────────────────────────────────────

  async connect(): Promise<LiveStatus> {
    return this.status
  }

  sendCommand(_cmd: string): boolean {
    return false
  }

  jumpTick(_tick: number): boolean {
    return false
  }

  pause(): boolean {
    return false
  }

  resume(): boolean {
    return false
  }

  setTimescale(_x: number): boolean {
    return false
  }

  specNext(): boolean {
    return false
  }

  specPrev(): boolean {
    return false
  }

  specGoto(_userid: number): boolean {
    return false
  }

  // ─── 播放与启动 ─────────────────────────────────────────────────────────

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
    opts?: { toolsMode?: boolean; playDemoPath?: string; voiceHud?: boolean },
    userArgs?: string,
    installPath?: string,
    _display?: { mode?: string; resolution?: string }
  ): Promise<LaunchResult> {
    const demoPath = opts?.playDemoPath
    const voiceHud = !!opts?.voiceHud
    const extra: string[] = (userArgs ?? '').match(/\S+/g) ?? []

    // ① 原生回放模式（写入 cfg 秒开，带 +cl_demo_predict 0 保证导播视角完全正常）
    if (demoPath) {
      const running = await isCs2Running()
      if (running) {
        return {
          ok: false,
          url: '',
          error: 'CS2 正在运行：请先退出 CS2，再点击播放 Demo 录像。'
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
          await fs.writeFile(cfgFile, cfgLines.join('\n') + '\n', 'utf-8')

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
            const args = ['-applaunch', '730', '-insecure', '-novid', '-console', '-consolelog', 'dsh_hud.log', '+exec', 'dsh-play.cfg', ...extra]
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

          const args: string[] = ['+exec', 'dsh-play.cfg', '+cl_demo_predict', '0', '-novid', ...extra]
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
      const url = `steam://run/730//-novid%20${encodeURIComponent(extra.join(' '))}`
      try {
        await shell.openExternal(url)
        return { ok: true, url }
      } catch (err) {
        return { ok: false, url, error: err instanceof Error ? err.message : String(err) }
      }
    }

    // ② 无 Demo 时直接启动 CS2（设置页测试启动）
    const install = await locateCs2Install(installPath)
    if (install) {
      const exe = join(install, 'game', 'bin', 'win64', 'cs2.exe')
      try {
        await fs.access(exe)
        const args: string[] = ['-novid', ...extra]
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
        /* noop */
      }
    }

    const url = `steam://run/730//-novid%20${encodeURIComponent(extra.join(' '))}`
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
