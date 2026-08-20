/**
 * Demo 资料库服务（真实实现）
 * - 扫描用户目录中的 .dem，缓存元数据与解析结果（userData/library）
 * - 顺序解析队列（deadem），进度/阶段事件推送到渲染层
 * - MOCK_LIBRARY=1 时使用确定性 mock 数据（开发预览用）
 */
import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'chokidar'
import type { DemoDetail, DemoMeta, Settings } from '@shared/types'
import { parseDemo } from './parser'
import { getMockDetail, getMockLibrary } from './mock'
import { updateSettings } from './settings'
import { extractVoice as asrExtract, transcribeDemo } from './asr'

export interface LibraryService {
  init(): Promise<void>
  list(): Promise<DemoMeta[]>
  detail(id: string): Promise<DemoDetail | null>
  addRoot(): Promise<string[]>
  removeRoot(root: string): Promise<void>
  setRoots(roots: string[]): Promise<void>
  rescan(): Promise<void>
  detectVoice(id: string): Promise<{ hasVoice: boolean; voiceSec: number }>
  extractVoice(id: string): Promise<number>
  transcribe(id: string, opts?: { players?: string[] }): Promise<void>
  cancelTranscribe(): void
}

interface Store {
  index: Record<string, DemoMeta>
  details: Map<string, DemoDetail>
  roots: string[]
  queue: DemoMeta[]
  parsing: boolean
  watchers: FSWatcher[]
}

function demoid(path: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${path}|${size}|${mtimeMs}`).digest('hex').slice(0, 16)
}

const MOCK = process.env['MOCK_LIBRARY'] === '1'

/** 调试文件日志（开发期排查用） */
function dbg(msg: string): void {
  if (process.env['DEBUG_LIBRARY'] !== '1') return
  console.log(`[dbg] ${msg}`)
  try {
    const dir = app.getPath('userData')
    const { appendFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'library-debug.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* noop */
  }
}

export function createLibraryService(
  getWindow: () => BrowserWindow | null,
  getSettings: () => Promise<Settings>
): LibraryService {
  const emit = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // 转写取消信号
  let transcribeSignal: AbortController | null = null
  const cancelTranscribe = () => {
    transcribeSignal?.abort()
    transcribeSignal = null
  }

  const store: Store = {
    index: {},
    details: new Map(),
    roots: [],
    queue: [],
    parsing: false,
    watchers: []
  }

  const libDir = () => join(app.getPath('userData'), 'library')
  const indexPath = () => join(libDir(), 'index.json')
  const detailPath = (id: string) => join(libDir(), `${id}.json`)

  const persistIndex = async () => {
    await fs.mkdir(libDir(), { recursive: true })
    const tmp = indexPath() + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(store.index), 'utf-8')
    await fs.rename(tmp, indexPath())
  }

  const persistDetail = async (detail: DemoDetail) => {
    await fs.mkdir(libDir(), { recursive: true })
    const tmp = detailPath(detail.meta.id) + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(detail), 'utf-8')
    await fs.rename(tmp, detailPath(detail.meta.id))
  }

  const broadcast = () => {
    emit('library:updated', Object.values(store.index))
  }

  // ─── 解析队列 ─────────────────────────────────────────────────────────────

  const pump = async () => {
    if (store.parsing) return
    store.parsing = true
    try {
      while (store.queue.length > 0) {
        const meta = store.queue.shift()!
        await doParse(meta)
      }
    } catch (err) {
      console.error('[library] queue error', err)
    } finally {
      store.parsing = false
    }
  }

  const doParse = async (meta: DemoMeta) => {
    meta.status = 'parsing'
    dbg(`doParse start ${meta.fileName}`)
    broadcast()
    try {
      const result = await parseDemo(
        meta.path,
        (p) => {
          const progress = Math.min(0.99, p.bytes / Math.max(1, p.total))
          emit('library:progress', { id: meta.id, stage: 'parse', progress })
        },
        (stage) => emit('library:progress', { id: meta.id, stage, progress: 0 })
      )
      Object.assign(meta, {
        status: 'ready' as const,
        mapName: result.mapName,
        tickRate: result.tickRate,
        tickCount: result.lastTick,
        durationSec: Math.round(result.lastTick / result.tickRate),
        teamT: result.teamT,
        teamCT: result.teamCT,
        scoreT: result.scoreT,
        scoreCT: result.scoreCT,
        roundCount: result.rounds.length,
        players: result.players,
        hasVoice: result.hasVoice,
        voiceSec: result.voiceSec,
        error: undefined
      })
      store.details.set(meta.id, {
        meta: { ...meta },
        rounds: result.rounds,
        chat: result.chat,
        voice: [],
        firstTick: result.firstTick,
        lastTick: result.lastTick
      })
      await persistDetail(store.details.get(meta.id)!)
      await persistIndex()
      dbg(`doParse done ${meta.fileName} rounds=${result.rounds.length}`)
    } catch (err) {
      meta.status = 'error'
      meta.error = err instanceof Error ? err.message : String(err)
    }
    broadcast()
  }

  // ─── 扫描 ─────────────────────────────────────────────────────────────────

  async function walk(dir: string, out: string[]): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue
        await walk(p, out)
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.dem') {
        out.push(p)
      }
    }
  }

  const scan = async () => {
    try {
      const found: string[] = []
      await Promise.all(store.roots.map((r) => walk(r, found)))
      dbg(`scan found ${found.length} demos in ${store.roots.length} roots`)
      const seen = new Set<string>()
      for (const path of found) {
        let st
        try {
          st = await fs.stat(path)
        } catch {
          continue
        }
        const id = demoid(path, st.size, st.mtimeMs)
        seen.add(id)
        const existing = store.index[id]
        if (existing) continue
        const meta: DemoMeta = {
          id,
          path,
          fileName: path.split(/[\\/]/).pop() ?? path,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          addedAt: Date.now(),
          status: 'pending'
        }
        store.index[id] = meta
        store.queue.push(meta)
      }
      // 清理已删除文件
      for (const id of Object.keys(store.index)) {
        if (!seen.has(id)) {
          delete store.index[id]
          store.details.delete(id)
          fs.unlink(detailPath(id)).catch(() => {})
        }
      }
      broadcast()
      await persistIndex().catch(() => {})
      void pump()
    } catch (err) {
      dbg(`scan failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('[library] scan failed', err)
    }
  }

  // ─── 目录监视 ─────────────────────────────────────────────────────────────

  const stopWatchers = async () => {
    for (const w of store.watchers) await w.close().catch(() => {})
    store.watchers = []
  }

  const setupWatchers = async () => {
    await stopWatchers()
    for (const root of store.roots) {
      const w = watch(root, {
        depth: 6,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }
      })
      w.on('add', (p) => {
        if (extname(p).toLowerCase() !== '.dem') return
        void fs.stat(p).then((st) => {
          const id = demoid(p, st.size, st.mtimeMs)
          if (store.index[id]) return
          const meta: DemoMeta = {
            id,
            path: p,
            fileName: p.split(/[\\/]/).pop() ?? p,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            addedAt: Date.now(),
            status: 'pending'
          }
          store.index[id] = meta
          store.queue.push(meta)
          broadcast()
          void persistIndex()
          void pump()
        })
      })
      w.on('unlink', (p) => {
        for (const id of Object.keys(store.index)) {
          if (store.index[id].path === p) {
            delete store.index[id]
            store.details.delete(id)
            fs.unlink(detailPath(id)).catch(() => {})
          }
        }
        broadcast()
        void persistIndex()
      })
      store.watchers.push(w)
    }
  }

  // ─── Mock 分支 ────────────────────────────────────────────────────────────

  if (MOCK) {
    return {
      async init() {},
      async list() {
        return getMockLibrary()
      },
      async detail(id) {
        return getMockDetail(id)
      },
      async addRoot() {
        return []
      },
      async removeRoot() {},
      async setRoots() {},
      async rescan() {},
      async detectVoice(id) {
        const meta = getMockLibrary().find((m) => m.id === id)
        return { hasVoice: Boolean(meta?.hasVoice), voiceSec: meta?.voiceSec ?? 0 }
      },
      async extractVoice() {
        return 0
      },
      async transcribe() {},
      cancelTranscribe() {}
    }
  }

  // ─── 真实实现 ─────────────────────────────────────────────────────────────

  return {
    async init() {
      try {
        dbg('init begin')
        try {
          const raw = await fs.readFile(indexPath(), 'utf-8')
          store.index = JSON.parse(raw)
        } catch {
          store.index = {}
        }
        dbg(`init index loaded: ${Object.keys(store.index).length}`)
        // 校验缓存文件仍存在
        for (const id of Object.keys(store.index)) {
          const meta = store.index[id]
          try {
            const st = await fs.stat(meta.path)
            if (demoid(meta.path, st.size, st.mtimeMs) !== id) {
              delete store.index[id]
            }
          } catch {
            delete store.index[id]
          }
        }
        const settings = await getSettings()
        store.roots = settings.libraryRoots
        dbg(`init roots: ${JSON.stringify(store.roots)}`)
        await setupWatchers()
        dbg('init watchers ok')
        broadcast()
        void scan()
        dbg('init done')
      } catch (err) {
        console.error('[library] init failed', err)
        dbg(`init failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },

    async list() {
      return Object.values(store.index).sort((a, b) => b.addedAt - a.addedAt)
    },

    async detail(id) {
      const cached = store.details.get(id)
      if (cached) return cached
      try {
        const raw = await fs.readFile(detailPath(id), 'utf-8')
        const detail = JSON.parse(raw) as DemoDetail
        store.details.set(id, detail)
        return detail
      } catch {
        return null
      }
    },

    async addRoot() {
      const win = getWindow()
      if (!win) return []
      const res = await dialog.showOpenDialog(win, {
        title: '选择 Demo 目录',
        properties: ['openDirectory', 'multiSelections']
      })
      if (res.canceled) return []
      const merged = [...new Set([...store.roots, ...res.filePaths])]
      await this.setRoots(merged)
      return merged
    },

    async removeRoot(root: string) {
      await this.setRoots(store.roots.filter((r) => r !== root))
    },

    async setRoots(roots: string[]) {
      store.roots = roots
      await updateSettings({ libraryRoots: roots })
      await setupWatchers()
      void scan()
    },

    async rescan() {
      void scan()
    },

    async detectVoice(id) {
      const meta = store.index[id] ?? getMockLibrary().find((m) => m.id === id)
      const hasVoice = Boolean(meta?.hasVoice)
      const voiceSec = meta?.voiceSec ?? 0
      emit('voice:detected', { id, hasVoice, voiceSec })
      return { hasVoice, voiceSec }
    },

    async extractVoice(id: string) {
      const detail = await this.detail(id)
      if (!detail) throw new Error('demo not found')
      const items = await asrExtract(
        detail,
        {
          progress: (stage, done, total) =>
            emit('asr:progress', { demoId: id, stage, done, total }),
          segment: () => {}
        },
        transcribeSignal?.signal
      )
      return items.length
    },

    async transcribe(id: string, opts?: { players?: string[] }) {
      const detail = await this.detail(id)
      if (!detail) throw new Error('demo not found')
      transcribeSignal = new AbortController()
      const settings = await getSettings()
      const segments = await transcribeDemo(
        detail,
        {
          engine: settings.asr.engine,
          localModel: settings.asr.localModel,
          cloudBaseUrl: settings.asr.cloudBaseUrl,
          cloudApiKey: settings.asr.cloudApiKey,
          cloudModel: settings.asr.cloudModel,
          players: opts?.players
        },
        {
          progress: (stage, done, total) =>
            emit('asr:progress', { demoId: id, stage, done, total }),
          segment: (segment) => emit('asr:segment', { demoId: id, segment })
        },
        transcribeSignal?.signal
      )
      // 持久化转写结果
      const cached = store.details.get(id)
      if (cached) {
        cached.voice = segments
        await persistDetail(cached).catch(() => {})
      } else {
        detail.voice = segments
        await persistDetail(detail).catch(() => {})
      }
      transcribeSignal = null
    },

    cancelTranscribe() {
      cancelTranscribe()
    }
  }
}
