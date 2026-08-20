/**
 * 设置持久化（userData/settings.json，原子写）
 */
import { app } from 'electron'
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

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  cache = deepMerge(cur, patch)
  const tmp = settingsPath() + '.tmp'
  await fs.mkdir(join(app.getPath('userData')), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  await fs.rename(tmp, settingsPath())
  return cache
}
