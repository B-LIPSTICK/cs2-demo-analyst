/**
 * 引擎/模型管理：csgove、whisper-cli、ggml 模型 的按需下载与缓存
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { downloadWithMirrors, type DownloadProgress } from './download'
import type { LocalWhisperModel } from '@shared/types'

export const CSGOVE_VERSION = 'v3.1.6'
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

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
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

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  locks.set(
    key,
    run.catch(() => {})
  )
  return run
}

/** 确保 csgove 就绪（下载 + 解压，幂等） */
export function ensureCsgove(onProgress?: (p: EngineEnsureProgress) => void): Promise<void> {
  return withLock('csgove', async () => {
    if (await exists(csgoveExe())) return
    const zipPath = join(csgoveDir(), 'csgove.zip')
    await downloadWithMirrors(
      ghUrls(`akiver/csgo-voice-extractor/releases/download/${CSGOVE_VERSION}/win32-x64.zip`),
      zipPath,
      (p) => onProgress?.({ what: 'csgove', received: p.received, total: p.total })
    )
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
  })
}

/** 确保 whisper-cli 就绪（下载 + 解压，幂等） */
export function ensureWhisperCli(onProgress?: (p: EngineEnsureProgress) => void): Promise<void> {
  return withLock('whisper-cli', async () => {
    if (await exists(whisperExe())) return
    const zipPath = join(whisperDir(), 'whisper.zip')
    await downloadWithMirrors(
      ghUrls(`ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`),
      zipPath,
      (p) => onProgress?.({ what: 'whisper-cli', received: p.received, total: p.total })
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
  })
}

/** 确保 ggml 模型就绪（下载，幂等） */
export function ensureWhisperModel(
  model: LocalWhisperModel,
  onProgress?: (p: EngineEnsureProgress) => void
): Promise<void> {
  return withLock(`model-${model}`, async () => {
    const dest = whisperModelPath(model)
    if (await exists(dest)) return
    const file = MODEL_FILES[model]
    await downloadWithMirrors(
      [
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`,
        `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`
      ],
      dest,
      (p) => onProgress?.({ what: `model-${file}`, received: p.received, total: p.total })
    )
  })
}

/** 检查各引擎/模型是否已就绪（设置页展示用） */
export async function engineStatus(): Promise<
  Record<'csgove' | 'whisper' | string, boolean>
> {
  const status: Record<string, boolean> = {
    csgove: await exists(csgoveExe()),
    whisper: await exists(whisperExe())
  }
  for (const m of Object.keys(MODEL_FILES) as LocalWhisperModel[]) {
    status[`model-${m}`] = await exists(whisperModelPath(m))
  }
  return status
}

export type { DownloadProgress }
