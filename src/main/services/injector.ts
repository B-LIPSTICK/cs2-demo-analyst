/**
 * CS2 注入器：gameinfo.gi SearchPath 注入/恢复 + 静态/会话 VPK 部署 + 清理 + Steam 安全自检。
 *
 * 机制（完美/5E 同类，参考 SwiftDemoUIPro 验证）:
 *  - VPK 放 <cs2>/game/csgo/overrides/<name>.vpk
 *  - gameinfo.gi 在 "Game csgo" 行前插入:
 *      Game\tcsgo/overrides/dsh_voice_session.vpk    （会话 VPK 最前 = 最高优先级）
 *      Game\tcsgo/overrides/dsh_voice_override.vpk   （静态 VPK）
 *  - 保持原缩进/换行/编码；首次备份 .dsh_inject.bak
 *  - 恢复 = 精确删除自己的行；CS2 运行中拒绝
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { SteamSafetyReport } from '@shared/types'

export const STATIC_VPK = 'dsh_voice_override.vpk'
export const SESSION_VPK = 'dsh_voice_session.vpk'
export const INJECT_BACKUP = 'gameinfo.gi.dsh_inject.bak'
/** 非侵入式 addon 目录名（game/csgo_addons/<name>） */
export const VOICE_HUD_ADDON = 'dsh_voice_hud'

function searchLine(vpk: string): string {
  return `Game\tcsgo/overrides/${vpk}`
}

const SEARCH_RE = /^\s*Game\s+csgo\/overrides\/(?:dsh_voice_override\.vpk|dsh_voice_session\.vpk)\s*$/i
const BASE_GAME_RE = /^(\s*)Game\s+csgo\s*(?:\/\/.*)?$/i
/** 自检用：任何形如 `Game ... dsh...` 的 SearchPath 都视为 dsh 残留（不用于自动删除）。 */
const GAME_DSH_RE = /^\s*Game\s+[^\r\n]*\bdsh/im

function isNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

interface TextFile {
  text: string
  newline: '\r\n' | '\n'
  bom: '' | 'utf8' | 'utf16le'
}

/** 读取文本并保留 BOM/换行；文件不存在返回 null，其他读取错误抛出 */
async function readTextPreservingStrict(file: string): Promise<TextFile | null> {
  let buf: Buffer
  try {
    buf = await fs.readFile(file)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  let bom: TextFile['bom'] = ''
  let body = buf
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    bom = 'utf8'
    body = buf.subarray(3)
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    bom = 'utf16le'
    body = buf.subarray(2)
  }
  const text = bom === 'utf16le' ? body.toString('utf16le') : body.toString('utf8')
  const newline: TextFile['newline'] = text.includes('\r\n') ? '\r\n' : '\n'
  return { text, newline, bom }
}

/** 读取文本并保留 BOM/换行；读取失败返回 null（保持既有调用方语义） */
async function readTextPreserving(file: string): Promise<TextFile | null> {
  try {
    return await readTextPreservingStrict(file)
  } catch {
    return null
  }
}

async function writeTextPreserving(file: string, tf: TextFile, text: string): Promise<void> {
  let body: Buffer
  if (tf.bom === 'utf16le') {
    body = Buffer.from('\ufeff' + text, 'utf16le')
  } else {
    body = Buffer.from((tf.bom === 'utf8' ? '\ufeff' : '') + text, 'utf8')
  }
  const tmp = file + '.dsh.tmp'
  try {
    await fs.writeFile(tmp, body)
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

/** 注入两行 SearchPath（幂等）；返回是否发生了修改 */
function addSearchPaths(text: string): { text: string; changed: boolean } {
  const lines = text.split(/\r\n|\n/)
  const hasOverride = lines.some((l) => SEARCH_RE.test(l))
  if (hasOverride) return { text, changed: false }
  let indentation = '\t'
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    const m = BASE_GAME_RE.exec(lines[i])
    if (m) {
      indentation = m[1]
      index = i
      break
    }
  }
  if (index < 0) return { text, changed: false }
  lines.splice(index, 0, indentation + searchLine(SESSION_VPK), indentation + searchLine(STATIC_VPK))
  return { text: lines.join('\n'), changed: true }
}

/** 移除自己的 SearchPath 行（保留原换行风格）；返回是否发生了修改 */
function removeSearchPaths(
  text: string,
  newline: TextFile['newline']
): { text: string; changed: boolean } {
  const lines = text.split(/\r\n|\n/)
  const kept = lines.filter((l) => !SEARCH_RE.test(l))
  return { text: kept.join(newline), changed: kept.length !== lines.length }
}

export class DemoInjector {
  /** 部署 VPK + 注入 SearchPath；返回错误信息或 null */
  async install(
    installPath: string,
    opts: { staticVpk: Buffer; sessionVpk: Buffer }
  ): Promise<string | null> {
    const csgo = join(installPath, 'game', 'csgo')
    const gameInfo = join(csgo, 'gameinfo.gi')
    try {
      await fs.access(join(installPath, 'game', 'bin', 'win64', 'cs2.exe'))
    } catch {
      return 'CS2 安装路径无效'
    }

    // ① 备份（首次）
    const backup = join(csgo, INJECT_BACKUP)
    try {
      await fs.access(backup)
    } catch {
      try {
        await fs.copyFile(gameInfo, backup)
      } catch {
        return '无法备份 gameinfo.gi（检查目录权限）'
      }
    }

    // ② 写 VPK（原子）
    const overrides = join(csgo, 'overrides')
    await fs.mkdir(overrides, { recursive: true })
    const writeVpk = async (name: string, data: Buffer) => {
      const tmp = join(overrides, name + '.tmp')
      await fs.writeFile(tmp, data)
      await fs.rename(tmp, join(overrides, name))
    }
    // 失败回滚：删除本次已写的 VPK（防止半注入残留）
    const rollbackVpks = async () => {
      for (const name of [STATIC_VPK, SESSION_VPK]) {
        await fs.unlink(join(overrides, name)).catch(() => {})
      }
    }
    try {
      await writeVpk(STATIC_VPK, opts.staticVpk)
      await writeVpk(SESSION_VPK, opts.sessionVpk)
    } catch {
      await rollbackVpks()
      return '无法写入 VPK 到 CS2 overrides 目录'
    }

    // ③ 注入 SearchPath（保持编码/换行/缩进）
    const tf = await readTextPreserving(gameInfo)
    if (!tf) {
      await rollbackVpks()
      return '无法读取 gameinfo.gi'
    }
    const { text, changed } = addSearchPaths(tf.text)
    if (!changed) return null // 已注入过（幂等）
    try {
      await writeTextPreserving(gameInfo, tf, text)
    } catch {
      await rollbackVpks()
      return '无法写入 gameinfo.gi'
    }
    return null
  }

  /**
   * 清理本项目自己的注入文件。
   *
   * 只处理本工具明确创建的文件：
   *  - overrides 下的两个 dsh_voice_*.vpk（保留目录与其他工具的 VPK）
   *  - gameinfo.gi 中本项目注入的 SearchPath 行（不用旧备份覆盖当前文件）
   *  - 本工具生成的 dsh-play.cfg / dsh_hud.log / dsh_inject.bak
   * 不触碰 _toolsettings、tools_thumbnail_cache.sqlite3 等来源不明的文件。
   * 返回错误信息；全部成功返回 null。
   */
  async cleanAll(installPath: string): Promise<string | null> {
    const csgo = join(installPath, 'game', 'csgo')
    const gameInfo = join(csgo, 'gameinfo.gi')
    const backup = join(csgo, INJECT_BACKUP)
    const errors: string[] = []

    // ① 只删除本项目自己的两个 VPK，保留 overrides 目录与其他工具的 VPK
    for (const name of [STATIC_VPK, SESSION_VPK]) {
      const file = join(csgo, 'overrides', name)
      try {
        await fs.unlink(file)
      } catch (err) {
        if (!isNotFound(err)) errors.push(`无法删除 ${file}：${errorText(err)}`)
      }
    }

    // ② gameinfo.gi 只移除本项目 SEARCH_RE 匹配的行，不用旧备份覆盖
    let gameInfoCleaned = false
    let gameInfoExists = false
    try {
      const tf = await readTextPreservingStrict(gameInfo)
      if (tf) {
        gameInfoExists = true
        const { text, changed } = removeSearchPaths(tf.text, tf.newline)
        if (changed) await writeTextPreserving(gameInfo, tf, text)
        gameInfoCleaned = true
      }
    } catch (err) {
      errors.push(`无法清理 ${gameInfo}：${errorText(err)}`)
    }

    // ③ 备份仅作为本项目自己的残留文件清理，绝不用于覆盖；
    //    gameinfo.gi 缺失时保留备份，避免误删唯一的原始副本。
    if (gameInfoCleaned && gameInfoExists) {
      try {
        await fs.unlink(backup)
      } catch (err) {
        if (!isNotFound(err)) errors.push(`无法删除 ${backup}：${errorText(err)}`)
      }
    }

    // ④ 清理本工具生成的临时播放 cfg 与 HUD 日志
    for (const file of [
      join(csgo, 'cfg', 'dsh-play.cfg'),
      join(csgo, 'dsh_hud.log'),
      join(csgo, 'gameinfo.gi.dsh.tmp')
    ]) {
      try {
        await fs.unlink(file)
      } catch (err) {
        if (!isNotFound(err)) errors.push(`无法删除 ${file}：${errorText(err)}`)
      }
    }

    // steam_appid.txt / game/_toolsettings / tools_thumbnail_cache.sqlite3
    // 无法可靠确认由本项目创建（Steam/CS2 自身也可能生成），按保守原则不删除。

    return errors.length ? `清理失败：${errors.join('；')}` : null
  }

  /** 移除自己的 SearchPath + 删除 VPK */
  async uninstall(installPath: string): Promise<void> {
    await this.cleanAll(installPath)
  }

  /** 当前是否已注入（用于启动前检查/状态展示） */
  async isInjected(installPath: string): Promise<boolean> {
    const tf = await readTextPreserving(join(installPath, 'game', 'csgo', 'gameinfo.gi'))
    return tf ? SEARCH_RE.test(tf.text) : false
  }

  /**
   * Steam 安全自检（只读）：
   *  - gameinfo.gi 是否含 dsh 行
   *  - gameinfo.gi.dsh_inject.bak 是否残留
   *  - overrides 是否含本项目 VPK
   *  - 是否达到“无本项目注入残留”的官方纯净判定
   * 不修改任何游戏文件；addon 目录仅作为额外内容单独报告。
   */
  async inspect(installPath: string): Promise<Omit<SteamSafetyReport, 'cs2Running'>> {
    const csgo = join(installPath, 'game', 'csgo')
    const gameInfo = join(csgo, 'gameinfo.gi')
    const backup = join(csgo, INJECT_BACKUP)
    const overrides = join(csgo, 'overrides')
    const addonDir = join(installPath, 'game', 'csgo_addons', VOICE_HUD_ADDON)

    let gameinfoExists = false
    let gameinfoHasDsh = false
    let error: string | undefined
    try {
      const tf = await readTextPreservingStrict(gameInfo)
      if (tf) {
        gameinfoExists = true
        gameinfoHasDsh = GAME_DSH_RE.test(tf.text)
      }
    } catch (err) {
      error = `无法读取 gameinfo.gi：${errorText(err)}`
    }

    const backupExists = await pathExists(backup)
    const projectVpks: string[] = []
    for (const name of [STATIC_VPK, SESSION_VPK]) {
      if (await pathExists(join(overrides, name))) projectVpks.push(name)
    }
    const overridesHasProjectVpk = projectVpks.length > 0
    const addonPresent = await dirExists(addonDir)
    const addonFiles: { path: string; exists: boolean; size: number }[] = []
    if (addonPresent) {
      const expected = [
        'addoninfo.txt',
        'panorama/layout/hud/huddemocontroller.vxml_c',
        'panorama/scripts/hud/dsh_voice.vjs_c',
        'panorama/scripts/hud/dsh_voice_data.vjs_c',
        'panorama/styles/hud/dsh_voice.vcss_c'
      ]
      for (const rel of expected) {
        const full = join(addonDir, rel)
        try {
          const st = await fs.stat(full)
          addonFiles.push({ path: full, exists: st.isFile() && st.size > 0, size: st.size })
        } catch {
          addonFiles.push({ path: full, exists: false, size: 0 })
        }
      }
    }
    const addonComplete = addonPresent && addonFiles.length > 0 && addonFiles.every((f) => f.exists)
    const activeInjection = gameinfoHasDsh || overridesHasProjectVpk
    const officialClean =
      gameinfoExists && !gameinfoHasDsh && !backupExists && !overridesHasProjectVpk

    return {
      installPath,
      gameinfoExists,
      gameinfoHasDsh,
      backupExists,
      projectVpks,
      overridesHasProjectVpk,
      addonPresent,
      addonDir,
      addonFiles,
      addonComplete,
      officialClean,
      activeInjection,
      error
    }
  }

  /** 读取静态 VPK 资产（随应用分发） */
  async readStaticVpk(): Promise<Buffer | null> {
    // 开发: 项目 assets/panorama/；打包: extraResources 或 asar 内
    const candidates = [
      join(process.cwd(), 'assets', 'panorama', STATIC_VPK),
      join(process.resourcesPath ?? '', 'panorama', STATIC_VPK)
    ]
    for (const p of candidates) {
      try {
        return await fs.readFile(p)
      } catch {
        /* next */
      }
    }
    return null
  }
}

export const demoInjector = new DemoInjector()