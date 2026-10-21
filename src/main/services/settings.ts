/**
 * 设置持久化（userData/settings.json，原子写）
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    if (
      cur !== null &&
      typeof cur === 'object' &&
      !Array.isArray(cur) &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

export async function getSettings(): Promise<Settings> {
  if (cache) return cache
  try {
    let raw = await fs.readFile(settingsPath(), 'utf-8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // 剥离 UTF-8 BOM
    const parsed = JSON.parse(raw) as Partial<Settings>
    if (process.env['DEBUG_LIBRARY'] === '1') {
      console.log(`[settings] path=${settingsPath()} rawLen=${raw.length} roots=${JSON.stringify((parsed as { libraryRoots?: string[] }).libraryRoots)}`)
    }
    cache = deepMerge(DEFAULT_SETTINGS, parsed)
  } catch (err) {
    console.error('[settings] load failed', err)
    cache = structuredClone(DEFAULT_SETTINGS)
  }
  return cache
}

let writeChain: Promise<void> = Promise.resolve()

/**
 * 串行化设置写入：所有更新排队执行，避免快速连续 patch 乱序或互相覆盖。
 * 队列尾部吞掉错误，保证一次失败不会让后续写入全部被拒绝。
 */
export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = writeChain.then(async () => {
    const cur = await getSettings()
    const next = deepMerge(cur, patch)
    const dir = app.getPath('userData')
    await fs.mkdir(dir, { recursive: true })
    // 每次写使用唯一临时文件，避免并发或残留 tmp 冲突
    const tmp = join(dir, `settings.${process.pid}.${randomUUID()}.tmp`)
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
      await fs.rename(tmp, settingsPath())
    } catch (err) {
      // 失败时清理临时文件并向上抛出；cache 保持上一次成功写入的状态
      await fs.unlink(tmp).catch(() => {})
      throw err
    }
    cache = next
    return next
  })
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
