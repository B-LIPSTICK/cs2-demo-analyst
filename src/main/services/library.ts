/**
 * Demo 资料库服务（真实实现）
 * - 扫描用户目录中的 .dem，缓存元数据与解析结果（userData/library）
 * - 顺序解析队列（deadem），进度/阶段事件推送到渲染层
 * - MOCK_LIBRARY=1 时使用确定性 mock 数据（开发预览用）
 */
import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
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
  remove(id: string, opts?: { deleteFile?: boolean }): Promise<void>
  parse(id: string): Promise<void>
  parseAll(): Promise<void>
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
    parsing: false
  }

  const libDir = () => join(app.getPath('userData'), 'library')
  const indexPath = () => join(libDir(), 'index.json')
  const detailPath = (id: string) => join(libDir(), `${id}.json`)
  const ignoredPath = () => join(libDir(), 'ignored.json')

  /** 用户手动从库移除的路径黑名单（删除后不会因扫描重新入库） */
  let ignored: string[] = []
  const loadIgnored = async () => {
    try {
      ignored = JSON.parse(await fs.readFile(ignoredPath(), 'utf-8')) as string[]
    } catch {
      ignored = []
    }
  }
  const saveIgnored = async () => {
    await fs.mkdir(libDir(), { recursive: true })
    const tmp = ignoredPath() + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(ignored), 'utf-8')
    await fs.rename(tmp, ignoredPath())
  }

  const persistIndex = async () => {
    await safePersist(indexPath(), store.index)
  }

  const persistDetail = async (detail: DemoDetail) => {
    await safePersist(detailPath(detail.meta.id), detail)
  }

  /** 原子写 + 容错：rename 覆盖失败（Windows 占用/杀软）时先删目标再重试 */
  async function safePersist(target: string, data: unknown): Promise<void> {
    await fs.mkdir(dirname(target), { recursive: true })
    const tmp = target + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data), 'utf-8')
    try {
      await fs.rename(tmp, target)
    } catch {
      await fs.unlink(target).catch(() => {})
      await fs.rename(tmp, target)
    }
  }

  const broadcast = () => {
    // 载荷必须带 { demos } 包装（renderer 按 e.demos 读取；之前发裸数组导致 e.demos=undefined → setDemos(undefined) → 渲染崩溃）
    emit('library:updated', { demos: Object.values(store.index) })
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
    // 开始时不广播（避免解析每个 demo 都全列表刷新一次）；
    // 前端由 library:progress 事件驱动把该卡片置为「解析中」
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
      await persistDetail(store.details.get(meta.id)!).catch((err) => {
        dbg(`persistDetail failed ${meta.id}: ${err instanceof Error ? err.message : String(err)}`)
      })
      await persistIndex().catch((err) => {
        dbg(`persistIndex failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      dbg(`doParse done ${meta.fileName} rounds=${result.rounds.length}`)
    } catch (err) {
      meta.status = 'error'
      meta.error = err instanceof Error ? err.message : String(err)
    }
    // 单条目更新（只刷新这一张卡片，不广播全列表）
    emit('library:item', { id: meta.id, meta: { ...meta } })
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

  /** 收集目录下的 .zip（demo 压缩包容器） */
  async function walkZip(dir: string, out: string[]): Promise<void> {
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
        await walkZip(p, out)
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.zip') {
        out.push(p)
      }
    }
  }

  /** zip 内 .dem 的缓存目录（userData/cache/zips/<id>/） */
  const zipCacheDir = () => join(app.getPath('userData'), 'cache', 'zips')

  /** 把 zip 内的 .dem 条目提取到缓存文件（解析/播放均用缓存路径） */
  async function ensureZipEntry(zip: AdmZip, entry: { entryName: string }, id: string): Promise<string> {
    const name = basename(entry.entryName.replace(/\\/g, '/'))
    const destPath = join(zipCacheDir(), id, name)
    try {
      await fs.access(destPath)
      return destPath
    } catch {
      /* 缓存不存在 → 提取 */
    }
    const data = zip.readFile(entry.entryName)
    if (!data) throw new Error(`无法读取压缩包内文件：${entry.entryName}`)
    await fs.mkdir(dirname(destPath), { recursive: true })
    await fs.writeFile(destPath, data)
    return destPath
  }

  const scan = async () => {
    try {
      const foundDems: string[] = []
      const foundZips: string[] = []
      await Promise.all(
        store.roots.map(async (r) => {
          await walk(r, foundDems)
          await walkZip(r, foundZips)
        })
      )
      const ignoredSet = new Set(ignored)
      dbg(`scan found ${foundDems.length} demos + ${foundZips.length} zips in ${store.roots.length} roots`)
      const seen = new Set<string>()

      // ── 普通 .dem ──
      for (const path of foundDems) {
        if (ignoredSet.has(path)) continue
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
          dateMs: st.mtimeMs,
          addedAt: Date.now(),
          status: 'pending'
        }
        store.index[id] = meta
      }

      // ── .zip 容器：把其中 .dem 提取到缓存，直接入库解析 ──
      for (const zp of foundZips) {
        if (ignoredSet.has(zp)) continue
        let zst
        try {
          zst = await fs.stat(zp)
        } catch {
          continue
        }
        let zip: AdmZip
        try {
          zip = new AdmZip(zp)
        } catch {
          continue
        }
        const entries = zip
          .getEntries()
          .filter((e) => !e.isDirectory && /\.dem$/i.test(e.entryName))
        for (const e of entries) {
          const name = basename(e.entryName.replace(/\\/g, '/'))
          // id 只依赖 zip 路径 + 内部条目名 + 解压大小（不含 zip mtime/size）：
          // 完美平台会持续改写 zip 文件，若把 mtime 纳入 key，解析结果会被反复清成 pending
          const id = demoid(`${zp}|${name}`, e.header.size, 0)
          seen.add(id)
          const existing = store.index[id]
          if (existing && existing.containerPath === zp) continue
          try {
            const cachePath = await ensureZipEntry(zip, e, id)
            store.index[id] = {
              id,
              path: cachePath,
              containerPath: zp,
              fileName: name,
              sizeBytes: e.header.size,
              mtimeMs: zst.mtimeMs,
              dateMs: zst.mtimeMs,
              addedAt: Date.now(),
              status: 'pending'
            }
          } catch (err) {
            dbg(`zip entry failed ${zp} ${name}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      // ── 清理失效条目（源文件/容器消失或变更）──
      for (const id of Object.keys(store.index)) {
        if (!seen.has(id)) {
          const meta = store.index[id]
          delete store.index[id]
          store.details.delete(id)
          fs.unlink(detailPath(id)).catch(() => {})
          if (meta.containerPath) {
            fs.rm(join(zipCacheDir(), id), { recursive: true, force: true }).catch(() => {})
          }
        }
      }
      broadcast()
      await persistIndex().catch(() => {})
    } catch (err) {
      dbg(`scan failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('[library] scan failed', err)
    }
  }

  // ─── 目录监视（已停用：不做自动检测，只有手动「添加目录/重新扫描」才扫描） ──
  // 若未来恢复：chokidar watch roots，add/unlink/change 处理见 git 历史

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
      async remove() {},
      async parse() {},
      async parseAll() {},
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
        await loadIgnored()
        // 清理孤儿 zip 缓存（index 里不存在的缓存目录，如上次退出未落盘时遗留）
        try {
          const cached = await fs.readdir(zipCacheDir()).catch(() => [] as string[])
          for (const cid of cached) {
            if (!store.index[cid]) {
              await fs.rm(join(zipCacheDir(), cid), { recursive: true, force: true }).catch(() => {})
            }
          }
        } catch {
          /* noop */
        }
        // 清理孤儿详情缓存（index 里不存在的 detail json）
        try {
          const files = await fs.readdir(libDir()).catch(() => [] as string[])
          for (const f of files) {
            if (!f.endsWith('.json') || f === 'index.json' || f === 'ignored.json') continue
            const cid = f.slice(0, -5)
            if (!store.index[cid]) await fs.unlink(join(libDir(), f)).catch(() => {})
          }
        } catch {
          /* noop */
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
        // 启动不自动扫描：只显示缓存列表；手动「添加目录/重新扫描」才检测磁盘
        broadcast()
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
      // 用户主动添加/移除目录 → 立即扫描（这是手动行为）
      void scan()
    },

    async rescan() {
      void scan()
    },

    /** 手动解析单个 demo（把条目加入解析队列） */
    async parse(id: string) {
      const meta = store.index[id]
      if (!meta || meta.status === 'ready' || meta.status === 'parsing') return
      if (!store.queue.some((q) => q.id === id)) store.queue.push(meta)
      void pump()
    },

    /** 手动解析全部待解析 demo */
    async parseAll() {
      for (const meta of Object.values(store.index)) {
        if (meta.status === 'ready' || meta.status === 'parsing') continue
        if (!store.queue.some((q) => q.id === meta.id)) store.queue.push(meta)
      }
      void pump()
    },

    /** 从资料库移除（deleteFile=true 时连源文件一起删；zip 容器条目会整容器移除并删除 zip 本体） */
    async remove(id: string, opts?: { deleteFile?: boolean }) {
      const meta = store.index[id]
      if (!meta) return
      const container = meta.containerPath
      const isZip = Boolean(container)
      // zip 容器：该容器下所有条目一起移除（源 zip 删除后它们都无法再读取）
      const ids = isZip
        ? Object.keys(store.index).filter((k) => store.index[k].containerPath === container)
        : [id]
      for (const did of ids) {
        const m = store.index[did]
        delete store.index[did]
        store.details.delete(did)
        void fs.unlink(detailPath(did)).catch(() => {})
        if (m.containerPath) {
          void fs.rm(join(zipCacheDir(), did), { recursive: true, force: true }).catch(() => {})
        }
      }
      const ignoreKey = container ?? meta.path
      if (!ignored.includes(ignoreKey)) ignored.push(ignoreKey)
      const jobs: Promise<void>[] = [saveIgnored(), persistIndex()]
      if (opts?.deleteFile) {
        // 连本地源文件一起删：普通 demo 删 .dem；zip 条目删容器 zip
        jobs.push(container ? fs.unlink(container).catch(() => {}) : fs.unlink(meta.path).catch(() => {}))
      }
      await Promise.all(jobs)
      broadcast()
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
          progress: (stage, done, total, message) =>
            emit('asr:progress', { demoId: id, stage, done, total, message }),
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
