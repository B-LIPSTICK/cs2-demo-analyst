/**
 * CS2 回放与进程服务：CS2 进程检测、纯净原生回放（+exec cfg）、游戏内语音 HUD（addon 优先 / inject fallback）。
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, parse, resolve } from 'node:path'
import { shell } from 'electron'
import type { HudMode, LaunchResult, LiveStatus, MuteHudMode, SteamSafetyReport } from '@shared/types'
import { extractVoiceIndexCached } from './voiceIndex'
import { buildVjsResource, buildVoiceDataJs, buildVpk } from './vpk'
import { demoInjector, VOICE_HUD_ADDON } from './injector'
import { VConsoleClient } from './vconsole'
import {
  cleanupStagedDemo,
  pruneStagedDemos,
  registerStagedDemo,
  stagingRootsForInstall,
  STAGED_DEMO_MAX_AGE_MS
} from './stagedDemos'

export interface LiveEvents {
  status: (s: LiveStatus) => void
  consoleLine?: (channel: string, text: string) => void
  gsi?: (s: unknown) => void
}

/**
 * 从 launch 的 tv_listen_voice_indices 位掩码推导静音槽位。
 * - bit=0 表示静音；bit=1 表示可听。
 * - 只统计 pulsesBySlot 中实际存在的 slot，避免把无关 bit 写进 HUD 数据。
 * - slot 0~31 用低 32 位，slot 32~63 用高 32 位；JS 位运算统一按 uint32 处理。
 */
export function deriveMutedSlots(
  pulsesBySlot: Record<string, number[]>,
  mask?: { low: number; high: number } | null
): number[] {
  if (!mask) return []
  const low = Number.isFinite(Number(mask.low)) ? Number(mask.low) >>> 0 : 0xffffffff
  const high = Number.isFinite(Number(mask.high)) ? Number(mask.high) >>> 0 : 0xffffffff
  const result: number[] = []
  for (const key of Object.keys(pulsesBySlot)) {
    const slot = Number(key)
    if (!Number.isInteger(slot) || slot < 0 || slot >= 64) continue
    const word = slot < 32 ? low : high
    const bit = slot < 32 ? slot : slot - 32
    if (((word >>> bit) & 1) === 0) result.push(slot)
  }
  result.sort((a, b) => a - b)
  return result
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
  private pendingTvVoiceIndices: { low: number; high: number } | null = null
  private detectTimer: NodeJS.Timeout | null = null
  /** 普通模式播放 cfg（dsh-play.cfg）退出后清理定时器 */
  private playCfgCleanupTimer: NodeJS.Timeout | null = null
  /** 本次会话中已暂存的 demo 路径（CS2 退出后清理） */
  private sessionStagedDemos = new Set<string>()
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
      if (!install) {
        if (process.env['DEBUG_LIVE'] === '1') {
          console.log('[live] 未找到 CS2 安装目录，跳过暂存 demo 清理')
        }
        return
      }
      const running = await isCs2Running()
      // 只读自检：gameinfo dsh 行、本项目 VPK、dsh_inject.bak 任一残留都清理。
      // addon 目录是额外内容，不计入 officialClean，也不会在这里被删除。
      const safety = await demoInjector.inspect(install)
      if (!running && !safety.officialClean) {
        const err = await demoInjector.cleanAll(install)
        if (process.env['DEBUG_LIVE'] === '1') {
          console.log(
            err ? `[live] 清理残留失败：${err}` : '[live] 已清理残留的语音 HUD 注入/备份'
          )
        }
      }
      // 顺带清理残留播放 cfg
      await fs.unlink(join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')).catch(() => {})

      // 启动时清理超过 7 天的暂存 demo；CS2 运行中不动，避免误删正在播放的文件。
      if (!running) {
        const result = await pruneStagedDemos(
          STAGED_DEMO_MAX_AGE_MS,
          stagingRootsForInstall(install)
        )
        if (
          process.env['DEBUG_LIVE'] === '1' &&
          (result.deleted.length > 0 || result.skipped.length > 0)
        ) {
          console.log(
            `[live] 暂存 demo 清理：删除 ${result.deleted.length}，跳过 ${result.skipped.length}`
          )
        }
      }
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
            if (this.pendingTvVoiceIndices) {
              const mask = this.pendingTvVoiceIndices
              this.pendingTvVoiceIndices = null
              this.vc?.sendCommand(`tv_listen_voice_indices ${mask.low}`)
              this.vc?.sendCommand(`tv_listen_voice_indices_h ${mask.high}`)
            }
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
   * 实时设置 CS2 录像回放语音位掩码（GOTV/SourceTV 官方消音指令）：
   * tv_listen_voice_indices <低32位> ; tv_listen_voice_indices_h <高32位>
   */
  setVoiceMask(low: number, high: number): { sent: boolean; cmd: string } {
    const cmd = `tv_listen_voice_indices ${low}; tv_listen_voice_indices_h ${high}`
    let sent = false
    if (this.vc && this.status.vconsoleConnected) {
      const s1 = this.vc.sendCommand(`tv_listen_voice_indices ${low}`)
      const s2 = this.vc.sendCommand(`tv_listen_voice_indices_h ${high}`)
      sent = s1 && s2
    }
    return { sent, cmd }
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
      // 复制/复用后登记清单，供会话退出或启动时清理。
      await this.registerStagedDemoSafe(dest, demoPath, install)
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
      // 复制/复用后登记清单，供会话退出或启动时清理。
      await this.registerStagedDemoSafe(dest, demoPath, install)
      return dest
    } catch {
      return null
    }
  }

  /** 登记暂存 demo；清单失败只记日志，不影响播放。 */
  private async registerStagedDemoSafe(
    stagedPath: string,
    sourceDemoPath: string,
    install: string
  ): Promise<void> {
    try {
      await registerStagedDemo(
        { path: stagedPath, sourceDemoPath },
        stagingRootsForInstall(install)
      )
    } catch (err) {
      console.warn('[live] 写入暂存 demo 清单失败', err)
    }
  }

  /**
   * 查找随应用分发的静态 addon 资源目录。
   * 开发态：assets/panorama/addon/dsh_voice_hud
   * 打包态：resources/panorama/addon/dsh_voice_hud（electron-builder extraResources）
   */
  private async findVoiceHudAddonSource(): Promise<string | null> {
    const candidates = [
      join(process.cwd(), 'assets', 'panorama', 'addon', VOICE_HUD_ADDON),
      join(process.resourcesPath ?? '', 'panorama', 'addon', VOICE_HUD_ADDON)
    ]
    for (const dir of candidates) {
      try {
        if ((await fs.stat(dir)).isDirectory()) return dir
      } catch {
        /* 下一个候选 */
      }
    }
    return null
  }

  /**
   * 用 CS2 自带的 resourcecompiler 把运行时 JS 编译成合法的 .vjs_c。
   * addon 直接读文件，必须使用完整资源头；手写 48B 头只有 VPK 路径能容忍。
   * 失败返回 null（调用方回退到旧格式，不阻塞 Demo 播放）。
   */
  private async compileVjsResource(install: string, source: string): Promise<Uint8Array | null> {
    const compiler = join(install, 'game', 'bin', 'win64', 'resourcecompiler.exe')
    try {
      await fs.access(compiler)
    } catch {
      return null
    }
    const tag = `dsh_runtime_${process.pid}_${Date.now()}`
    const contentDir = join(install, 'content', 'csgo_addons', tag)
    const gameDir = join(install, 'game', 'csgo_addons', tag)
    const vjsRel = join('panorama', 'scripts', 'hud', 'dsh_voice_data.vjs')
    try {
      await fs.mkdir(dirname(join(contentDir, vjsRel)), { recursive: true })
      await fs.writeFile(join(contentDir, vjsRel), source, 'utf-8')
      await fs.mkdir(join(contentDir, 'panorama'), { recursive: true })
      await fs.writeFile(
        join(contentDir, 'panorama', 'preprocessor_config.txt'),
        '"PanzipCfg"\n{\n    "BlockDefs"\n    {\n    }\n}\n',
        'ascii'
      )
      await new Promise<void>((resolve, reject) => {
        execFile(
          compiler,
          [
            '-game',
            join(install, 'game', 'csgo'),
            '-i',
            join(contentDir, vjsRel),
            '-f',
            '-nop4',
            '-v'
          ],
          { timeout: 120000, windowsHide: true },
          (err, _stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message))
            else resolve()
          }
        )
      })
      return await fs.readFile(join(gameDir, vjsRel + '_c'))
    } catch (err) {
      if (process.env['DEBUG_LIVE'] === '1') {
        console.warn('[live] compile vjs failed', err)
      }
      return null
    } finally {
      await fs.rm(contentDir, { recursive: true, force: true }).catch(() => {})
      await fs.rm(gameDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * 非侵入式 addon HUD 准备：
   *  1. 把静态 addon 资源复制到 game/csgo_addons/dsh_voice_hud/
   *  2. 运行时用 resourcecompiler 生成会话 dsh_voice_data.vjs_c
   *  3. 不修改 gameinfo.gi、不写 overrides、不碰官方 manifest
   * 返回错误信息或 null；任何失败都不会静默回退到注入。
   */
  async prepareVoiceHudAddon(
    demoPath: string,
    install: string,
    tvVoiceIndices?: { low: number; high: number } | null,
    muteMode: MuteHudMode = 'badge'
  ): Promise<string | null> {
    const source = await this.findVoiceHudAddonSource()
    if (!source) {
      return 'addon HUD 资源缺失：请先运行 node scripts/build-panorama.mjs --keep-addon 重新生成（未修改 gameinfo.gi）'
    }
    const dest = join(install, 'game', 'csgo_addons', VOICE_HUD_ADDON)
    try {
      await copyDirContents(source, dest)
      // 语音索引按 demo 指纹缓存，重复播放 HUD 时优先命中缓存
      const index = await extractVoiceIndexCached(demoPath)
      const mutedSlots = deriveMutedSlots(index.pulsesBySlot, tvVoiceIndices)
      const js = buildVoiceDataJs({
        voicePacketCount: index.voicePacketCount,
        pulsesBySlot: index.pulsesBySlot,
        players: {},
        mutedSlots,
        muteMode
      })
      // addon 直接读文件，必须用 resourcecompiler 生成完整资源头；
      // 手写 48B 头（buildVjsResource）只适合 VPK 路径，addon 会加载失败导致 HUD 不显示。
      const compiled = await this.compileVjsResource(install, js)
      const dataFile = join(dest, 'panorama', 'scripts', 'hud', 'dsh_voice_data.vjs_c')
      await fs.mkdir(dirname(dataFile), { recursive: true })
      await fs.writeFile(dataFile, compiled ?? buildVjsResource(js))
      if (!compiled && process.env['DEBUG_LIVE'] === '1') {
        console.warn('[live] addon vjs compile failed; fallback to legacy header (HUD may not load)')
      }

      const required = [
        'addoninfo.txt',
        'panorama/layout/hud/huddemocontroller.vxml_c',
        'panorama/scripts/hud/dsh_voice.vjs_c',
        'panorama/styles/hud/dsh_voice.vcss_c',
        'panorama/scripts/hud/dsh_voice_data.vjs_c'
      ]
      const missing: string[] = []
      for (const rel of required) {
        try {
          await fs.access(join(dest, ...rel.split('/')))
        } catch {
          missing.push(rel)
        }
      }
      if (missing.length > 0) {
        return `addon HUD 资源不完整：${missing.join('、')}（未修改 gameinfo.gi）`
      }
      return null
    } catch (err) {
      return `addon HUD 准备失败：${err instanceof Error ? err.message : String(err)}（未修改 gameinfo.gi）`
    }
  }

  /**
   * 游戏内语音 HUD 准备（显式 fallback / 实验模式）：
   * 提取语音说话者索引 → 生成会话 VPK（vjs_c 内嵌数据）
   * → 部署静态 VPK + 会话 VPK + gameinfo.gi SearchPath 注入。
   */
  private async prepareVoiceHud(
    demoPath: string,
    install: string,
    tvVoiceIndices?: { low: number; high: number } | null,
    muteMode: MuteHudMode = 'badge'
  ): Promise<string | null> {
    try {
      // 语音索引按 demo 指纹缓存，重复播放 HUD 时优先命中缓存
      const index = await extractVoiceIndexCached(demoPath)
      const mutedSlots = deriveMutedSlots(index.pulsesBySlot, tvVoiceIndices)
      const js = buildVoiceDataJs({
        voicePacketCount: index.voicePacketCount,
        pulsesBySlot: index.pulsesBySlot,
        players: {},
        mutedSlots,
        muteMode
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

  /**
   * CS2 退出后自动清理会话残留（dsh-play.cfg + 注入恢复 + steam_appid.txt 及 tool 缓存），
   * 并删除本次会话暂存的 demo 副本（原始 demo 不在清理范围内）。
   */
  private scheduleSessionCleanup(
    install: string,
    stagedPaths: string[] = [],
    cleanupInjection = false
  ): void {
    if (this.playCfgCleanupTimer) clearTimeout(this.playCfgCleanupTimer)
    for (const stagedPath of stagedPaths) {
      if (stagedPath) this.sessionStagedDemos.add(resolve(stagedPath))
    }
    let seenRunning = false
    let attempts = 0
    const maxWaitAttempts = 30 // 最多等待约 90 秒供 CS2 启动加载

    const finish = () => {
      if (cleanupInjection) {
        // 仅显式 inject 会话才调用 cleanAll（会移除本项目 SearchPath/VPK/备份）。
        void demoInjector.cleanAll(install).catch(() => {})
      } else {
        // addon / 原生模式只清理本次播放 cfg 与日志，不触碰 gameinfo.gi。
        void fs.unlink(join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')).catch(() => {})
        void fs.unlink(join(install, 'game', 'csgo', 'dsh_hud.log')).catch(() => {})
      }
      // 暂存 demo 由清单模块按路径安全校验后删除。
      void this.cleanupSessionStagedDemos(install)
    }

    const check = () => {
      attempts++
      void isCs2Running().then((running) => {
        if (running) {
          seenRunning = true
          this.playCfgCleanupTimer = setTimeout(check, 3000)
        } else if (seenRunning) {
          // CS2 曾运行过，现在已完全退出：彻底清理残留并还原官方纯净文件
          finish()
        } else if (attempts < maxWaitAttempts) {
          // CS2 仍在启动初始化过程中，继续等待，绝不在启动阶段过早删除 dsh-play.cfg
          this.playCfgCleanupTimer = setTimeout(check, 3000)
        } else {
          // 超时（用户取消启动或启动失败），执行保护性清理
          finish()
        }
      })
    }

    // 启动 5 秒后开始首次轮询
    this.playCfgCleanupTimer = setTimeout(check, 5000)
  }

  /** 清理本次会话登记的暂存 demo（只删清单内、staging 根目录下的副本） */
  private async cleanupSessionStagedDemos(install: string): Promise<void> {
    const paths = [...this.sessionStagedDemos]
    this.sessionStagedDemos.clear()
    if (paths.length === 0) return

    const roots = stagingRootsForInstall(install)
    for (const stagedPath of paths) {
      try {
        const result = await cleanupStagedDemo(stagedPath, roots)
        if (process.env['DEBUG_LIVE'] === '1') {
          if (result.deleted) {
            console.log(`[live] 已清理暂存 demo：${stagedPath}`)
          } else {
            console.log(
              `[live] 暂存 demo 未删除：${stagedPath}（${result.reason ?? 'unknown'}）`
            )
          }
        }
      } catch (err) {
        console.warn('[live] 清理暂存 demo 失败', err)
      }
    }
  }

  /** 一键启动/原生回放 */
  async launch(
    opts?: {
      toolsMode?: boolean
      playDemoPath?: string
      hudMode?: HudMode
      muteHudMode?: MuteHudMode
      startTick?: number
      tvVoiceIndices?: { low: number; high: number }
    },
    userArgs?: string,
    installPath?: string,
    _display?: { mode?: string; resolution?: string }
  ): Promise<LaunchResult> {
    const toolsMode = opts?.toolsMode ?? false
    const demoPath = opts?.playDemoPath
    const hudMode: HudMode = opts?.hudMode ?? 'addon'
    const muteHudMode: MuteHudMode = opts?.muteHudMode === 'hide' ? 'hide' : 'badge'
    const hudEnabled = hudMode !== 'off'
    const startTick = typeof opts?.startTick === 'number' && opts.startTick > 0 ? opts.startTick : undefined
    const extra: string[] = (userArgs ?? '').match(/\S+/g) ?? []

    if (demoPath) {
      const running = await isCs2Running()
      // ① CS2 正在运行
      if (running) {
        if (this.status.vconsoleConnected) {
          const install = await locateCs2Install(installPath ?? this.installPath)
          const name = install ? await this.stageDemoForPlay(demoPath, install) : null
          if (name && install) {
            const stagedPath = join(install, 'game', 'csgo', name)
            // CS2 已在运行：同样登记会话清理，退出后删除本次暂存副本。
            this.scheduleSessionCleanup(install, [stagedPath])
            if (opts?.tvVoiceIndices) {
              this.sendCommand(`tv_listen_voice_indices ${opts.tvVoiceIndices.low}`)
              this.sendCommand(`tv_listen_voice_indices_h ${opts.tvVoiceIndices.high}`)
            }
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
          if (toolsMode && !hudEnabled) {
            await demoInjector.cleanAll(install).catch(() => {})
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
            this.pendingTvVoiceIndices = opts?.tvVoiceIndices ?? null

            const args: string[] = ['-tools', '-noassetbrowser', '-novid', ...extra]
            const child = spawn(exe, args, {
              cwd: dirname(exe),
              detached: true,
              stdio: 'ignore',
              windowsHide: false
            })
            child.on('error', () => {})
            child.unref()

            // 针对 -tools 引擎自动写入的 steam_appid.txt 及时防守清理
            setTimeout(() => {
              void fs.unlink(join(install, 'game', 'bin', 'win64', 'steam_appid.txt')).catch(() => {})
            }, 3000)

            setTimeout(() => void this.connect(), 1500)
            this.scheduleSessionCleanup(install, [join(install, 'game', 'csgo', name)], true)
            return { ok: true, url: '', direct: true, exe, demoFile: name, starting: true }
          }

          // 2.2 普通原生模式 / addon HUD / inject fallback：+exec dsh-play.cfg 秒播
          const staged = await this.stageDemoForPlayNoSpace(demoPath, install)
          if (!staged) {
            return {
              ok: false,
              url: '',
              error: '无法准备 demo 文件（写入暂存目录失败）。请检查磁盘空间或 CS2 路径设置。'
            }
          }
          // 启动前只读检查：addon/off 不允许静默带着本项目注入残留启动。
          // 这里不调用 cleanAll，避免原生/addon 模式在启动阶段修改 gameinfo.gi。
          const safety = await demoInjector.inspect(install)
          if (hudMode !== 'inject' && safety.activeInjection) {
            return {
              ok: false,
              url: '',
              error:
                '检测到本项目注入残留（gameinfo.gi SearchPath 或 overrides VPK）。请先在 设置 → Steam 安全自检 执行“一键清理”，再启动。'
            }
          }
          if (hudMode === 'addon') {
            // 非侵入式：只写 game/csgo_addons/dsh_voice_hud/，不修改 gameinfo.gi
            const err = await this.prepareVoiceHudAddon(
              demoPath,
              install,
              opts?.tvVoiceIndices,
              muteHudMode
            )
            if (err) return { ok: false, url: '', error: err }
          } else if (hudMode === 'inject') {
            // 显式 fallback / 实验模式：部署 VPK + gameinfo.gi SearchPath
            const err = await this.prepareVoiceHud(
              demoPath,
              install,
              opts?.tvVoiceIndices,
              muteHudMode
            )
            if (err) return { ok: false, url: '', error: err }
          }
          // 写播放 cfg（完美平台同款原生机制；退出后自动清理）
          const cfgFile = join(install, 'game', 'csgo', 'cfg', 'dsh-play.cfg')
          const low = opts?.tvVoiceIndices?.low ?? -1
          const high = opts?.tvVoiceIndices?.high ?? -1
          const cfgLines = [
            'demo_ui_mode 2',
            'cl_demo_predict 0',
            `tv_listen_voice_indices ${low}`,
            `tv_listen_voice_indices_h ${high}`,
            `playdemo "${staged}"`
          ]
          if (startTick) {
            cfgLines.push(`demo_gototick ${startTick}`)
            cfgLines.push(`bind "F8" "demo_gototick ${startTick}"`)
          }
          await fs.writeFile(cfgFile, cfgLines.join('\n') + '\n', 'utf-8')

          const tickArgs = startTick ? ['+demo_gototick', String(startTick)] : []

          // 直接启动 cs2.exe 传参（完美/5E同款：cs2.exe 原生接收 +exec 启动参数秒进 Demo）
          // -insecure 仅影响本次播放会话，不修改任何游戏文件；addon 模式额外加 -addon。
          const hudArgs =
            hudMode === 'inject'
              ? ['-insecure', '-consolelog', 'dsh_hud.log']
              : hudMode === 'addon'
                ? ['-insecure', '-addon', VOICE_HUD_ADDON]
                : []
          const playArgs: string[] = [
            ...hudArgs,
            '+exec',
            'dsh-play.cfg',
            '+cl_demo_predict',
            '0',
            '-novid',
            ...tickArgs,
            ...extra
          ]

          const child = spawn(exe, playArgs, {
            cwd: dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.on('error', () => {})
          child.unref()
          this.scheduleSessionCleanup(install, [staged], hudMode === 'inject')
          return { ok: true, url: '', direct: true, exe, demoFile: staged }
        } catch (err) {
          if (hudMode !== 'off') {
            const detail = err instanceof Error ? err.message : String(err)
            return {
              ok: false,
              url: '',
              error: `语音 HUD 启动失败：${detail}。${
                hudMode === 'inject'
                  ? 'Inject 可能已部分部署，请在 设置 → Steam 安全自检 执行“一键清理”。'
                  : '未修改 gameinfo.gi；可重试或切换 Inject 实验模式。'
              }`
            }
          }
          /* 原生模式回退 steam:// */
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
        if (toolsMode) {
          await demoInjector.cleanAll(install).catch(() => {})
          const args: string[] = ['-tools', '-noassetbrowser', '-novid', ...extra]
          const child = spawn(exe, args, {
            cwd: dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          })
          child.on('error', () => {})
          child.unref()
          setTimeout(() => {
            void fs.unlink(join(install, 'game', 'bin', 'win64', 'steam_appid.txt')).catch(() => {})
          }, 3000)
          setTimeout(() => void this.connect(), 1500)
          this.scheduleSessionCleanup(install, [], true)
          return { ok: true, url: '', direct: true, exe }
        }

        // 原生启动不修改游戏文件；若检测到本项目注入残留，明确提示用户先清理。
        const safety = await demoInjector.inspect(install)
        if (safety.activeInjection) {
          return {
            ok: false,
            url: '',
            error:
              '检测到本项目注入残留（gameinfo.gi SearchPath 或 overrides VPK）。请先在 设置 → Steam 安全自检 执行“一键清理”，再启动。'
          }
        }
        const args: string[] = ['-novid', ...extra]
        const child = spawn(exe, args, {
          cwd: dirname(exe),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.on('error', () => {})
        child.unref()
        this.scheduleSessionCleanup(install, [], false)
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

  /** Steam 安全自检（只读）：gameinfo dsh 行、备份、本项目 VPK、官方纯净判定。 */
  async getSteamSafety(): Promise<SteamSafetyReport> {
    const running = await isCs2Running()
    const install = await locateCs2Install(this.installPath)
    if (!install) {
      return {
        installPath: null,
        gameinfoExists: false,
        gameinfoHasDsh: false,
        backupExists: false,
        projectVpks: [],
        overridesHasProjectVpk: false,
        addonPresent: false,
        officialClean: false,
        activeInjection: false,
        cs2Running: running,
        error: '未找到 CS2 安装目录，请在设置中指定有效路径。'
      }
    }
    try {
      const report = await demoInjector.inspect(install)
      return { ...report, cs2Running: running }
    } catch (err) {
      return {
        installPath: install,
        gameinfoExists: false,
        gameinfoHasDsh: false,
        backupExists: false,
        projectVpks: [],
        overridesHasProjectVpk: false,
        addonPresent: false,
        officialClean: false,
        activeInjection: false,
        cs2Running: running,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * 一键清理本项目注入残留（SearchPath 行/本项目 VPK/本项目备份）。
   * 不覆盖 gameinfo.gi、不删除第三方 VPK、不碰 steam_appid.txt/_toolsettings/pak01/bin。
   */
  async restoreCleanFiles(): Promise<{ ok: boolean; message: string }> {
    const install = await locateCs2Install(this.installPath)
    if (!install) {
      return { ok: false, message: '未找到 CS2 安装目录，请在设置中指定有效路径。' }
    }
    const running = await isCs2Running()
    if (running) {
      return { ok: false, message: 'CS2 正在运行中，请先退出游戏后再执行清理。' }
    }
    const err = await demoInjector.cleanAll(install)
    if (err) return { ok: false, message: err }
    const report = await demoInjector.inspect(install)
    if (report.activeInjection) {
      return {
        ok: false,
        message:
          '已移除本项目 SearchPath/VPK/备份，但仍检测到其他 dsh 注入行；未改动第三方内容，请手动检查 gameinfo.gi。'
      }
    }
    const addonNote = report.addonPresent ? ' addon 目录作为额外内容保留，未改动官方文件。' : ''
    return {
      ok: true,
      message:
        (report.officialClean
          ? '已清理本项目注入残留，gameinfo.gi 未覆盖、未改动官方其他内容。'
          : '已清理本项目 SearchPath/VPK/备份；gameinfo.gi 缺失或其他残留未自动处理。') + addonNote
    }
  }

  getStatus(): LiveStatus {
    return { ...this.status }
  }

  private emitStatus(): void {
    this.events.status({ ...this.status })
  }
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

/** 递归复制目录内容（不删除目标目录中已有文件，避免误删用户/第三方内容）。 */
async function copyDirContents(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirContents(from, to)
    } else if (entry.isFile()) {
      await fs.mkdir(dirname(to), { recursive: true })
      await fs.copyFile(from, to)
    }
  }
}

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