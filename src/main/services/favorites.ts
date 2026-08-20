/**
 * Demo 收藏：把 demo 文件复制到收藏目录。
 * - 便携版（打包后）：<exe 所在目录>/favorites/
 * - 开发模式：userData/favorites/
 * 收藏记录存 userData/favorites/favorites.json；移除收藏只删副本，不动原文件。
 */
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Favorite, DemoMeta } from '@shared/types'

let cache: Favorite[] | null = null

function favoritesDir(): string {
  if (app.isPackaged) {
    return join(dirname(process.execPath), 'favorites')
  }
  return join(app.getPath('userData'), 'favorites')
}

function recordPath(): string {
  return join(favoritesDir(), 'favorites.json')
}

async function load(): Promise<Favorite[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(recordPath(), 'utf-8')
    cache = JSON.parse(raw) as Favorite[]
  } catch {
    cache = []
  }
  return cache
}

async function persist(list: Favorite[]): Promise<void> {
  cache = list
  await fs.mkdir(favoritesDir(), { recursive: true })
  const tmp = recordPath() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(list), 'utf-8')
  await fs.rename(tmp, recordPath())
}

/** 复制文件，同名自动加序号，避免覆盖 */
async function copyUnique(src: string, dir: string): Promise<string> {
  const base = basename(src)
  let dest = join(dir, base)
  let i = 1
  while (true) {
    try {
      await fs.copyFile(src, dest)
      return dest
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' && dir) {
        await fs.mkdir(dir, { recursive: true })
        await fs.copyFile(src, dest)
        return dest
      }
      if (code === 'EEXIST' || code === 'EPERM') {
        const dot = base.lastIndexOf('.')
        dest = join(dir, `${base.slice(0, dot)}-${i}${base.slice(dot)}`)
        i++
        continue
      }
      throw err
    }
  }
}

export async function favoritesList(): Promise<Favorite[]> {
  return load()
}

/** 收藏：复制到收藏目录并记录 */
export async function favoriteAdd(meta: DemoMeta): Promise<Favorite> {
  const list = await load()
  const existing = list.find((f) => f.id === meta.id)
  if (existing) return existing
  const dir = favoritesDir()
  const copyPath = await copyUnique(meta.path, dir)
  const fav: Favorite = {
    id: meta.id,
    name: meta.fileName,
    sourcePath: meta.path,
    copyPath,
    addedAt: Date.now()
  }
  await persist([fav, ...list])
  return fav
}

/** 取消收藏：删除副本与记录（不动原文件） */
export async function favoriteRemove(id: string): Promise<void> {
  const list = await load()
  const fav = list.find((f) => f.id === id)
  if (!fav) return
  await persist(list.filter((f) => f.id !== id))
  if (fav.copyPath) await fs.unlink(fav.copyPath).catch(() => {})
}

/** 打开收藏目录 */
export async function favoriteReveal(): Promise<void> {
  await fs.mkdir(favoritesDir(), { recursive: true })
  await shell.openPath(favoritesDir())
}
