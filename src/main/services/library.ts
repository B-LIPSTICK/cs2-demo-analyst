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
import type { DemoDetail, DemoMeta, DetectedPlatformRoot, Settings } from '@shared/types'
import { parseDemo } from './parser'
import { getMockDetail, getMockLibrary } from './mock'
import { updateSettings } from './settings'
import { extractVoice as asrExtract, splitVoice as asrSplit, transcribeDemo } from './asr'
import { extractVoiceIndex } from './voiceIndex'

export interface LibraryService {
  init(): Promise<void>
  list(): Promise<DemoMeta[]>
  detail(id: string): Promise<DemoDetail | null>
  /** 等待详情就绪（解析中自动等待/重解析），超时或失败返回 null */
  waitDetail(id: string, timeoutMs?: number): Promise<DemoDetail | null>
  addRoot(): Promise<string[]>
  removeRoot(root: string): Promise<void>
  setRoots(roots: string[]): Promise<void>
  rescan(): Promise<void>
  remove(id: string, opts?: { deleteFile?: boolean }): Promise<void>
  parse(id: string, force?: boolean): Promise<void>
  parseAll(): Promise<void>
  detectVoice(id: string): Promise<{ hasVoice: boolean; voiceSec: number }>
  extractVoice(id: string): Promise<number>
  splitVoice(id: string): Promise<number>
  transcribe(id: string, opts?: { players?: string[] }): Promise<void>
  cancelTranscribe(): void
  detectPlatformRoots(): Promise<DetectedPlatformRoot[]>
  autoAddPlatformRoots(): Promise<{ added: DetectedPlatformRoot[]; roots: string[] }>
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

  /** 转写/分割/AI 等待详情就绪失败时的友好提示（区分不存在/解析失败/未完成） */
  const notReadyMsg = (id: string): string => {
    const meta = store.index[id]
    if (!meta) return 'demo not found'
    if (meta.status === 'error') return '该 demo 解析失败，无法转写（可在详情页尝试重新解析）'
    return '该 demo 尚未解析完成，请稍候再试'
  }

  // 解析器版本：解析逻辑变更（如击杀阵营实时跟踪）时 +1，旧详情缓存自动失效重解析
  // v8: 修复控制器实体索引与 USER_INFO 偏移导致的选手错位与机器人污染，修正语音槽位
  const PARSER_VERSION = 8

  const libDir = () => join(app.getPath('userData'), 'library')
  const indexPath = () => join(libDir(), 'index.json')
  const detailPath = (id: string) => join(libDir(), `${id}.json`)
  const ignoredPath = () => join(libDir(), 'ignored.json')

  /** 用户手动从库移除的路径黑名单（删除后不会因扫描重新入库；文件更新/重下或主动重扫时自动解禁） */
  interface IgnoredEntry {
    path: string
    mtimeMs?: number
    ignoredAt: number
  }
  const ignoredMap = new Map<string, IgnoredEntry>()
  let ignoredFileMtime = 0

  const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')

  /**
   * 尝试从 demo 文件名中解析真实比赛日期/时间
   * 支持常见格式：
   * 1. auto-20240309-182822 / match-20240309-182822 / 20240309_182822
   * 2. 2024-03-09_18-28-22 / 2024-03-09 18:28:22
   * 3. 2024-03-09 纯日期（默认中午 12:00）
   */
  function parseDateFromFileName(fileName: string): number | undefined {
    // 1. 20240309-182822 或 20240309_182822
    const m1 = fileName.match(/(?:^|[^\d])(20\d{2})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})(?:[^\d]|$)/)
    if (m1) {
      const [, y, m, d, h, min, s] = m1
      const date = new Date(+y, +m - 1, +d, +h, +min, +s)
      const t = date.getTime()
      if (!isNaN(t) && date.getFullYear() >= 2012 && date.getFullYear() <= 2035) {
        return t
      }
    }
    // 2. 2024-03-09_18-28-22 或 2024-03-09 18:28:22
    const m2 = fileName.match(
      /(?:^|[^\d])(20\d{2})[-_.](\d{2})[-_.](\d{2})[T\s_]+(\d{2})[-_:.](\d{2})(?:[-_:.](\d{2}))?(?:[^\d]|$)/
    )
    if (m2) {
      const [, y, m, d, h, min, s = '0'] = m2
      const date = new Date(+y, +m - 1, +d, +h, +min, +s)
      const t = date.getTime()
      if (!isNaN(t) && date.getFullYear() >= 2012 && date.getFullYear() <= 2035) {
        return t
      }
    }
    // 3. 2024-03-09 纯日期
    const m3 = fileName.match(/(?:^|[^\d])(20\d{2})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/)
    if (m3) {
      const [, y, m, d] = m3
      const date = new Date(+y, +m - 1, +d, 12, 0, 0)
      const t = date.getTime()
      if (!isNaN(t) && date.getFullYear() >= 2012 && date.getFullYear() <= 2035) {
        return t
      }
    }
    return undefined
  }

  const loadIgnored = async () => {
    try {
      const st = await fs.stat(ignoredPath()).catch(() => null)
      if (st) ignoredFileMtime = st.mtimeMs
      const raw = await fs.readFile(ignoredPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      ignoredMap.clear()
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') {
            ignoredMap.set(normPath(item), { path: item, ignoredAt: ignoredFileMtime })
          } else if (item && typeof item === 'object' && typeof item.path === 'string') {
            ignoredMap.set(normPath(item.path), {
              path: item.path,
              mtimeMs: item.mtimeMs,
              ignoredAt: item.ignoredAt ?? ignoredFileMtime
            })
          }
        }
      }
    } catch {
      ignoredMap.clear()
    }
  }

  const saveIgnored = async () => {
    await fs.mkdir(libDir(), { recursive: true })
    const tmp = ignoredPath() + '.tmp'
    const arr = Array.from(ignoredMap.values())
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf-8')
    await fs.rename(tmp, ignoredPath())
  }

  /** 清理指定目录下的忽略项（用户主动添加目录或重新扫描时使用） */
  const unignoreUnder = (dirs: string[]) => {
    const normDirs = dirs.map(normPath)
    let changed = false
    for (const [normKey] of ignoredMap) {
      if (normDirs.some((nd) => normKey === nd || normKey.startsWith(nd + '/'))) {
        ignoredMap.delete(normKey)
        changed = true
      }
    }
    if (changed) {
      void saveIgnored().catch(() => {})
    }
  }

  /** 判断是否被忽略：若文件已被重新下载或修改（mtime 晚于被忽略的时间），自动解除忽略 */
  const isIgnored = (filePath: string, currentMtimeMs: number): boolean => {
    const norm = normPath(filePath)
    const entry = ignoredMap.get(norm)
    if (!entry) return false
    if (entry.mtimeMs && currentMtimeMs > entry.mtimeMs) {
      ignoredMap.delete(norm)
      void saveIgnored().catch(() => {})
      return false
    }
    if (entry.ignoredAt && currentMtimeMs > entry.ignoredAt) {
      ignoredMap.delete(norm)
      void saveIgnored().catch(() => {})
      return false
    }
    return true
  }

  const persistIndex = async () => {
    await safePersist(indexPath(), store.index)
  }

  const persistDetail = async (detail: DemoDetail) => {
    await safePersist(detailPath(detail.meta.id), { ...detail, parserVersion: PARSER_VERSION })
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
    dbg(`broadcast demos=${Object.keys(store.index).length}`)
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
      // 重新解析时保留已转写的语音（voice 由转写产生，解析不覆盖）
      const prevDetail = store.details.get(meta.id)
      store.details.set(meta.id, {
        meta: { ...meta },
        rounds: result.rounds,
        chat: result.chat,
        voice: prevDetail?.voice ?? [],
        firstTick: result.firstTick,
        lastTick: result.lastTick,
        parserVersion: PARSER_VERSION
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
  async function ensureZipEntry(
    zip: AdmZip,
    entry: { entryName: string; header?: { time?: Date | number } },
    id: string
  ): Promise<string> {
    const name = basename(entry.entryName.replace(/\\/g, '/'))
    const destPath = join(zipCacheDir(), id, name)
    let exists = false
    try {
      await fs.access(destPath)
      exists = true
    } catch {
      /* 缓存不存在 → 提取 */
    }
    if (!exists) {
      const data = zip.readFile(entry.entryName)
      if (!data) throw new Error(`无法读取压缩包内文件：${entry.entryName}`)
      await fs.mkdir(dirname(destPath), { recursive: true })
      await fs.writeFile(destPath, data)
    }

    // 同步将缓存文件的 mtime/atime 设为 zip 内部条目的真实比赛时间
    const rawTime =
      entry.header?.time instanceof Date
        ? entry.header.time
        : typeof entry.header?.time === 'number'
          ? new Date(entry.header.time)
          : null
    if (rawTime && !isNaN(rawTime.getTime())) {
      try {
        await fs.utimes(destPath, rawTime, rawTime)
      } catch {}
    }

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
      dbg(`scan found ${foundDems.length} demos + ${foundZips.length} zips in ${store.roots.length} roots`)
      const seen = new Set<string>()

      // ── 普通 .dem ──
      for (const path of foundDems) {
        let st
        try {
          st = await fs.stat(path)
        } catch {
          continue
        }
        if (isIgnored(path, st.mtimeMs)) continue
        const id = demoid(path, st.size, st.mtimeMs)
        seen.add(id)
        const fileName = path.split(/[\\/]/).pop() ?? path
        // 优先从文件名解析比赛时间，若无则使用文件系统 mtime
        const inferredDate = parseDateFromFileName(fileName) ?? st.mtimeMs

        const existing = store.index[id]
        if (existing) {
          // 自动纠偏：若已有真实文件名时间，更新 dateMs
          if (inferredDate && existing.dateMs && Math.abs(existing.dateMs - inferredDate) > 1000) {
            existing.dateMs = inferredDate
          }
          continue
        }
        const meta: DemoMeta = {
          id,
          path,
          fileName,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          dateMs: inferredDate,
          addedAt: Date.now(),
          status: 'pending'
        }
        store.index[id] = meta
      }

      // ── .zip 容器：把其中 .dem 提取到缓存，直接入库解析 ──
      for (const zp of foundZips) {
        let zst
        try {
          zst = await fs.stat(zp)
        } catch {
          continue
        }
        if (isIgnored(zp, zst.mtimeMs)) continue
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
          const newId = demoid(`${zp}|${name}`, e.header.size, 0)
          // 兼容旧缓存：622fc23 之前 id 含 zip mtime/size（demoid(zp|name, zst.size, zst.mtimeMs)）。
          // 若命中旧 id 条目（且容器一致），沿用旧 id —— 保留已解析/已转写状态，
          // 避免「重新扫描把旧条目当失效删光」导致列表清空。
          const legacyId = demoid(`${zp}|${name}`, zst.size, zst.mtimeMs)
          const legacy = store.index[legacyId]
          const id = legacy && legacy.containerPath === zp ? legacyId : newId
          seen.add(id)

          // 提取真实比赛时间：
          // 1. 文件名中解析出的比赛时间优先
          // 2. zip 内部条目的 header.time（对战平台服务器录制/打包真实时间）
          // 3. 兜底为 zip 下载保存时间
          const rawEntryTime =
            e.header.time instanceof Date
              ? e.header.time.getTime()
              : typeof e.header.time === 'number'
                ? e.header.time
                : undefined
          const validEntryTime =
            rawEntryTime && !isNaN(rawEntryTime) && rawEntryTime > 0 ? rawEntryTime : undefined
          const inferredDate = parseDateFromFileName(name) ?? validEntryTime ?? zst.mtimeMs

          const existing = store.index[id]
          if (existing && existing.containerPath === zp) {
            // 自动纠偏：若旧缓存仅记录了 zip 下载时间，更新为真实比赛时间
            if (inferredDate && existing.dateMs && Math.abs(existing.dateMs - inferredDate) > 1000) {
              existing.dateMs = inferredDate
            }
            continue
          }
          try {
            const cachePath = await ensureZipEntry(zip, e, id)
            store.index[id] = {
              id,
              path: cachePath,
              containerPath: zp,
              fileName: name,
              sizeBytes: e.header.size,
              mtimeMs: zst.mtimeMs,
              dateMs: inferredDate,
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
      async waitDetail(id) {
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
      async splitVoice() {
        return 0
      },
      async transcribe() {},
      cancelTranscribe() {},
      async detectPlatformRoots() {
        return []
      },
      async autoAddPlatformRoots() {
        return { added: [], roots: [] }
      }
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
        // 注意：zip 条目的 id 基于「容器路径+条目名+解压大小」计算（见 scan），
        // 不能用缓存 .dem 的 path/size/mtime 反推校验（必然不一致 → 启动即清空列表）。
        // 因此 zip 条目只校验缓存 .dem 文件存在；普通 .dem 才做完整指纹比对。
        let indexUpdated = false
        for (const id of Object.keys(store.index)) {
          const meta = store.index[id]
          try {
            await fs.stat(meta.path)
            if (!meta.containerPath) {
              const st = await fs.stat(meta.path)
              if (demoid(meta.path, st.size, st.mtimeMs) !== id) {
                delete store.index[id]
                indexUpdated = true
                continue
              }
            }
          } catch {
            delete store.index[id]
            indexUpdated = true
            continue
          }

          // 启动时检查纠偏真实比赛时间：
          // 1. 文件名包含真实时间
          const fromName = parseDateFromFileName(meta.fileName)
          if (fromName && (!meta.dateMs || Math.abs(meta.dateMs - fromName) > 1000)) {
            meta.dateMs = fromName
            indexUpdated = true
          } else if (
            meta.containerPath &&
            meta.dateMs &&
            meta.mtimeMs &&
            Math.abs(meta.dateMs - meta.mtimeMs) < 1000
          ) {
            // 2. zip 容器条目此前只保存了 zip 下载修改时间（dateMs === mtimeMs）
            try {
              if (extname(meta.containerPath).toLowerCase() === '.zip') {
                const zip = new AdmZip(meta.containerPath)
                const ent = zip
                  .getEntries()
                  .find(
                    (e) =>
                      !e.isDirectory && basename(e.entryName.replace(/\\/g, '/')) === meta.fileName
                  )
                if (ent?.header?.time instanceof Date && !isNaN(ent.header.time.getTime())) {
                  const entryTime = ent.header.time.getTime()
                  if (Math.abs(meta.dateMs - entryTime) > 1000) {
                    meta.dateMs = entryTime
                    indexUpdated = true
                  }
                }
              }
            } catch {}
          }
        }
        if (indexUpdated) {
          await persistIndex().catch(() => {})
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
      if (cached && cached.parserVersion === PARSER_VERSION) return cached
      try {
        const raw = await fs.readFile(detailPath(id), 'utf-8')
        const detail = JSON.parse(raw) as DemoDetail
        // 解析器版本不匹配（缓存是旧版解析结果）
        if (detail.parserVersion !== PARSER_VERSION) {
          const players = detail.meta?.players ?? (detail as any).players
          // 若为旧版缓存 (v6) 且所有玩家已有合法 slot，直接平滑升级版本，避免无谓重解析
          if (
            detail.parserVersion === 6 &&
            Array.isArray(players) &&
            players.length > 0 &&
            players.every((p) => typeof p.slot === 'number')
          ) {
            detail.parserVersion = PARSER_VERSION
            if (detail.meta) detail.meta.players = players
            if (store.index[id]) {
              detail.meta = { ...store.index[id], players }
              store.index[id].players = players
            }
            await safePersist(detailPath(id), detail).catch(() => {})
            store.details.set(id, detail)
            return detail
          }
          // 若为旧版缓存 (v6) 但部分玩家缺失 slot，尝试从 demo 文件轻量提取 voice slot 补充
          if (detail.parserVersion === 6 && Array.isArray(players) && players.length > 0) {
            const meta = store.index[id]
            if (meta?.path && players.some((p) => typeof p.slot !== 'number')) {
              try {
                const vi = await extractVoiceIndex(meta.path)
                for (const p of players) {
                  if (typeof p.slot !== 'number' && p.steamId && vi.slotByXuid[p.steamId] !== undefined) {
                    p.slot = vi.slotByXuid[p.steamId]
                  }
                }
                if (players.every((p) => typeof p.slot === 'number')) {
                  detail.parserVersion = PARSER_VERSION
                  if (detail.meta) detail.meta.players = players
                  if (store.index[id]) {
                    detail.meta = { ...store.index[id], players }
                    store.index[id].players = players
                  }
                  await safePersist(detailPath(id), detail).catch(() => {})
                  store.details.set(id, detail)
                  return detail
                }
              } catch {
                /* 轻量提取失败则回退为重解析 */
              }
            }
          }
          return null
        }
        if (store.index[id]) {
          detail.meta = { ...store.index[id] }
          if (detail.meta.players) {
            store.index[id].players = detail.meta.players
          }
        }
        store.details.set(id, detail)
        return detail
      } catch {
        return null
      }
    },

    /** 等待 demo 详情就绪（转写/分割/AI 对话共用）：
     *  解析中/待解析 → 轮询等待解析队列完成；ready 但缓存缺失（版本不匹配/被清理）→ 自动触发重解析。
     *  返回 null = demo 不存在 / 解析失败 / 超时 */
    async waitDetail(id: string, timeoutMs = 180000): Promise<DemoDetail | null> {
      const meta = store.index[id]
      if (!meta) return null
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const d = await this.detail(id)
        if (d) return d
        if (meta.status === 'error') return null // 解析失败不再等
        if (meta.status === 'ready') await this.parse(id) // 缓存缺失 → 重解析
        await new Promise((r) => setTimeout(r, 500))
      }
      return null
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
      // 用户主动添加目录：清理所选目录下的忽略黑名单，确保新添加的目录可以完整扫描入库
      unignoreUnder(res.filePaths)
      await this.setRoots(merged)
      return merged
    },

    async removeRoot(root: string) {
      await this.setRoots(store.roots.filter((r) => r !== root))
    },

    async setRoots(roots: string[]) {
      store.roots = roots
      await updateSettings({ libraryRoots: roots })
      // 用户主动添加/移除目录 → 立即等待扫描完成
      await scan()
    },

    async rescan() {
      // 重新扫描：用户主动全量刷新，清理当前监控 roots 下的忽略黑名单，确保所有本地 demo 都能被扫描到
      unignoreUnder(store.roots)
      // 等扫描完成再返回（renderer await 后重新 list 能拿到新结果）
      await scan()
    },

    /** 手动解析单个 demo（把条目加入解析队列）；force=true 时已解析的也重新解析（刷新统计，保留已转写语音） */
    async parse(id: string, force = false) {
      const meta = store.index[id]
      if (!meta || meta.status === 'parsing') return
      // detail 缓存版本不匹配（解析器升级）→ 即使 meta.status=ready 也重新解析
      let stale = false
      if (meta.status === 'ready') {
        const cached = store.details.get(id)
        if (!cached || cached.parserVersion !== PARSER_VERSION) stale = true
      }
      if (meta.status === 'ready' && !force && !stale) return
      if (stale || force) {
        meta.status = 'pending'
        meta.error = undefined
      }
      if (!store.queue.some((q) => q.id === id)) store.queue.push(meta)
      void pump()
    },

    /** 手动解析全部待解析 demo */
    async parseAll() {
      for (const meta of Object.values(store.index)) {
        if (meta.status === 'parsing') continue
        let stale = false
        if (meta.status === 'ready') {
          const cached = store.details.get(meta.id)
          if (!cached || cached.parserVersion !== PARSER_VERSION) stale = true
        }
        if (meta.status === 'ready' && !stale) continue
        if (stale) {
          meta.status = 'pending'
          meta.error = undefined
        }
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
      const norm = normPath(ignoreKey)
      if (!opts?.deleteFile) {
        // 仅移出资料库时记入忽略列表，记录修改时间与当前时间
        ignoredMap.set(norm, {
          path: ignoreKey,
          mtimeMs: meta.mtimeMs,
          ignoredAt: Date.now()
        })
      } else {
        // 彻底删除文件时，从忽略列表中清除（防止未来重新下载同名文件被屏蔽）
        ignoredMap.delete(norm)
      }
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
      const detail = await this.waitDetail(id)
      if (!detail) throw new Error(notReadyMsg(id))
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

    async splitVoice(id: string) {
      const detail = await this.waitDetail(id)
      if (!detail) throw new Error(notReadyMsg(id))
      const segments = await asrSplit(
        detail,
        {
          progress: (stage, done, total, message) =>
            emit('asr:progress', { demoId: id, stage, done, total, message }),
          segment: () => {}
        },
        transcribeSignal?.signal
      )
      // 分割结果暂存到 detail.voice（无文字；若已有转写结果则合并去重）
      const cached = store.details.get(id)
      const existing = new Set(
        (cached?.voice ?? detail.voice ?? []).map((v) => `${v.playerName}|${v.timeSec}`)
      )
      const merged = [...(cached?.voice ?? detail.voice ?? [])]
      for (const s of segments) {
        const key = `${s.playerName}|${s.startSec}`
        if (existing.has(key)) continue
        merged.push({
          tick: s.tick,
          endTick: s.endTick,
          timeSec: s.startSec,
          endSec: s.endSec,
          playerName: s.playerName,
          steamId: s.steamId,
          team: s.team,
          text: '',
          roundNum: undefined,
          engine: 'local'
        })
        existing.add(key)
      }
      merged.sort((a, b) => a.tick - b.tick)
      if (cached) {
        cached.voice = merged
        await persistDetail(cached).catch(() => {})
      } else {
        detail.voice = merged
        await persistDetail(detail).catch(() => {})
      }
      return segments.length
    },

    async transcribe(id: string, opts?: { players?: string[] }) {
      const detail = await this.waitDetail(id)
      if (!detail) throw new Error(notReadyMsg(id))
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
          language: settings.asr.language,
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
    },

    /** 自动探测本地常见对战平台 Demo 目录（完美世界、5E 对战平台、Steam 官方） */
    async detectPlatformRoots(): Promise<DetectedPlatformRoot[]> {
      const results: DetectedPlatformRoot[] = []
      const checked = new Set<string>()

      const addCandidate = async (
        platform: 'wmpvp' | '5eplay' | 'steam' | 'other',
        name: string,
        dir: string
      ) => {
        if (!dir) return
        const norm = normPath(dir)
        if (checked.has(norm)) return
        checked.add(norm)
        try {
          const st = await fs.stat(dir).catch(() => null)
          if (st && st.isDirectory()) {
            const files = await fs.readdir(dir).catch(() => [] as string[])
            const demoCount = files.filter((f) => /\.dem$|\.zip$/i.test(f)).length
            results.push({ platform, name, path: dir, demoCount })
          }
        } catch {
          /* noop */
        }
      }

      // 1. 完美世界对战平台 (Wmpvp)
      const appData = process.env.APPDATA || ''
      const localAppData = process.env.LOCALAPPDATA || ''
      if (appData) await addCandidate('wmpvp', '完美世界对战平台 (Wmpvp)', join(appData, 'Wmpvp', 'demo'))
      if (localAppData) await addCandidate('wmpvp', '完美世界对战平台 (Local)', join(localAppData, 'Wmpvp', 'demo'))

      // 2. 5E 对战平台 (5EPlay)
      const drives = ['C', 'D', 'E', 'F', 'G']
      for (const d of drives) {
        await addCandidate('5eplay', `5E 对战平台 (${d}:\\5EDemocache)`, `${d}:\\5EDemocache`)
      }
      if (appData) await addCandidate('5eplay', '5E 对战平台 (Client)', join(appData, '5EClient', 'demo'))
      if (localAppData) await addCandidate('5eplay', '5E 对战平台 (Local)', join(localAppData, '5EClient', 'demo'))

      // 3. Steam CS2 录像目录
      const settings = await getSettings()
      if (settings.cs2?.installPath) {
        await addCandidate('steam', 'CS2 官方录像 (demos)', join(settings.cs2.installPath, 'game', 'csgo', 'demos'))
        await addCandidate('steam', 'CS2 官方录像 (replays)', join(settings.cs2.installPath, 'game', 'csgo', 'replays'))
      }
      const commonSteamPaths = [
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
        'D:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
        'E:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive'
      ]
      for (const sp of commonSteamPaths) {
        await addCandidate('steam', 'CS2 官方录像 (demos)', join(sp, 'game', 'csgo', 'demos'))
        await addCandidate('steam', 'CS2 官方录像 (replays)', join(sp, 'game', 'csgo', 'replays'))
      }

      return results
    },

    /** 自动将探测到的平台目录加入监控列表（保留已有目录不覆盖）并触发扫描 */
    async autoAddPlatformRoots(): Promise<{ added: DetectedPlatformRoot[]; roots: string[] }> {
      const detected = await this.detectPlatformRoots()
      const normExisting = new Set(store.roots.map(normPath))
      const toAdd = detected.filter((d) => !normExisting.has(normPath(d.path)))
      if (toAdd.length > 0) {
        const merged = [...new Set([...store.roots, ...toAdd.map((d) => d.path)])]
        unignoreUnder(toAdd.map((d) => d.path))
        await this.setRoots(merged)
        return { added: toAdd, roots: merged }
      }
      return { added: [], roots: store.roots }
    }
  }
}
