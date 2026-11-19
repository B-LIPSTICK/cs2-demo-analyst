/**
 * 引擎/模型管理：csgove、whisper-cli、ggml 模型 的按需下载与缓存
 */
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { downloadWithMirrors, type DownloadProgress } from './download'
import type { LocalWhisperModel } from '@shared/types'

// v3.1.7 修了 demoinfocs-golang 在新版 CS2 demo 上 sendtables2 解析越界（nextByte:
// insufficient buffer）导致 split-full 一个 WAV 都产不出的问题；旧版遇到这类 demo 会
// 静默退出码 0 + 空输出目录，用户看到的是「该 Demo 未提取到任何语音」。
export const CSGOVE_VERSION = 'v3.1.7'
export const WHISPER_VERSION = 'v1.9.2'

export const MODEL_FILES: Record<LocalWhisperModel, string> = {
  base: 'ggml-base.bin',
  small: 'ggml-small.bin',
  medium: 'ggml-medium.bin'
}

export const MODEL_SIZES: Record<LocalWhisperModel, number> = {
  base: 142 * 1024 * 1024,
  small: 466 * 1024 * 1024,
  medium: 1530 * 1024 * 1024
}

const GH = 'https://github.com'
// 镜像前缀（国内网络可用），主源失败后依次回退
const MIRRORS = [
  'https://ghfast.top/https://github.com',
  'https://gh-proxy.com/https://github.com',
  'https://mirror.ghproxy.com/https://github.com'
]

function enginesDir(): string {
  return join(app.getPath('userData'), 'engines')
}

/** csgove 安装目录（含 exe 与 dll） */
export function csgoveDir(): string {
  return join(enginesDir(), 'csgove')
}

export function csgoveExe(): string {
  return join(csgoveDir(), 'csgove.exe')
}

/** whisper-cli 目录 */
export function whisperDir(): string {
  return join(enginesDir(), 'whisper')
}

export function whisperExe(): string {
  return join(whisperDir(), 'whisper-cli.exe')
}

export function whisperModelPath(model: LocalWhisperModel): string {
  return join(whisperDir(), 'models', MODEL_FILES[model])
}

function ghUrls(path: string): string[] {
  // 注意: 必须用 '/' 拼接，Windows 下 join 会破坏 URL
  return [`${GH}/${path}`, ...MIRRORS.map((m) => `${m}/${path}`)]
}

async function isValidFile(path: string, minBytes = 1024): Promise<boolean> {
  try {
    const st = await fs.stat(path)
    if (st.size >= minBytes) return true
    // 文件虽然存在但小于预期阈值（半拉下载损坏/0字节），清理并返回 false 触发重下
    await fs.unlink(path).catch(() => {})
    return false
  } catch {
    return false
  }
}

export interface EngineEnsureProgress {
  what: string
  received: number
  total: number
}

const locks = new Map<string, Promise<unknown>>()
const activeControllers = new Map<string, AbortController>()

/** 取消正在执行的下载任务 */
export function cancelEngine(kind: string): boolean {
  let cancelled = false
  for (const [key, ctrl] of activeControllers.entries()) {
    if (kind === 'all' || key === kind || (kind === 'whisper' && key === 'whisper-cli')) {
      ctrl.abort()
      activeControllers.delete(key)
      cancelled = true
    }
  }
  return cancelled
}

/** 在资源管理器中打开引擎与模型根目录（自动确保 whisper/models 子目录存在） */
export async function openEnginesFolder(): Promise<string> {
  const dir = enginesDir()
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(join(whisperDir(), 'models'), { recursive: true })
  await fs.mkdir(csgoveDir(), { recursive: true })
  await shell.openPath(dir)
  return dir
}

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  locks.set(
    key,
    run.catch(() => {})
  )
  return run
}

/**
 * 引擎目录里的版本标记文件名。
 * csgove.exe 存在不代表是对应的版本——旧版本文件同样「存在且够大」。
 * 没有这个标记就无法把已装了旧版的用户推到新版，所以每次升级 CSGOVE_VERSION
 * 都必须靠它来判定「该重下」。
 */
const VERSION_MARKER = '.version'

async function readMarker(dir: string): Promise<string> {
  try {
    return (await fs.readFile(join(dir, VERSION_MARKER), 'utf8')).trim()
  } catch {
    return ''
  }
}

async function writeMarker(dir: string, version: string): Promise<void> {
  await fs.writeFile(join(dir, VERSION_MARKER), version, 'utf8').catch(() => {})
}

/** 确保 csgove 就绪（下载 + 解压，幂等） */
export function ensureCsgove(onProgress?: (p: EngineEnsureProgress) => void): Promise<void> {
  return withLock('csgove', async () => {
    const marker = await readMarker(csgoveDir())
    // 版本号对不上就当作需要重装：旧版解析不了新 demo，留着只会让用户继续看到空结果
    if (marker === CSGOVE_VERSION && (await isValidFile(csgoveExe(), 100 * 1024))) return
    const ctrl = new AbortController()
    activeControllers.set('csgove', ctrl)
    try {
      await fs.mkdir(csgoveDir(), { recursive: true })
      const zipPath = join(csgoveDir(), 'csgove.zip')
      // 先下载再清旧文件：下载失败时旧版仍可用，不会把用户推进「什么都没有」的状态
      await downloadWithMirrors(
        ghUrls(`akiver/csgo-voice-extractor/releases/download/${CSGOVE_VERSION}/win32-x64.zip`),
        zipPath,
        (p) => onProgress?.({ what: 'csgove', received: p.received, total: p.total }),
        ctrl.signal
      )
      // 清掉旧版本的 exe/dll，避免新旧混装（csgove 会从 CWD 找同名 dll）
      for (const f of await fs.readdir(csgoveDir()).catch(() => [] as string[])) {
        if (f === VERSION_MARKER || f === 'csgove.zip') continue
        await fs.rm(join(csgoveDir(), f), { recursive: true, force: true }).catch(() => {})
      }
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(csgoveDir(), true)
      // 把 zip 内 win32-x64/ 下的文件平铺
      const inner = join(csgoveDir(), 'win32-x64')
      try {
        const entries = await fs.readdir(inner)
        for (const e of entries) {
          await fs.rename(join(inner, e), join(csgoveDir(), e)).catch(() => {})
        }
        await fs.rmdir(inner).catch(() => {})
      } catch {
        /* 已平铺 */
      }
      await fs.unlink(zipPath).catch(() => {})
      await writeMarker(csgoveDir(), CSGOVE_VERSION)
    } finally {
      activeControllers.delete('csgove')
    }
  })
}

/** 确保 whisper-cli 就绪（下载 + 解压，幂等） */
export function ensureWhisperCli(onProgress?: (p: EngineEnsureProgress) => void): Promise<void> {
  return withLock('whisper-cli', async () => {
    if (await isValidFile(whisperExe(), 100 * 1024)) return
    const ctrl = new AbortController()
    activeControllers.set('whisper-cli', ctrl)
    try {
      const zipPath = join(whisperDir(), 'whisper.zip')
      await downloadWithMirrors(
        ghUrls(`ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`),
        zipPath,
        (p) => onProgress?.({ what: 'whisper', received: p.received, total: p.total }),
        ctrl.signal
      )
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(whisperDir(), true)
      // 平铺
      const dirs = (await fs.readdir(whisperDir())).filter(async (d) => {
        try {
          return (await fs.stat(join(whisperDir(), d))).isDirectory()
        } catch {
          return false
        }
      })
      for (const d of dirs) {
        const inner = join(whisperDir(), d)
        const entries = await fs.readdir(inner).catch(() => [])
        for (const e of entries) {
          await fs.rename(join(inner, e), join(whisperDir(), e)).catch(() => {})
        }
        await fs.rmdir(inner).catch(() => {})
      }
      await fs.unlink(zipPath).catch(() => {})
    } finally {
      activeControllers.delete('whisper-cli')
    }
  })
}

/** 确保 ggml 模型就绪（下载，幂等） */
export function ensureWhisperModel(
  model: LocalWhisperModel,
  onProgress?: (p: EngineEnsureProgress) => void
): Promise<void> {
  const lockKey = `model-${model}`
  return withLock(lockKey, async () => {
    const dest = whisperModelPath(model)
    if (await isValidFile(dest, MODEL_SIZES[model] * 0.85)) return
    const ctrl = new AbortController()
    activeControllers.set(lockKey, ctrl)
    try {
      const file = MODEL_FILES[model]
      // 下载地址顺序与参数都是实测出来的结论：
      // · huggingface.co 直连在国内基本必然连接超时（测试 20s 无响应）；下载走的是 node:https，
      //   不经过系统代理，所以不能指望用户开代理就能好；
      // · hf-mirror.com 不带 ?download=true 时会被限流（429）或直接 502，加上该参数才稳定 200。
      //   实测 ggml-tiny.bin 全量 77MB / 30s / 2.5MB/s 可下完。
      // 所以把镜像放第一位并固定带参数，官方源只作为镜像全挂时的兜底。
      await downloadWithMirrors(
        [
          `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}?download=true`,
          `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}?download=true`
        ],
        dest,
        (p) => onProgress?.({ what: lockKey, received: p.received, total: p.total }),
        ctrl.signal
      )
    } finally {
      activeControllers.delete(lockKey)
    }
  })
}

/** 检查各引擎/模型是否已就绪（设置页展示用） */
export async function engineStatus(): Promise<
  Record<'csgove' | 'whisper' | string, boolean>
> {
  const status: Record<string, boolean> = {
    csgove: await isValidFile(csgoveExe(), 100 * 1024),
    whisper: await isValidFile(whisperExe(), 100 * 1024)
  }
  for (const m of Object.keys(MODEL_FILES) as LocalWhisperModel[]) {
    status[`model-${m}`] = await isValidFile(whisperModelPath(m), MODEL_SIZES[m] * 0.85)
  }
  return status
}

export type { DownloadProgress }
