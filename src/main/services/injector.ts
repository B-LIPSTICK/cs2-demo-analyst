/**
 * CS2 注入器：gameinfo.gi SearchPath 注入/恢复 + 静态/会话 VPK 部署 + 清理。
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

export const STATIC_VPK = 'dsh_voice_override.vpk'
export const SESSION_VPK = 'dsh_voice_session.vpk'
export const INJECT_BACKUP = 'gameinfo.gi.dsh_inject.bak'

function searchLine(vpk: string): string {
  return `Game\tcsgo/overrides/${vpk}`
}

const SEARCH_RE = /^\s*Game\s+csgo\/overrides\/(?:dsh_voice_override\.vpk|dsh_voice_session\.vpk)\s*$/i
const BASE_GAME_RE = /^(\s*)Game\s+csgo\s*(?:\/\/.*)?$/i

interface TextFile {
  text: string
  newline: '\r\n' | '\n'
  bom: '' | 'utf8' | 'utf16le'
}

async function readTextPreserving(file: string): Promise<TextFile | null> {
  let buf: Buffer
  try {
    buf = await fs.readFile(file)
  } catch {
    return null
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

async function writeTextPreserving(file: string, tf: TextFile, text: string): Promise<void> {
  let body: Buffer
  if (tf.bom === 'utf16le') {
    body = Buffer.from('\ufeff' + text, 'utf16le')
  } else {
    body = Buffer.from((tf.bom === 'utf8' ? '\ufeff' : '') + text, 'utf8')
  }
  const tmp = file + '.dsh.tmp'
  await fs.writeFile(tmp, body)
  await fs.rename(tmp, file)
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

/** 移除自己的 SearchPath 行；返回是否发生了修改 */
function removeSearchPaths(text: string): { text: string; changed: boolean } {
  const lines = text.split(/\r\n|\n/)
  const kept = lines.filter((l) => !SEARCH_RE.test(l))
  return { text: kept.join('\n'), changed: kept.length !== lines.length }
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

  /** 移除自己的 SearchPath + 删除 VPK（CS2 未运行时调用，由调用方保证） */
  async uninstall(installPath: string): Promise<void> {
    const csgo = join(installPath, 'game', 'csgo')
    const gameInfo = join(csgo, 'gameinfo.gi')
    const tf = await readTextPreserving(gameInfo)
    if (tf) {
      const { text, changed } = removeSearchPaths(tf.text)
      if (changed) {
        await writeTextPreserving(gameInfo, tf, text).catch(() => {})
      }
    }
    for (const name of [STATIC_VPK, SESSION_VPK]) {
      await fs.unlink(join(csgo, 'overrides', name)).catch(() => {})
    }
  }

  /** 当前是否已注入（用于启动前检查/状态展示） */
  async isInjected(installPath: string): Promise<boolean> {
    const tf = await readTextPreserving(join(installPath, 'game', 'csgo', 'gameinfo.gi'))
    return tf ? SEARCH_RE.test(tf.text) : false
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
