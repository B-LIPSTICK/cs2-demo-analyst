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
import { parseDemo, cleanPlayerName } from './parser'
import { getMockDetail, getMockLibrary } from './mock'
import { updateSettings } from './settings'
import { extractVoice as asrExtract, splitVoice as asrSplit, transcribeDemo } from './asr'
import { extractVoiceIndex, pruneVoiceIndexCache, removeVoiceIndexCache } from './voiceIndex'

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
  /** 取消转写/分割/提取任务：传 id 只取消该 demo，省略 id 取消全部（兼容旧调用） */
  cancelTranscribe(id?: string): void
  detectPlatformRoots(): Promise<DetectedPlatformRoot[]>
  autoAddPlatformRoots(): Promise<{ added: DetectedPlatformRoot[]; roots: string[] }>
}

interface Store {
  index: Record<string, DemoMeta>
  details: Map<string, DemoDetail>
  roots: string[]
  queue: DemoMeta[]
  parsing: boolean
  /** index.json 是否成功加载（不存在视为首次运行）；false 时禁止清理任何缓存 */
  indexLoadOk: boolean
}

/** zip 中央目录缓存：避免每次重新扫描都把整个 zip 读进内存（大压缩包会卡住主进程） */
interface ZipEntryMeta {
  /** zip 内部完整条目名（可能含目录，用于解压） */
  entryName: string
  /** 去掉目录后的文件名（用于展示/ID） */
  name: string
  size: number
  timeMs?: number
}

interface ZipCacheEntry {
  size: number
  mtimeMs: number
  entries: ZipEntryMeta[]
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

  // ─── ASR 任务取消（按 demo + 任务类型隔离，避免并发任务互相取消） ───────
  type AsrJobKind = 'transcribe' | 'split' | 'extract'
  /** key = `${demoId}:${kind}`；同一任务重复启动时用 Set 保留每个 controller */
  const asrJobs = new Map<string, Set<AbortController>>()

  /** 注册一个可取消的 ASR 任务，返回该任务独立的 signal 与清理函数 */
  const beginAsrJob = (demoId: string, kind: AsrJobKind) => {
    const controller = new AbortController()
    const key = `${demoId}:${kind}`
    let controllers = asrJobs.get(key)
    if (!controllers) {
      controllers = new Set<AbortController>()
      asrJobs.set(key, controllers)
    }
    controllers.add(controller)
    return {
      signal: controller.signal,
      finish: () => {
        const current = asrJobs.get(key)
        if (!current) return
        current.delete(controller)
        if (current.size === 0) asrJobs.delete(key)
      }
    }
  }

  /** 取消指定 demo 的全部 ASR 任务；不传 id 时取消全部（兼容旧调用） */
  const cancelAsrJobs = (id?: string) => {
    const prefix = id ? `${id}:` : ''
    for (const [key, controllers] of asrJobs) {
      if (prefix && !key.startsWith(prefix)) continue
      for (const controller of controllers) controller.abort()
      asrJobs.delete(key)
    }
  }

  const store: Store = {
    index: {},
    details: new Map(),
    roots: [],
    queue: [],
    parsing: false,
    indexLoadOk: false
  }

  /** 转写/分割/AI 等待详情就绪失败时的友好提示（区分不存在/解析失败/未完成） */
  const notReadyMsg = (id: string): string => {
    const meta = store.index[id]
    if (!meta) return 'demo not found'
    if (meta.status === 'error') return '该 demo 解析失败，无法转写（可在详情页尝试重新解析）'
    return '该 demo 尚未解析完成，请稍候再试'
  }

  /** 记录并广播资料库级错误（索引损坏/清理被跳过等），避免静默失败 */
  const reportLibraryError = (message: string, extra?: { backupPath?: string }) => {
    console.error(`[library] ${message}`)
    dbg(message)
    try {
      emit('library:error', { message, ...(extra ?? {}) })
    } catch {
      /* 广播失败不影响初始化/扫描主流程 */
    }
  }

  // 解析器版本：解析逻辑变更（如击杀阵营实时跟踪）时 +1，旧详情缓存自动失效重解析
  // v8: 修复控制器实体索引与 USER_INFO 偏移导致的选手错位与机器人污染，修正语音槽位
  // v9: 收尾优化提升详情缓存版本，使旧缓存失效并按当前解析器重解析（本次未改解析逻辑）
  const PARSER_VERSION = 9

  /** 源文件暂时不可访问时的统一标记（目录离线/网络盘未挂载等），scan 恢复后清除 */
  const OFFLINE_ERROR = '文件不可用（目录可能离线）'

  // 持久化临时文件的单调序号，避免同一毫秒内重名
  let persistSeq = 0

  // zip 中央目录缓存：key = normPath(zip 路径)，仅当 zip 的 size+mtime 变化时才重新打开
  let zipCache: Record<string, ZipCacheEntry> = {}
  let zipCacheDirty = false

  const libDir = () => join(app.getPath('userData'), 'library')
  const indexPath = () => join(libDir(), 'index.json')
  const detailPath = (id: string) => join(libDir(), `${id}.json`)
  const ignoredPath = () => join(libDir(), 'ignored.json')
  const zipCachePath = () => join(libDir(), 'zip-cache.json')

  /** 备份损坏的 index.json（只复制，不删除原文件）；返回备份路径，失败返回 null */
  const backupCorruptIndex = async (): Promise<string | null> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(libDir(), `index.corrupt.${stamp}.json`)
    try {
      await fs.mkdir(libDir(), { recursive: true })
      await fs.copyFile(indexPath(), dest)
      dbg(`corrupt index backed up to ${dest}`)
      return dest
    } catch (err) {
      console.error('[library] 备份损坏的 index.json 失败', err)
      dbg(`backup corrupt index failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** 用户手动从库移除的路径黑名单（删除后不会因扫描重新入库；文件更新/重下或主动重扫时自动解禁） */
  interface IgnoredEntry {
    path: string
    mtimeMs?: number
    ignoredAt: number
  }

  function sanitizeDetailPlayerNames(detail: DemoDetail): void {
    if (detail.meta?.players) {
      for (const p of detail.meta.players) {
        if (p.name) p.name = cleanPlayerName(p.name)
      }
    }
    if (detail.chat) {
      for (const c of detail.chat) {
        if (c.playerName) c.playerName = cleanPlayerName(c.playerName)
      }
    }
    if (detail.voice) {
      for (const v of detail.voice) {
        if (v.playerName) v.playerName = cleanPlayerName(v.playerName)
      }
    }
    if (detail.rounds) {
      for (const r of detail.rounds) {
        if (r.kills) {
          for (const k of r.kills) {
            if (k.attackerName) k.attackerName = cleanPlayerName(k.attackerName)
            if (k.victimName) k.victimName = cleanPlayerName(k.victimName)
          }
        }
        if (r.firstKill) {
          if (r.firstKill.attackerName) r.firstKill.attackerName = cleanPlayerName(r.firstKill.attackerName)
          if (r.firstKill.victimName) r.firstKill.victimName = cleanPlayerName(r.firstKill.victimName)
        }
      }
    }
  }
  const ignoredMap = new Map<string, IgnoredEntry>()
  let ignoredFileMtime = 0

  const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')

  /** 判断路径是否位于指定 root 下（两侧均已归一化） */
  const isUnderRoot = (p: string, root: string): boolean => {
    const np = normPath(p)
    const nr = normPath(root)
    return np === nr || np.startsWith(nr + '/')
  }

  /** 找到条目所属的监控 root（取最长前缀，兼容嵌套 root）；不在任何 root 下返回 undefined */
  const rootForPath = (p: string): string | undefined => {
    let best: string | undefined
    let bestLen = -1
    for (const root of store.roots) {
      const nr = normPath(root)
      if (isUnderRoot(p, root) && nr.length > bestLen) {
        best = root
        bestLen = nr.length
      }
    }
    return best
  }

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
  /** 覆盖 detail 前备份旧文件：解析器升级/异常时可人工恢复 */
  const backupDetail = async (id: string) => {
    try {
      const raw = await fs.readFile(detailPath(id), 'utf-8')
      const dir = join(libDir(), 'backup')
      await fs.mkdir(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = join(dir, `${id}.${stamp}.json`)
      await fs.writeFile(dest, raw, 'utf-8')
      // 每个 demo 只保留最近 2 份
      const files = (await fs.readdir(dir))
        .filter((f) => f.startsWith(`${id}.`) && f.endsWith('.json'))
        .sort()
      for (const f of files.slice(0, Math.max(0, files.length - 2))) {
        await fs.unlink(join(dir, f)).catch(() => {})
      }
    } catch {
      /* 首次解析/备份失败不影响主流程 */
    }
  }


  /** 原子写 + 容错：rename 覆盖失败（Windows 占用/杀软）时先删目标再重试 */
  async function safePersist(target: string, data: unknown): Promise<void> {
    await fs.mkdir(dirname(target), { recursive: true })
    // 临时文件名带 pid + 单调序号 + 随机串：扫描/解析并发写同一目标时不会互相覆盖
    const tmp = `${target}.${process.pid}.${++persistSeq}.${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify(data), 'utf-8')
      try {
        await fs.rename(tmp, target)
      } catch {
        await fs.unlink(target).catch(() => {})
        await fs.rename(tmp, target)
      }
    } catch (err) {
      await fs.unlink(tmp).catch(() => {})
      throw err
    }
  }

  /** 让出一次事件循环：扫描大量文件/压缩包时保持窗口可响应 */
  const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

  const loadZipCache = async () => {
    try {
      const raw = await fs.readFile(zipCachePath(), 'utf-8')
      const parsed = JSON.parse(raw) as { version?: number; zips?: Record<string, ZipCacheEntry> }
      zipCache = {}
      if (parsed?.version === 1 && parsed.zips && typeof parsed.zips === 'object') {
        for (const [key, value] of Object.entries(parsed.zips)) {
          const v = value as ZipCacheEntry
          if (!v || typeof v.size !== 'number' || typeof v.mtimeMs !== 'number' || !Array.isArray(v.entries)) {
            continue
          }
          const entries = v.entries.filter(
            (e): e is ZipEntryMeta =>
              Boolean(e) &&
              typeof e.entryName === 'string' &&
              typeof e.name === 'string' &&
              typeof e.size === 'number'
          )
          zipCache[key] = { size: v.size, mtimeMs: v.mtimeMs, entries }
        }
      }
    } catch {
      zipCache = {}
    }
    zipCacheDirty = false
  }

  const saveZipCache = async () => {
    if (!zipCacheDirty) return
    try {
      await safePersist(zipCachePath(), { version: 1, zips: zipCache })
      zipCacheDirty = false
    } catch (err) {
      dbg(`saveZipCache failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const getCachedZipEntries = (
    zp: string,
    size: number,
    mtimeMs: number
  ): ZipEntryMeta[] | null => {
    const cached = zipCache[normPath(zp)]
    if (!cached || cached.size !== size || cached.mtimeMs !== mtimeMs) return null
    return cached.entries
  }

  const setCachedZipEntries = (
    zp: string,
    size: number,
    mtimeMs: number,
    entries: ZipEntryMeta[]
  ) => {
    zipCache[normPath(zp)] = { size, mtimeMs, entries }
    zipCacheDirty = true
  }

  /** adm-zip 的 readFile 是同步解压；用 readFileAsync 避免大 demo 解压时阻塞主进程 */
  const readZipEntryAsync = (zip: AdmZip, entryName: string): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      zip.readFileAsync(entryName, (data, err) => {
        if (data) resolve(data)
        else reject(new Error(err || `无法读取压缩包内文件：${entryName}`))
      })
    })

  /** 首次升级到 zip 缓存版本时，用现有 index 里未变化的 zip 条目预热缓存，避免第一次 rescan 仍要读全部压缩包 */
  const seedZipCacheFromIndex = async () => {
    const byContainer = new Map<string, DemoMeta[]>()
    for (const meta of Object.values(store.index)) {
      if (!meta.containerPath) continue
      const arr = byContainer.get(meta.containerPath) ?? []
      arr.push(meta)
      byContainer.set(meta.containerPath, arr)
    }
    for (const [zp, metas] of byContainer) {
      if (zipCache[normPath(zp)]) continue
      try {
        const st = await fs.stat(zp)
        const expectedMtime = metas[0]?.mtimeMs
        // zip 已被平台改写时不要用旧 index 预热，交给 scan 重新读取
        if (expectedMtime && Math.abs(st.mtimeMs - expectedMtime) > 1000) continue
        zipCache[normPath(zp)] = {
          size: st.size,
          mtimeMs: st.mtimeMs,
          entries: metas.map((m) => ({
            entryName: m.fileName,
            name: m.fileName,
            size: m.sizeBytes,
            timeMs: m.dateMs && m.dateMs > 0 ? m.dateMs : undefined
          }))
        }
        zipCacheDirty = true
      } catch {
        /* 目录离线：保留旧 index，等 scan 恢复 */
      }
    }
    await saveZipCache()
  }

  const broadcast = () => {
    dbg(`broadcast demos=${Object.keys(store.index).length}`)
    // 载荷必须带 { demos } 包装（renderer 按 e.demos 读取；之前发裸数组导致 e.demos=undefined → setDemos(undefined) → 渲染崩溃）
    emit('library:updated', {
      demos: Object.values(store.index).sort((a, b) => b.addedAt - a.addedAt)
    })
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
    // 立即单条广播：即使解析器还没来得及发第一条 progress，卡片也能马上进入解析态
    emit('library:item', { id: meta.id, meta: { ...meta } })
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
      // store.details 是懒加载的：不能只查内存，否则 PARSER_VERSION 升级后的全量重解析会清空语音。
      let prevVoice = store.details.get(meta.id)?.voice
      if (!prevVoice || prevVoice.length === 0) {
        try {
          const raw = await fs.readFile(detailPath(meta.id), 'utf-8')
          const cached = JSON.parse(raw) as DemoDetail
          if (Array.isArray(cached.voice)) prevVoice = cached.voice
        } catch {
          /* 首次解析或旧 detail 不存在 */
        }
      }
      // 覆盖前备份旧 detail，解析器升级/异常时仍可恢复
      await backupDetail(meta.id)
      store.details.set(meta.id, {
        meta: { ...meta },
        rounds: result.rounds,
        chat: result.chat,
        voice: prevVoice ?? [],
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
      // 源文件仍不可访问时保留离线标记：root 恢复后 scan 才能识别并自动清除错误
      const accessible = await fs.stat(meta.path).then(
        () => true,
        () => false
      )
      meta.error = accessible ? (err instanceof Error ? err.message : String(err)) : OFFLINE_ERROR
    }
    // 单条目更新（只刷新这一张卡片，不广播全列表）
    emit('library:item', { id: meta.id, meta: { ...meta } })
  }

  // ─── 扫描 ─────────────────────────────────────────────────────────────────

  /** 一次遍历同时收集 .dem 和 .zip，避免每个根目录走两遍 */
  async function walkAll(dir: string, dems: string[], zips: string[]): Promise<void> {
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
        await walkAll(p, dems, zips)
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase()
        if (ext === '.dem') dems.push(p)
        else if (ext === '.zip') zips.push(p)
      }
    }
  }

  /** zip 内 .dem 的缓存目录（userData/cache/zips/<id>/） */
  const zipCacheDir = () => join(app.getPath('userData'), 'cache', 'zips')

  /** 把 zip 内的 .dem 条目提取到缓存文件（解析/播放均用缓存路径） */
  async function ensureZipEntry(
    zip: AdmZip,
    entryName: string,
    id: string,
    timeMs?: number
  ): Promise<string> {
    const name = basename(entryName.replace(/\\/g, '/'))
    const destPath = join(zipCacheDir(), id, name)
    let exists = false
    try {
      await fs.access(destPath)
      exists = true
    } catch {
      /* 缓存不存在 → 提取 */
    }
    if (!exists) {
      let data: Buffer
      try {
        data = await readZipEntryAsync(zip, entryName)
      } catch (err) {
        // 预热的缓存可能只有 basename（旧 index 没有保存 zip 内部目录）；按 basename 再找一次
        const found = zip
          .getEntries()
          .find(
            (e) =>
              !e.isDirectory &&
              basename(e.entryName.replace(/\\/g, '/')) === basename(entryName.replace(/\\/g, '/'))
          )
        if (!found) throw err
        data = await readZipEntryAsync(zip, found.entryName)
      }
      await fs.mkdir(dirname(destPath), { recursive: true })
      await fs.writeFile(destPath, data)
    }

    // 同步将缓存文件的 mtime/atime 设为 zip 内部条目的真实比赛时间
    if (typeof timeMs === 'number' && Number.isFinite(timeMs) && timeMs > 0) {
      const rawTime = new Date(timeMs)
      try {
        await fs.utimes(destPath, rawTime, rawTime)
      } catch {}
    }

    return destPath
  }

  const scan = async () => {
    let scanTotalZips = 0
    try {
      const foundDems: string[] = []
      const foundZips: string[] = []
      emit('library:scan', { phase: 'walk', done: 0, total: store.roots.length })
      await Promise.all(store.roots.map((r) => walkAll(r, foundDems, foundZips)))
      scanTotalZips = foundZips.length
      dbg(`scan found ${foundDems.length} demos + ${foundZips.length} zips in ${store.roots.length} roots`)
      emit('library:scan', { phase: 'zip', done: 0, total: scanTotalZips })
      const seen = new Set<string>()

      // 记录本轮扫描中暂时读不到的文件/容器：清理时跳过，避免把「临时不可访问」误判为删除
      const statFailedPaths = new Set<string>()
      const unreadableContainers = new Set<string>()

      // 根目录可访问性缓存（每轮扫描只探测一次）
      const rootAccessCache = new Map<string, boolean>()
      const isRootAccessible = async (root: string): Promise<boolean> => {
        const key = normPath(root)
        const cached = rootAccessCache.get(key)
        if (cached !== undefined) return cached
        let ok = false
        try {
          const st = await fs.stat(root)
          if (st.isDirectory()) {
            // 用 opendir 验证目录确实可读；仅 stat 成功不足以说明网络盘/权限正常
            const dh = await fs.opendir(root)
            await dh.close()
            ok = true
          }
        } catch {
          ok = false
        }
        rootAccessCache.set(key, ok)
        return ok
      }

      // ── 普通 .dem ──
      for (const path of foundDems) {
        let st
        try {
          st = await fs.stat(path)
        } catch {
          // 文件临时不可读（占用/权限/目录抖动）：本轮不判定失效
          statFailedPaths.add(normPath(path))
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
          // root 恢复可访问后：清除「文件不可用」错误，恢复为 pending/ready，不重复创建条目
          if (existing.status === 'error' && existing.error === OFFLINE_ERROR) {
            existing.status = existing.roundCount != null ? 'ready' : 'pending'
            existing.error = undefined
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
      let zipDone = 0
      for (const zp of foundZips) {
        zipDone++
        emit('library:scan', { phase: 'zip', done: zipDone, total: scanTotalZips })
        let zst
        try {
          zst = await fs.stat(zp)
        } catch {
          unreadableContainers.add(normPath(zp))
          continue
        }
        if (isIgnored(zp, zst.mtimeMs)) continue

        // 未变化的 zip 直接使用持久化中央目录缓存，避免每次 rescan 都同步读取整个压缩包
        let entries: ZipEntryMeta[] | null = getCachedZipEntries(zp, zst.size, zst.mtimeMs)
        let zip: AdmZip | null = null
        if (!entries) {
          // 打开新/变化的压缩包前先让出事件循环，避免连续同步读盘把窗口卡住
          await yieldToLoop()
          try {
            zip = new AdmZip(zp)
            entries = zip
              .getEntries()
              .filter((e) => !e.isDirectory && /\.dem$/i.test(e.entryName))
              .map((e) => {
                const rawTime = e.header.time
                const timeMs =
                  rawTime instanceof Date
                    ? rawTime.getTime()
                    : typeof rawTime === 'number'
                      ? rawTime
                      : undefined
                return {
                  entryName: e.entryName,
                  name: basename(e.entryName.replace(/\\/g, '/')),
                  size: e.header.size,
                  timeMs:
                    typeof timeMs === 'number' && Number.isFinite(timeMs) && timeMs > 0
                      ? timeMs
                      : undefined
                }
              })
            setCachedZipEntries(zp, zst.size, zst.mtimeMs, entries)
          } catch {
            unreadableContainers.add(normPath(zp))
            continue
          }
          await yieldToLoop()
        }
        if (!entries) continue

        const ensureZip = async (): Promise<AdmZip> => {
          if (!zip) {
            await yieldToLoop()
            zip = new AdmZip(zp)
          }
          return zip
        }

        for (const e of entries) {
          const name = e.name
          // id 只依赖 zip 路径 + 内部条目名 + 解压大小（不含 zip mtime/size）：
          // 完美平台会持续改写 zip 文件，若把 mtime 纳入 key，解析结果会被反复清成 pending
          const newId = demoid(`${zp}|${name}`, e.size, 0)
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
          const validEntryTime = e.timeMs && e.timeMs > 0 ? e.timeMs : undefined
          const inferredDate = parseDateFromFileName(name) ?? validEntryTime ?? zst.mtimeMs

          const existing = store.index[id]
          if (existing && existing.containerPath === zp) {
            // 自动纠偏：若旧缓存仅记录了 zip 下载时间，更新为真实比赛时间
            if (inferredDate && existing.dateMs && Math.abs(existing.dateMs - inferredDate) > 1000) {
              existing.dateMs = inferredDate
            }
            // 缓存 .dem 可能被手动清理/上次异常退出丢失：容器可读时重新提取，避免误判条目失效
            let cacheOk = false
            try {
              await fs.access(existing.path)
              cacheOk = true
            } catch {
              try {
                existing.path = await ensureZipEntry(
                  await ensureZip(),
                  e.entryName,
                  id,
                  validEntryTime
                )
                cacheOk = true
              } catch (err) {
                dbg(
                  `zip entry re-extract failed ${zp} ${name}: ${err instanceof Error ? err.message : String(err)}`
                )
              }
            }
            // 容器与缓存都恢复可访问后：清除离线错误，恢复为 pending/ready
            if (cacheOk && existing.status === 'error' && existing.error === OFFLINE_ERROR) {
              existing.status = existing.roundCount != null ? 'ready' : 'pending'
              existing.error = undefined
            }
            continue
          }
          try {
            const cachePath = await ensureZipEntry(
              await ensureZip(),
              e.entryName,
              id,
              validEntryTime
            )
            store.index[id] = {
              id,
              path: cachePath,
              containerPath: zp,
              fileName: name,
              sizeBytes: e.size,
              mtimeMs: zst.mtimeMs,
              dateMs: inferredDate,
              addedAt: Date.now(),
              status: 'pending'
            }
          } catch (err) {
            dbg(`zip entry failed ${zp} ${name}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        // 及时释放压缩包内存（下一个 zip 再重新打开）
        zip = null
        await yieldToLoop()
      }

      // ── 清理失效条目（源文件/容器消失或变更）──
      // 容错原则：只有「用户主动移除 root」或「index 正常且 root 可访问」时才删除；
      // 目录离线/网络盘未挂载/文件临时读不到时保留条目与详情，等待下次扫描恢复。
      for (const id of Object.keys(store.index)) {
        if (seen.has(id)) continue
        const meta = store.index[id]
        if (!meta) continue

        // 本轮扫描明确读不到的文件/容器：可能是临时占用或权限问题，先保留
        if (!meta.containerPath && statFailedPaths.has(normPath(meta.path))) {
          dbg(`scan keep unreadable demo: ${id}`)
          continue
        }
        if (meta.containerPath && unreadableContainers.has(normPath(meta.containerPath))) {
          dbg(`scan keep entry of unreadable container: ${id}`)
          continue
        }

        // zip 条目按容器路径归属 root，不能用缓存路径判断（否则会误删）
        const sourcePath = meta.containerPath ?? meta.path
        const root = rootForPath(sourcePath)
        if (root) {
          const accessible = await isRootAccessible(root)
          if (!accessible) {
            // root 当前不可访问：保留条目，标记为离线错误（详情文件同样保留）
            if (meta.status !== 'error' || meta.error !== OFFLINE_ERROR) {
              meta.status = 'error'
              meta.error = OFFLINE_ERROR
            }
            dbg(`scan keep entry under inaccessible root: ${id} root=${root}`)
            continue
          }
          if (!store.indexLoadOk) {
            // index 加载异常时保守处理：即使 root 可访问也不做失效清理
            dbg(`scan skip cleanup because indexLoadOk=false: ${id}`)
            continue
          }
        }

        // root 已从监控列表移除，或 index 正常且 root 可访问：确认失效，清理
        delete store.index[id]
        store.details.delete(id)
        fs.unlink(detailPath(id)).catch(() => {})
        if (meta.containerPath) {
          fs.rm(join(zipCacheDir(), id), { recursive: true, force: true }).catch(() => {})
          delete zipCache[normPath(meta.containerPath)]
          zipCacheDirty = true
        }
      }
    } catch (err) {
      dbg(`scan failed: ${err instanceof Error ? err.message : String(err)}`)
      console.error('[library] scan failed', err)
    } finally {
      emit('library:scan', { phase: 'done', done: scanTotalZips, total: scanTotalZips })
      broadcast()
      // index 读取失败时不要用本轮扫描结果覆盖损坏的原文件
      if (store.indexLoadOk) await persistIndex().catch(() => {})
      await saveZipCache()
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
        // 先保守置 false：只有确认 index.json 不存在或成功解析后才允许清理缓存
        store.indexLoadOk = false
        try {
          const raw = await fs.readFile(indexPath(), 'utf-8')
          const parsed = JSON.parse(raw) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('index.json 根节点不是对象')
          }
          store.index = parsed as Record<string, DemoMeta>
          store.indexLoadOk = true
          for (const id of Object.keys(store.index)) {
            const meta = store.index[id]
            if (Array.isArray(meta?.players)) {
              for (const p of meta.players) {
                if (p.name) p.name = cleanPlayerName(p.name)
              }
            }
          }
        } catch (err) {
          store.index = {}
          const code = (err as NodeJS.ErrnoException)?.code
          if (code === 'ENOENT') {
            // index.json 不存在 = 首次运行，允许正常清理（此时本来也没有条目）
            store.indexLoadOk = true
            dbg('index.json not found, treat as first run')
          } else {
            // 读取/解析失败：备份损坏文件，跳过一切孤儿清理，绝不删除原文件
            store.indexLoadOk = false
            const backupPath = await backupCorruptIndex()
            const reason = err instanceof Error ? err.message : String(err)
            const msg = backupPath
              ? `资料库索引读取失败（${reason}），已备份为 ${backupPath}；本次跳过缓存清理`
              : `资料库索引读取失败（${reason}），备份也失败；本次跳过缓存清理`
            reportLibraryError(msg, backupPath ? { backupPath } : undefined)
          }
        }
        await loadIgnored()
        await loadZipCache()
        await seedZipCacheFromIndex()
        // 清理孤儿 zip 缓存（index 里不存在的缓存目录，如上次退出未落盘时遗留）
        // index 异常时跳过：store.index 为空会把全部 zip 缓存当孤儿删掉
        if (store.indexLoadOk) {
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
        } else {
          dbg('skip orphan zip cache cleanup because indexLoadOk=false')
        }
        // 清理孤儿详情缓存（index 里不存在的 detail json）
        // index 异常时跳过：store.index 为空会把全部 detail JSON 当孤儿删掉
        if (store.indexLoadOk) {
          try {
            const files = await fs.readdir(libDir()).catch(() => [] as string[])
            for (const f of files) {
              if (
                !f.endsWith('.json') ||
                f === 'index.json' ||
                f === 'ignored.json' ||
                f === 'zip-cache.json'
              )
                continue
              // 损坏索引备份文件不是详情缓存，必须保留
              if (f.startsWith('index.corrupt.')) continue
              const cid = f.slice(0, -5)
              if (!store.index[cid]) await fs.unlink(join(libDir(), f)).catch(() => {})
            }
          } catch {
            /* noop */
          }
        } else {
          dbg('skip orphan detail cleanup because indexLoadOk=false')
        }
        if (store.indexLoadOk) {
          // 清理历史遗留的语音索引缓存（demo 已删除/旧缓存版本）
          void pruneVoiceIndexCache().catch(() => {})
        }
        dbg(`init index loaded: ${Object.keys(store.index).length} indexLoadOk=${store.indexLoadOk}`)
        // 校验缓存文件仍存在
        // 注意：zip 条目的 id 基于「容器路径+条目名+解压大小」计算（见 scan），
        // 不能用缓存 .dem 的 path/size/mtime 反推校验（必然不一致 → 启动即清空列表）。
        // 因此 zip 条目只校验缓存 .dem 文件存在；普通 .dem 才做完整指纹比对。
        let indexUpdated = false
        for (const id of Object.keys(store.index)) {
          const meta = store.index[id]
          try {
            const st = await fs.stat(meta.path)
            if (!meta.containerPath) {
              if (demoid(meta.path, st.size, st.mtimeMs) !== id) {
                // 普通 demo 指纹变化：文件确实可访问但内容已变，旧条目失效，交给 scan 重建
                delete store.index[id]
                indexUpdated = true
                continue
              }
            }
            // 文件恢复可访问：清除离线标记
            if (meta.status === 'error' && meta.error === OFFLINE_ERROR) {
              meta.status = meta.roundCount != null ? 'ready' : 'pending'
              meta.error = undefined
              indexUpdated = true
            }
          } catch {
            // 不删除条目：目录可能离线/网络盘未挂载/文件被临时占用
            // 保留 index 条目与 detail 缓存，等 root 恢复后由 scan 清除错误
            meta.status = 'error'
            meta.error = OFFLINE_ERROR
            indexUpdated = true
            dbg(`init keep inaccessible entry ${id}: ${meta.path}`)
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
                // 只读持久化缓存，启动时不再同步打开 zip（大压缩包会卡住窗口）
                const cached = zipCache[normPath(meta.containerPath)]
                const ent = cached?.entries.find((e) => e.name === meta.fileName)
                if (ent?.timeMs && Math.abs(meta.dateMs - ent.timeMs) > 1000) {
                  meta.dateMs = ent.timeMs
                  indexUpdated = true
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
        sanitizeDetailPlayerNames(detail)
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
     *  - pending：主动触发一次解析入队（不再只轮询到超时）；
     *  - ready 但缓存缺失（版本不匹配/被清理）：自动触发一次重解析；
     *  - parse() 自身按 id 去重，避免同一 demo 重复入队。
     *  返回 null = demo 不存在 / 解析失败 / 超时 */
    async waitDetail(id: string, timeoutMs = 180000): Promise<DemoDetail | null> {
      const meta = store.index[id]
      if (!meta) return null
      const deadline = Date.now() + timeoutMs
      // 每次 waitDetail 最多主动触发一次解析，避免 500ms 轮询里反复 parse
      let parseRequested = false
      while (Date.now() < deadline) {
        const d = await this.detail(id)
        if (d) return d
        if (meta.status === 'error') return null // 解析失败不再等
        if (!parseRequested && (meta.status === 'pending' || meta.status === 'ready')) {
          parseRequested = true
          await this.parse(id)
        }
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
        // 语音索引缓存按 demo 路径命名：条目移除后一并清掉，避免 userData 堆积孤儿缓存
        void removeVoiceIndexCache(m.path).catch(() => {})
        if (m.containerPath) {
          void fs.rm(join(zipCacheDir(), did), { recursive: true, force: true }).catch(() => {})
          delete zipCache[normPath(m.containerPath)]
          zipCacheDirty = true
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
      const jobs: Promise<void>[] = [saveIgnored(), persistIndex(), saveZipCache()]
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
      const job = beginAsrJob(id, 'extract')
      try {
        const items = await asrExtract(
          detail,
          {
            progress: (stage, done, total) =>
              emit('asr:progress', { demoId: id, stage, done, total }),
            segment: () => {}
          },
          job.signal
        )
        emit('asr:progress', { demoId: id, stage: 'done', done: items.length, total: items.length })
        return items.length
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit('asr:progress', { demoId: id, stage: 'done', done: 0, total: 0, message })
        throw err
      } finally {
        job.finish()
      }
    },

    async splitVoice(id: string) {
      const detail = await this.waitDetail(id)
      if (!detail) throw new Error(notReadyMsg(id))
      const job = beginAsrJob(id, 'split')
      try {
        const segments = await asrSplit(
          detail,
          {
            progress: (stage, done, total, message) =>
              emit('asr:progress', { demoId: id, stage, done, total, message }),
            segment: () => {}
          },
          job.signal
        )
        // 分割结果暂存到 detail.voice（无文字；若已有转写结果则合并去重）
        const cached = store.details.get(id)
        const existing = new Set(
          (cached?.voice ?? detail.voice ?? []).map((v) => `${v.playerName}|${v.timeSec}`)
        )
        const merged = [...(cached?.voice ?? detail.voice ?? [])]
        const rounds = detail.rounds ?? []
        for (const s of segments) {
          const key = `${s.playerName}|${s.startSec}`
          if (existing.has(key)) continue
          const roundNum = rounds.find((r) => s.tick >= r.startTick && s.tick <= r.endTick)?.roundNum
          merged.push({
            tick: s.tick,
            endTick: s.endTick,
            timeSec: s.startSec,
            endSec: s.endSec,
            playerName: s.playerName,
            steamId: s.steamId,
            team: s.team,
            text: '',
            roundNum,
            engine: 'local'
          })
          existing.add(key)
        }
        merged.sort((a, b) => a.tick - b.tick)
        const target = cached ?? detail
        target.voice = merged
        await persistDetail(target).catch(() => {})

        if (segments.length > 0) {
          emit('asr:progress', { demoId: id, stage: 'done', done: segments.length, total: segments.length, message: '完成' })
          // 只有真正产出分段时才发完成事件，避免 0 段被上层当作成功
          emit('asr:done', { demoId: id, segmentsCount: segments.length })
        } else {
          emit('asr:progress', { demoId: id, stage: 'done', done: 0, total: 0, message: '未检测到可分割的语音片段' })
        }
        emit('library:detail', { id, detail: target })

        return segments.length
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit('asr:progress', { demoId: id, stage: 'done', done: 0, total: 0, message })
        throw err
      } finally {
        job.finish()
      }
    },

    async transcribe(id: string, opts?: { players?: string[] }) {
      const detail = await this.waitDetail(id)
      if (!detail) throw new Error(notReadyMsg(id))
      const settings = await getSettings()
      const job = beginAsrJob(id, 'transcribe')
      try {
        const { segments, failedPlayers } = await transcribeDemo(
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
          job.signal
        )
        // 持久化转写结果
        const cached = store.details.get(id)
        const target = cached ?? detail
        target.voice = segments
        await persistDetail(target).catch(() => {})

        const aborted = job.signal.aborted
        const failedSuffix =
          failedPlayers.length > 0
            ? `，${failedPlayers.length} 个玩家失败：${failedPlayers.map((f) => f.playerName).join('、')}`
            : ''
        emit('asr:progress', {
          demoId: id,
          stage: 'done',
          done: segments.length,
          total: segments.length,
          message: aborted ? `已取消（已保留 ${segments.length} 段）` : `完成${failedSuffix}`
        })
        // 只有真正产出转写段时才通知完成；全部失败时 transcribeDemo 已抛错，不会走到这里
        if (segments.length > 0) {
          emit('asr:done', { demoId: id, segmentsCount: segments.length })
        }
        emit('library:detail', { id, detail: target })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit('asr:progress', { demoId: id, stage: 'done', done: 0, total: 0, message: `转写失败：${message}` })
        // 不吞错误：让 IPC 调用方（renderer）拿到失败原因
        throw err
      } finally {
        job.finish()
      }
    },

    cancelTranscribe(id?: string) {
      cancelAsrJobs(id)
      emit('asr:progress', { demoId: id ?? '', stage: 'done', done: 0, total: 0, message: '已取消' })
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