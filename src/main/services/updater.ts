/**
 * 一键更新：下载新版本 zip → 解压校验 → 退出应用 → 由批处理覆盖当前目录 → 重新启动。
 *
 * 为什么必须借外部脚本：应用运行中无法覆盖自己的 exe 与 resources\app.asar（文件被锁），
 * Electron 也没有内置的「原子替换整个便携目录」能力。所以这里只负责把文件准备好，
 * 真正动手的是应用退出后仍在跑的一个 cmd 脚本。
 */
import { app, net } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import type { UpdateInstallResult, UpdateProgress } from '@shared/types'

/**
 * 绕过 Electron 的 asar 层。
 *
 * Electron 会给 fs 打补丁：任何以 `.asar` 结尾的路径都会被当成「asar 归档内部路径」解析，
 * 于是 `fs.promises.access('.../resources/app.asar')` 返回
 * `ENOENT, not found in <app.asar>`，`fs.promises.open` 同理，`stat` 则返回 size 0。
 * 一键更新要解压并校验别人目录里的 app.asar，必须用 original-fs 才能看到真实文件。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const originalFs = require('original-fs') as typeof import('node:fs')
const ofs = originalFs.promises

/** zip 内顶层目录名（scripts/make-zip.ps1 打的包固定是这个） */
const ZIP_ROOT = 'CS2-Demo-Analyst'
/** 便携版主程序文件名 */
const APP_EXE = 'CS2 Demo Analyst.exe'
/** 只允许从 GitHub 域名下载，避免把任意 URL 当更新源 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

export interface UpdateInstallOptions {
  assetUrl: string
  version: string
  onProgress?: (p: UpdateProgress) => void
  /** 测试用：不真的退出应用 */
  dryRun?: boolean
}

function report(
  cb: UpdateInstallOptions['onProgress'],
  phase: UpdateProgress['phase'],
  received: number,
  total: number,
  message?: string
): void {
  cb?.({ phase, received, total, message })
}

/** 下载到 path，边下边报进度 */
async function download(url: string, path: string, onProgress: UpdateInstallOptions['onProgress']): Promise<void> {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'cs2-demo-analyst' },
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0) || 0
  if (!res.body) throw new Error('下载响应没有内容')

  const out = createWriteStream(path)
  const reader = res.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }
      report(onProgress, 'download', received, total)
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve))
  }
  if (total > 0 && received !== total) {
    throw new Error(`下载不完整：${received} / ${total} 字节`)
  }
}

/** 从 app.asar 头里读出包内 package.json 的 version（不加载 asar，只读头与文件） */
async function readAsarVersion(asarPath: string): Promise<string | null> {
  // 必须用 original-fs：Electron 的 fs 补丁会把 .asar 路径当成归档内部路径
  const fh = await ofs.open(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    await fh.read(head, 0, 16, 0)
    // asar 头：4B size-of-size、4B size-of-header、4B size-of-json、4B json 长度... 实际上
    // 标准布局是 [0]=4(固定)、[4]=headerSizePickle、[8]=payloadSize、[12]=jsonLen。
    const headerSize = head.readUInt32LE(12)
    if (!headerSize || headerSize > 4 * 1024 * 1024) return null
    const raw = Buffer.alloc(headerSize)
    await fh.read(raw, 0, headerSize, 16)
    const baseOffset = 8 + head.readUInt32LE(4)
    const json = JSON.parse(raw.toString('utf8').replace(/\0+$/, '')) as {
      files?: Record<string, { offset?: string; size?: number; files?: unknown }>
    }
    const entry = json.files?.['package.json']
    if (!entry || entry.size === undefined || entry.offset === undefined) return null
    const buf = Buffer.alloc(entry.size)
    await fh.read(buf, 0, entry.size, baseOffset + Number(entry.offset))
    const pkg = JSON.parse(buf.toString('utf8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  } finally {
    await fh.close().catch(() => {})
  }
}

/**
 * 自己逐个条目解压，不用 AdmZip 的 extractAllTo。
 *
 * 原因：extractAllTo 在 Windows 上会按 zip 里的 Unix 权限位去 chmod，
 * 而它在解 app.asar 这类大文件时报 `ENOENT ... chmod '...app.asar'`（文件刚写出来却 chmod 失败），
 * 整个更新就卡在解压阶段。这里只做「读数据 → 建目录 → 写文件」，不碰权限位。
 */
async function extractManually(
  zip: AdmZip,
  destDir: string,
  onProgress: UpdateInstallOptions['onProgress']
): Promise<void> {
  const entries = zip.getEntries()
  report(onProgress, 'extract', 0, entries.length)
  let done = 0
  for (const entry of entries) {
    // 统一成 posix 分隔符，并挡掉绝对路径与 .. 穿越
    const rel = entry.entryName.replace(/\\/g, '/')
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) continue
    const target = join(destDir, ...rel.split('/'))
    if (entry.isDirectory) {
      await ofs.mkdir(target, { recursive: true })
      continue
    }
    await ofs.mkdir(dirname(target), { recursive: true })
    // 同样走 original-fs：目标可能是 app.asar，Electron 的 fs 会把它当成归档内部路径
    await ofs.writeFile(target, entry.getData())
    done += 1
    if (done % 5 === 0 || done === entries.length) {
      report(onProgress, 'extract', done, entries.length)
    }
  }
}

/** 解压并校验：版本号必须匹配，主程序必须存在 */
async function extractAndVerify(
  zipPath: string,
  destDir: string,
  version: string,
  onProgress: UpdateInstallOptions['onProgress']
): Promise<string> {
  const zip = new AdmZip(zipPath)
  await extractManually(zip, destDir, onProgress)

  const root = join(destDir, ZIP_ROOT)
  report(onProgress, 'verify', 0, 0)

  const exe = join(root, APP_EXE)
  await fs.access(exe).catch(() => {
    throw new Error(`解压结果里没有 ${APP_EXE}`)
  })
  const asar = join(root, 'resources', 'app.asar')
  // 用 original-fs 判断：Electron 的 fs.access('...app.asar') 会当成归档内部路径而报 ENOENT
  await ofs.access(asar).catch(() => {
    throw new Error('解压结果里没有 resources\\app.asar')
  })

  // 版本核对：防止下载到的不是目标版本（例如资产串号、缓存了旧文件）。
  const packed = await readAsarVersion(asar)
  if (packed && version && packed !== version) {
    throw new Error(`下载到的版本是 ${packed}，与目标 ${version} 不一致`)
  }
  return root
}

/**
 * 生成退出后执行的更新脚本（cmd + robocopy）。
 *
 * 三个要点：
 * - 等的是「同名进程全部消失」而不是单个 PID：Electron 退出时渲染/GPU 子进程
 *   可能比主进程晚一点点放手文件句柄。
 * - robocopy 的退出码 0–7 都算正常（1 表示「有文件被复制」），只有 ≥8 才是失败。
 * - 收尾要清掉临时目录：脚本自己就在这个目录里，删不掉自己，所以另起一个
 *   放在 %TEMP% 根下的 cleanup.cmd 延时删除，不阻塞重启。
 */
function buildUpdateScript(opts: {
  srcDir: string
  destDir: string
  exePath: string
  cleanupPath: string
}): string {
  const { srcDir, destDir, exePath, cleanupPath } = opts
  return [
    '@echo off',
    'setlocal',
    `set "SRC=${srcDir}"`,
    `set "DST=${destDir}"`,
    `set "EXE=${exePath}"`,
    'set /a TRIES=0',
    ':wait',
    'set /a TRIES+=1',
    'if %TRIES% GTR 120 goto copy',
    'tasklist /FI "IMAGENAME eq CS2 Demo Analyst.exe" 2>nul | find /I "CS2 Demo Analyst.exe" >nul',
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    // 进程都没了再等 3 秒，给文件句柄留出释放时间
    'timeout /t 3 /nobreak >nul',
    ':copy',
    'robocopy "%SRC%" "%DST%" /E /NFL /NDL /NJH /NJS /R:5 /W:2 >nul',
    'start "" "%EXE%"',
    `start "" /min "${cleanupPath}"`,
    // 必须用 exit 而不是 exit /b：start 启动的脚本外层是一个 cmd /K 壳，
    // exit /b 只退出批处理，那个壳会一直挂在后台；exit 才会把它一起关掉。
    'exit 0',
    ''
  ].join('\r\n')
}

/**
 * 延时删除更新临时目录的收尾脚本。
 *
 * 注意不要在这里 `del "%~f0"` 自删：实测自删会让 start 拉起的那个 cmd 壳
 * 变成残留进程挂在后台（脚本没了但它还在）。脚本文件本身留给
 * pruneOldUpdateDirs() 在下次启动时清。
 */
function buildCleanupScript(workDir: string): string {
  return [
    '@echo off',
    'timeout /t 6 /nobreak >nul',
    `rmdir /s /q "${workDir}"`,
    'exit 0',
    ''
  ].join('\r\n')
}

/** 清理历史上遗留的更新临时目录与收尾脚本（超过 1 小时的），在启动时调用。 */
export async function pruneOldUpdateDirs(): Promise<void> {
  try {
    const root = tmpdir()
    const names = await fs.readdir(root)
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const name of names) {
      const isWorkDir = name.startsWith('cs2-demo-analyst-update-')
      const isCleanupScript =
        name.startsWith('cs2-demo-analyst-cleanup-') && name.endsWith('.cmd')
      if (!isWorkDir && !isCleanupScript) continue
      const full = join(root, name)
      const st = await ofs.stat(full).catch(() => null)
      if (st && st.mtimeMs < cutoff) {
        await ofs.rm(full, { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch {
    /* 清理失败不影响任何功能 */
  }
}

/**
 * 准备一键更新。成功返回后调用方应立即退出应用——脚本会等本进程结束后覆盖文件并重启。
 */
export async function prepareUpdate(opts: UpdateInstallOptions): Promise<UpdateInstallResult> {
  const { assetUrl, version, onProgress, dryRun } = opts
  if (!app.isPackaged) {
    return { ok: false, error: '开发模式不支持一键更新' }
  }
  let url: URL
  try {
    url = new URL(assetUrl)
  } catch {
    return { ok: false, error: '更新地址无效' }
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return { ok: false, error: '更新地址不在允许的域名内' }
  }

  const workDir = join(tmpdir(), `cs2-demo-analyst-update-${version}-${Date.now()}`)
  const zipPath = join(workDir, 'update.zip')
  const extractDir = join(workDir, 'extract')
  const destDir = dirname(process.execPath)
  const exePath = process.execPath

  try {
    await fs.mkdir(extractDir, { recursive: true })
    await download(url.toString(), zipPath, onProgress)
    const root = await extractAndVerify(zipPath, extractDir, version, onProgress)

    const scriptPath = join(workDir, 'apply-update.cmd')
    const cleanupPath = join(tmpdir(), `cs2-demo-analyst-cleanup-${Date.now()}.cmd`)
    await fs.writeFile(cleanupPath, buildCleanupScript(workDir), 'utf8')
    const script = buildUpdateScript({
      srcDir: root,
      destDir,
      exePath,
      cleanupPath
    })
    await fs.writeFile(scriptPath, script, 'utf8')

    report(onProgress, 'ready', 0, 0)
    if (dryRun) return { ok: true }

    // 交给 cmd 执行：detached + 忽略 stdio，并且用 start 再分一层，
    // 让脚本脱离本进程的进程树——应用退出后它仍要继续跑。
    // 用 windowsVerbatimArguments 自己拼命令行，避免临时目录含空格时被拆开。
    const child = spawn('cmd.exe', ['/c', `start "" /min "${scriptPath}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    })
    child.unref()

    // 留一点时间让脚本真正起来，再退出。
    setTimeout(() => app.quit(), 600)
    return { ok: true }
  } catch (err) {
    // 清理也必须用 original-fs：workDir 里有解出来的 app.asar，
    // 走 Electron 的 fs.rm 会删不掉它们，临时目录就会一直留在 %TEMP% 里。
    await ofs.rm(workDir, { recursive: true, force: true }).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    report(onProgress, 'error', 0, 0, message)
    return { ok: false, error: message }
  }
}
