/**
 * 暂存 demo 清单与清理。
 *
 * 清单位置：userData/staged-demos.json
 * 记录：path（暂存副本绝对路径）、sourceDemoPath（原始 demo 绝对路径）、createdAt（ISO 时间）
 *
 * 安全约束：
 *  - 只清理清单中登记、且位于允许的 staging 根目录下的文件；
 *  - 只删除 staging 根目录的直接子文件，且文件名必须符合 dsh-<10位sha1>.dem；
 *  - 绝不删除 sourceDemoPath 指向的原始 demo；
 *  - 不递归删除目录，只 unlink 普通文件。
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from 'node:path'

export const STAGED_DEMOS_MANIFEST = 'staged-demos.json'
/** 启动清理默认保留 7 天 */
export const STAGED_DEMO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 无论调用方传多小的阈值，都不删除最近 2 天的暂存文件 */
export const STAGED_DEMO_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000

const STAGED_DEMO_NAME_RE = /^dsh-[0-9a-f]{10}\.dem$/i
const LOG_PREFIX = '[staged-demos]'
/** 判断“复用已有文件”时，createdAt 与 birthtime 的容差（大 demo 复制可能耗时） */
const REUSE_DETECTION_TOLERANCE_MS = 10 * 60 * 1000

export interface StagedDemoEntry {
  /** 暂存副本绝对路径 */
  path: string
  /** 原始 demo 绝对路径（只读，绝不删除） */
  sourceDemoPath: string
  /** 登记时间（ISO 8601） */
  createdAt: string
}

export interface StagedDemoInput {
  path: string
  sourceDemoPath: string
  /** 可传入 Date/时间戳/ISO 字符串；默认当前时间 */
  createdAt?: string | number | Date
}

export type StagedDemoCleanupReason =
  | 'not-in-manifest'
  | 'source-demo'
  | 'invalid-name'
  | 'outside-allowed-root'
  | 'not-a-file'
  | 'missing'
  | 'recent-reused'
  | 'unlink-failed'

export interface StagedDemoCleanupResult {
  path: string
  deleted: boolean
  /** 是否从清单移除了该条目（文件不存在/不是普通文件/删除成功时为 true） */
  removedEntry: boolean
  reason?: StagedDemoCleanupReason
  error?: string
}

export interface StagedDemoPruneResult {
  deleted: string[]
  skipped: string[]
  kept: number
}

interface ManifestDocument {
  version: 1
  entries: StagedDemoEntry[]
}

let operationQueue: Promise<unknown> = Promise.resolve()

/**
 * 串行化清单读改写，避免并发 register/cleanup/prune 互相覆盖。
 */
function withManifestLock<T>(task: () => Promise<T>): Promise<T> {
  const run = operationQueue.then(task, task)
  operationQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function manifestPath(): string {
  return join(app.getPath('userData'), STAGED_DEMOS_MANIFEST)
}

function pathKey(filePath: string): string {
  const normalized = resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

function isStagedDemoFileName(filePath: string): boolean {
  return STAGED_DEMO_NAME_RE.test(basename(filePath))
}

/**
 * 判断 filePath 是否位于 root 之下（前缀校验，防止 .. 逃逸）。
 * 使用 path.relative 而不是字符串 startsWith，避免 C:\foo 与 C:\foobar 误判。
 */
function isPathUnderRoot(filePath: string, root: string): boolean {
  const resolvedFile = resolve(filePath)
  const resolvedRoot = resolve(root)
  const fileCmp = process.platform === 'win32' ? resolvedFile.toLowerCase() : resolvedFile
  const rootCmp = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot
  const rel = relative(rootCmp, fileCmp)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 只允许 staging 根目录的直接子文件。
 * stageDemoForPlay / stageDemoForPlayNoSpace 都只在根目录下生成 dsh-*.dem。
 */
function isDirectChildOfAnyRoot(filePath: string, allowedRoots: string[]): boolean {
  const resolvedFile = resolve(filePath)
  for (const root of allowedRoots) {
    if (!root) continue
    const resolvedRoot = resolve(root)
    if (!samePath(dirname(resolvedFile), resolvedRoot)) continue
    if (isPathUnderRoot(resolvedFile, resolvedRoot)) return true
  }
  return false
}

/**
 * 由 CS2 安装目录推导允许的 staging 根：
 *  - <install>/game/csgo        （VConsole / -tools 模式）
 *  - <盘根>:\dsh-demo            （普通模式 +exec 播放）
 */
export function stagingRootsForInstall(installPath: string): string[] {
  const install = resolve(installPath)
  const roots = [join(install, 'game', 'csgo'), join(parse(install).root, 'dsh-demo')]
  const unique = new Set(roots.map((root) => resolve(root)))
  return [...unique]
}

function normalizeCreatedAt(value: StagedDemoInput['createdAt']): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : typeof value === 'string'
          ? new Date(value)
          : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function parseEntry(value: unknown): StagedDemoEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.path !== 'string' || !record.path.trim()) return null
  if (typeof record.sourceDemoPath !== 'string' || !record.sourceDemoPath.trim()) return null
  if (!isAbsolute(record.path) || !isAbsolute(record.sourceDemoPath)) return null

  const rawCreatedAt = record.createdAt
  let createdAt = ''
  if (typeof rawCreatedAt === 'string') {
    createdAt = rawCreatedAt
  } else if (typeof rawCreatedAt === 'number') {
    const date = new Date(rawCreatedAt)
    if (Number.isFinite(date.getTime())) createdAt = date.toISOString()
  }
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return null

  return {
    path: resolve(record.path),
    sourceDemoPath: resolve(record.sourceDemoPath),
    createdAt: new Date(Date.parse(createdAt)).toISOString()
  }
}

async function writeEntriesUnlocked(entries: StagedDemoEntry[]): Promise<void> {
  const file = manifestPath()
  const dir = dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const document: ManifestDocument = { version: 1, entries }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(document, null, 2) + '\n', 'utf-8')
  try {
    await fs.rename(tmp, file)
  } catch (err) {
    // Windows 上极少数情况下 rename 不能覆盖旧文件；兜底删除后重试。
    await fs.unlink(file).catch(() => {})
    try {
      await fs.rename(tmp, file)
    } catch (retryErr) {
      await fs.unlink(tmp).catch(() => {})
      throw retryErr instanceof Error ? retryErr : err
    }
  }
}

async function readEntriesUnlocked(): Promise<StagedDemoEntry[]> {
  const file = manifestPath()
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`${LOG_PREFIX} 读取清单失败，按空清单处理：${file}`, err)
    }
    return []
  }

  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn(`${LOG_PREFIX} 清单 JSON 损坏，已重建：${file}`, err)
    await writeEntriesUnlocked([]).catch((writeErr) => {
      console.warn(`${LOG_PREFIX} 重建清单失败：${file}`, writeErr)
    })
    return []
  }

  let rawEntries: unknown[] | null = null
  if (Array.isArray(parsed)) {
    rawEntries = parsed
  } else if (parsed && typeof parsed === 'object') {
    const entries = (parsed as { entries?: unknown }).entries
    if (Array.isArray(entries)) rawEntries = entries
  }
  if (!rawEntries) {
    console.warn(`${LOG_PREFIX} 清单结构无效，已重建：${file}`)
    await writeEntriesUnlocked([]).catch((writeErr) => {
      console.warn(`${LOG_PREFIX} 重建清单失败：${file}`, writeErr)
    })
    return []
  }

  const entries: StagedDemoEntry[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const item of rawEntries) {
    const entry = parseEntry(item)
    if (!entry) {
      dropped++
      continue
    }
    const key = pathKey(entry.path)
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    entries.push(entry)
  }

  if (dropped > 0) {
    console.warn(`${LOG_PREFIX} 清单中有 ${dropped} 条无效/重复记录，已忽略并重建`)
    await writeEntriesUnlocked(entries).catch((writeErr) => {
      console.warn(`${LOG_PREFIX} 写回清理后的清单失败：${file}`, writeErr)
    })
  }

  return entries
}

/**
 * 登记（或更新）一个暂存 demo。
 * 只在路径符合 staging 规则时登记；清单写入失败不会影响播放。
 */
export async function registerStagedDemo(
  input: StagedDemoInput,
  allowedRoots: string[]
): Promise<StagedDemoEntry | null> {
  const stagedPath = resolve(input.path)
  const sourcePath = resolve(input.sourceDemoPath)

  if (!isStagedDemoFileName(stagedPath)) {
    console.warn(`${LOG_PREFIX} 拒绝登记非法暂存文件名：${stagedPath}`)
    return null
  }
  if (!isDirectChildOfAnyRoot(stagedPath, allowedRoots)) {
    console.warn(`${LOG_PREFIX} 拒绝登记不在 staging 根目录下的文件：${stagedPath}`)
    return null
  }
  // 原始 demo 与暂存路径重合时绝不登记，避免退出清理误删原始文件。
  if (samePath(stagedPath, sourcePath)) {
    console.warn(`${LOG_PREFIX} 暂存路径与原始 demo 相同，跳过登记：${stagedPath}`)
    return null
  }

  const entry: StagedDemoEntry = {
    path: stagedPath,
    sourceDemoPath: sourcePath,
    createdAt: normalizeCreatedAt(input.createdAt)
  }

  try {
    return await withManifestLock(async () => {
      const entries = await readEntriesUnlocked()
      const key = pathKey(stagedPath)
      const index = entries.findIndex((item) => pathKey(item.path) === key)
      if (index >= 0) entries[index] = entry
      else entries.push(entry)
      await writeEntriesUnlocked(entries)
      return entry
    })
  } catch (err) {
    console.warn(`${LOG_PREFIX} 登记暂存 demo 失败：${stagedPath}`, err)
    return null
  }
}

/**
 * 清理单个暂存 demo。
 * 只有同时满足以下条件才会 unlink：
 *  1. 路径在清单中；
 *  2. 路径是允许 staging 根目录的直接子文件；
 *  3. 文件名符合 dsh-<10位sha1>.dem；
 *  4. 不是 sourceDemoPath 指向的原始 demo；
 *  5. 实际是普通文件（不递归删除目录）。
 */
export async function cleanupStagedDemo(
  filePath: string,
  allowedRoots: string[]
): Promise<StagedDemoCleanupResult> {
  const stagedPath = resolve(filePath)

  try {
    return await withManifestLock(async () => {
      const entries = await readEntriesUnlocked()
      const key = pathKey(stagedPath)
      const index = entries.findIndex((item) => pathKey(item.path) === key)
      if (index < 0) {
        return { path: stagedPath, deleted: false, removedEntry: false, reason: 'not-in-manifest' }
      }

      const entry = entries[index]
      const result = await removeEntryFileUnlocked(entry, allowedRoots)
      if (result.removedEntry) {
        entries.splice(index, 1)
        await writeEntriesUnlocked(entries).catch((err) => {
          console.warn(`${LOG_PREFIX} 写回清单失败：${manifestPath()}`, err)
        })
      }
      return result
    })
  } catch (err) {
    console.warn(`${LOG_PREFIX} 清理暂存 demo 失败：${stagedPath}`, err)
    return {
      path: stagedPath,
      deleted: false,
      removedEntry: false,
      reason: 'unlink-failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * 删除单个清单条目的文件（调用方已持有清单锁）。
 * 返回 removedEntry 表示是否应从清单中移除该条目。
 */
async function removeEntryFileUnlocked(
  entry: StagedDemoEntry,
  allowedRoots: string[]
): Promise<StagedDemoCleanupResult> {
  const stagedPath = resolve(entry.path)

  // 原始 demo 绝不动；清单条目本身也不再保留。
  if (samePath(stagedPath, entry.sourceDemoPath)) {
    console.warn(`${LOG_PREFIX} 跳过原始 demo（清单记录异常）：${stagedPath}`)
    return { path: stagedPath, deleted: false, removedEntry: true, reason: 'source-demo' }
  }

  if (!isStagedDemoFileName(stagedPath)) {
    console.warn(`${LOG_PREFIX} 跳过非法暂存文件名：${stagedPath}`)
    return { path: stagedPath, deleted: false, removedEntry: true, reason: 'invalid-name' }
  }

  if (!isDirectChildOfAnyRoot(stagedPath, allowedRoots)) {
    // 可能是旧安装目录/配置变更；保留条目，等后续用正确的根目录再清理。
    console.warn(`${LOG_PREFIX} 跳过不在 staging 根目录下的文件：${stagedPath}`)
    return { path: stagedPath, deleted: false, removedEntry: false, reason: 'outside-allowed-root' }
  }

  let stat: Stats
  try {
    stat = await fs.lstat(stagedPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { path: stagedPath, deleted: false, removedEntry: true, reason: 'missing' }
    }
    return {
      path: stagedPath,
      deleted: false,
      removedEntry: false,
      reason: 'unlink-failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // 只删普通文件；符号链接/目录一律不递归删除。
  if (!stat.isFile()) {
    console.warn(`${LOG_PREFIX} 跳过非普通文件：${stagedPath}`)
    return { path: stagedPath, deleted: false, removedEntry: true, reason: 'not-a-file' }
  }

  // 复用的已有副本若仍在“最近两天”保护期内，本次会话不删，交给启动 prune 的 7 天规则。
  // 新复制的文件 birthtime 接近 createdAt；复用文件的 birthtime 明显更早。
  const createdAtMs = Date.parse(entry.createdAt)
  const birthMs = stat.birthtimeMs
  const existedBeforeRegistration =
    Number.isFinite(createdAtMs) &&
    Number.isFinite(birthMs) &&
    birthMs > 0 &&
    birthMs < createdAtMs - REUSE_DETECTION_TOLERANCE_MS
  if (existedBeforeRegistration && Date.now() - birthMs < STAGED_DEMO_MIN_AGE_MS) {
    return { path: stagedPath, deleted: false, removedEntry: false, reason: 'recent-reused' }
  }

  try {
    await fs.unlink(stagedPath)
    return { path: stagedPath, deleted: true, removedEntry: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { path: stagedPath, deleted: false, removedEntry: true, reason: 'missing' }
    }
    console.warn(`${LOG_PREFIX} 删除暂存 demo 失败：${stagedPath}`, err)
    return {
      path: stagedPath,
      deleted: false,
      removedEntry: false,
      reason: 'unlink-failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * 启动清理：删除清单中超过 olderThanMs 的暂存文件。
 *
 * 安全兜底：
 *  - 实际阈值不小于 2 天，绝不删除最近两天的文件；
 *  - 同时参考 createdAt、mtime 与 birthtime，任一较新都保留；
 *  - 只处理清单内、staging 根目录直接子文件、dsh-*.dem 普通文件。
 */
export async function pruneStagedDemos(
  olderThanMs: number,
  allowedRoots: string[],
  now: number = Date.now()
): Promise<StagedDemoPruneResult> {
  const requested = Number.isFinite(olderThanMs) ? olderThanMs : STAGED_DEMO_MAX_AGE_MS
  const effectiveAge = Math.max(requested, STAGED_DEMO_MIN_AGE_MS)

  try {
    return await withManifestLock(async () => {
      const entries = await readEntriesUnlocked()
      const kept: StagedDemoEntry[] = []
      const deleted: string[] = []
      const skipped: string[] = []
      let changed = false

      for (const entry of entries) {
        const stagedPath = resolve(entry.path)
        const createdMs = Date.parse(entry.createdAt)

        // 原始 demo 记录异常：不删文件，直接丢弃清单条目。
        if (samePath(stagedPath, entry.sourceDemoPath)) {
          console.warn(`${LOG_PREFIX} 跳过原始 demo（清单记录异常）：${stagedPath}`)
          skipped.push(stagedPath)
          changed = true
          continue
        }

        if (!isStagedDemoFileName(stagedPath)) {
          console.warn(`${LOG_PREFIX} 跳过非法暂存文件名：${stagedPath}`)
          skipped.push(stagedPath)
          changed = true
          continue
        }

        if (!isDirectChildOfAnyRoot(stagedPath, allowedRoots)) {
          console.warn(`${LOG_PREFIX} 跳过不在 staging 根目录下的文件：${stagedPath}`)
          skipped.push(stagedPath)
          kept.push(entry)
          continue
        }

        let stat: Stats
        try {
          stat = await fs.lstat(stagedPath)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') {
            skipped.push(stagedPath)
            changed = true
            continue
          }
          console.warn(`${LOG_PREFIX} 读取暂存文件状态失败：${stagedPath}`, err)
          skipped.push(stagedPath)
          kept.push(entry)
          continue
        }

        if (!stat.isFile()) {
          console.warn(`${LOG_PREFIX} 跳过非普通文件：${stagedPath}`)
          skipped.push(stagedPath)
          changed = true
          continue
        }

        // createdAt、mtime、birthtime 取较新值：即使清单时间或源文件 mtime 异常，也不会误删最近创建/写入的文件。
        const newestMs = Math.max(createdMs, stat.mtimeMs, stat.birthtimeMs)
        if (!Number.isFinite(newestMs) || now - newestMs < effectiveAge) {
          kept.push(entry)
          continue
        }

        try {
          await fs.unlink(stagedPath)
          deleted.push(stagedPath)
          changed = true
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') {
            skipped.push(stagedPath)
            changed = true
            continue
          }
          console.warn(`${LOG_PREFIX} 删除过期暂存 demo 失败：${stagedPath}`, err)
          skipped.push(stagedPath)
          kept.push(entry)
        }
      }

      if (changed) {
        await writeEntriesUnlocked(kept).catch((err) => {
          console.warn(`${LOG_PREFIX} 写回清单失败：${manifestPath()}`, err)
        })
      }

      if (deleted.length > 0) {
        console.log(`${LOG_PREFIX} 已清理 ${deleted.length} 个过期暂存 demo`)
      }
      return { deleted, skipped, kept: kept.length }
    })
  } catch (err) {
    console.warn(`${LOG_PREFIX} 清理过期暂存 demo 失败`, err)
    return { deleted: [], skipped: [], kept: 0 }
  }
}

/** 读取当前清单（调试/测试用） */
export async function listStagedDemos(): Promise<StagedDemoEntry[]> {
  try {
    return await withManifestLock(readEntriesUnlocked)
  } catch (err) {
    console.warn(`${LOG_PREFIX} 读取清单失败`, err)
    return []
  }
}