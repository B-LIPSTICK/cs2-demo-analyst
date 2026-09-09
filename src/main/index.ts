/**
 * 主进程入口：窗口、IPC 装配、冒烟模式。
 */
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { createLibraryService } from './services/library'
import { getSettings, updateSettings } from './services/settings'

// 固定应用名，保证开发与打包后 userData 一致（%APPDATA%\CS2 Demo Analyst）
app.setName('CS2 Demo Analyst')

let mainWindow: BrowserWindow | null = null
const library = createLibraryService(() => mainWindow, getSettings)
import { LiveService } from './services/live'
const live = new LiveService({
  status: (s) => mainWindow?.webContents.send('live:status', { status: s }),
  consoleLine: (channel, text) =>
    mainWindow?.webContents.send('live:console', { channel, text })
})
import { AiService } from './services/ai'
const ai = new AiService({
  delta: (demoId, chunk) => mainWindow?.webContents.send('ai:delta', { demoId, chunk }),
  done: (demoId, answer) => mainWindow?.webContents.send('ai:done', { demoId, answer }),
  error: (demoId, error) => mainWindow?.webContents.send('ai:error', { demoId, error })
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0A0C0F',
    icon: join(app.getAppPath(), 'build', 'icon-256.png'),
    title: 'CS2 Demo Analyst',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))

  // 开发辅助：--route=library/demoId 直接打开指定页面
  const routeArg = process.argv.find((a) => a.startsWith('--route='))
  const route = routeArg ? routeArg.slice('--route='.length) : ''

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC ───────────────────────────────────────────────────────────────────

function registerIpc(): void {
  // 窗口控制
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // 设置
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const settings = await updateSettings(patch)
    if (patch.libraryRoots) {
      await library.setRoots(patch.libraryRoots)
    }
    if (patch.cs2?.installPath !== undefined) {
      live.setInstallPath(patch.cs2.installPath)
    }
    // 事件载荷必须带 { settings } 包装（renderer 按 e.settings 读取；
    // 之前发裸对象导致 e.settings=undefined → App setSettings(undefined) → 页面全黑）
    mainWindow?.webContents.send('settings:changed', { settings })
    return settings
  })

  // 资料库
  ipcMain.handle('library:list', () => library.list())
  ipcMain.handle('library:detail', (_e, id: string) => library.detail(id))
  ipcMain.handle('library:addRoot', () => library.addRoot())
  ipcMain.handle('library:removeRoot', (_e, root: string) => library.removeRoot(root))
  ipcMain.handle('library:rescan', () => library.rescan())
  ipcMain.handle('library:remove', (_e, id: string, opts?: { deleteFile?: boolean }) =>
    library.remove(id, opts)
  )
  ipcMain.handle('library:parse', (_e, id: string, force?: boolean) => library.parse(id, force))
  ipcMain.handle('library:parseAll', () => library.parseAll())
  ipcMain.handle('library:detectPlatformRoots', () => library.detectPlatformRoots())
  ipcMain.handle('library:autoAddPlatformRoots', () => library.autoAddPlatformRoots())

  // 收藏
  ipcMain.handle('favorites:list', async () => {
    const { favoritesList } = await import('./services/favorites')
    return favoritesList()
  })
  ipcMain.handle('favorites:add', async (_e, id: string) => {
    const { favoriteAdd } = await import('./services/favorites')
    const meta = (await library.list()).find((m) => m.id === id)
    if (!meta) throw new Error('demo not found')
    return favoriteAdd(meta)
  })
  ipcMain.handle('favorites:remove', async (_e, id: string) => {
    const { favoriteRemove } = await import('./services/favorites')
    return favoriteRemove(id)
  })
  ipcMain.handle('favorites:reveal', async () => {
    const { favoriteReveal } = await import('./services/favorites')
    return favoriteReveal()
  })

  // 语音
  ipcMain.handle('voice:detect', (_e, id: string) => library.detectVoice(id))
  ipcMain.handle('voice:extract', (_e, id: string) => library.extractVoice(id))
  // 语音分割：提取 + VAD 切段（不转写，无需 API Key），返回分段数
  ipcMain.handle('voice:split', (_e, id: string) => library.splitVoice(id))
  // 语音切片播放：返回 base64 编码的小 WAV（字符串过 contextBridge 无损；
  // Buffer 会被序列化成普通对象，renderer 无法还原为可播放的 Blob）
  ipcMain.handle(
    'voice:play',
    async (
      _e,
      demoId: string,
      seg: { steamId?: string; playerName: string; startSec: number; endSec: number }
    ) => {
      const { sliceVoiceWav } = await import('./services/asr')
      const buf = await sliceVoiceWav(demoId, seg.steamId, seg.playerName, seg.startSec, seg.endSec)
      return buf ? buf.toString('base64') : null
    }
  )

  // 转写
  ipcMain.handle('asr:transcribe', (_e, id: string, opts?: { players?: string[] }) =>
    library.transcribe(id, opts)
  )
  ipcMain.handle('asr:cancel', () => library.cancelTranscribe())

  // AI 分析
  ipcMain.handle('ai:ask', async (_e, id: string, question: string, history?: { role: 'user' | 'assistant'; text: string }[]) => {
    // 等待详情就绪（demo 刚加入还在解析时自动等待/重解析，而不是直接报 demo not found）
    const detail = await library.waitDetail(id)
    if (!detail) return { started: false, error: 'demo 尚未解析完成，请稍候再试（或该 demo 解析失败）' }
    const s = await getSettings()
    return ai.ask(id, question, detail, s.ai, s.language, history)
  })
  ipcMain.handle('ai:cancel', () => ai.cancel())
  ipcMain.handle('ai:listModels', async () => {
    const s = await getSettings()
    return ai.listModels({ baseUrl: s.ai.baseUrl, apiKey: s.ai.apiKey })
  })
  ipcMain.handle('ai:listChats', () => ai.listChats())
  ipcMain.handle('ai:saveChat', (_e, session) => ai.saveChat(session))
  ipcMain.handle('ai:removeChat', (_e, id: string) => ai.removeChat(id))

  // 实况 / 注入
  ipcMain.handle('live:getStatus', () => live.getStatus())
  ipcMain.handle('live:connect', () => live.connect())
  ipcMain.handle('live:sendCommand', (_e, cmd: string) => live.sendCommand(cmd))
  ipcMain.handle('live:jumpTick', (_e, tick: number) => live.jumpTick(tick))
  ipcMain.handle('live:pause', () => live.pause())
  ipcMain.handle('live:resume', () => live.resume())
  ipcMain.handle('live:setTimescale', (_e, x: number) => live.setTimescale(x))
  ipcMain.handle('live:specNext', () => live.specNext())
  ipcMain.handle('live:specPrev', () => live.specPrev())
  ipcMain.handle('live:specGoto', (_e, userid: number) => live.specGoto(userid))
  ipcMain.handle('live:launch', async (_e, opts?: { toolsMode?: boolean; playDemoPath?: string; voiceHud?: boolean; startTick?: number }) => {
    const s = await getSettings()
    return live.launch(
      { ...opts, voiceHud: opts?.voiceHud ?? s.cs2.voiceHud },
      s.cs2.launchArgs ?? '',
      s.cs2.installPath
    )
  })
  ipcMain.handle('live:installGsi', () => Promise.resolve(null))
  ipcMain.handle('live:locateInstall', () => live.locateInstall())

  // Overlay 悬浮层
  ipcMain.handle('overlay:setEnabled', async (_e, enabled: boolean, demoId?: string) => {
    const { setEnabled } = await import('./overlay')
    let detail = null
    if (enabled && demoId) detail = await library.detail(demoId)
    setEnabled(enabled, demoId, detail)
  })
  ipcMain.handle('overlay:setPosition', async (_e, pos: string) => {
    const { setPosition } = await import('./overlay')
    setPosition(pos as never)
  })
  ipcMain.handle('overlay:setClickThrough', async (_e, on: boolean) => {
    const { setClickThrough } = await import('./overlay')
    setClickThrough(on)
  })
  ipcMain.handle('overlay:getState', async () => {
    const { getState } = await import('./overlay')
    return getState()
  })
  ipcMain.handle('overlay:setFullPanel', async (_e, enabled: boolean, demoId?: string) => {
    const { setFullPanel } = await import('./overlay')
    let detail = null
    if (enabled && demoId) detail = await library.detail(demoId)
    setFullPanel(enabled, demoId, detail)
  })
  ipcMain.handle('overlay:command', async (_e, cmd: string, arg?: number) => {
    const { command } = await import('./overlay')
    command(cmd, arg)
  })

  // 引擎/模型管理
  ipcMain.handle('engines:status', async () => {
    const { engineStatus } = await import('./services/engines')
    return engineStatus()
  })
  ipcMain.handle('engines:ensure', async (_e, kind: string) => {
    const { ensureCsgove, ensureWhisperCli, ensureWhisperModel } = await import('./services/engines')
    const onProgress = (p: { what: string; received: number; total: number }) => {
      mainWindow?.webContents.send('engine:progress', p)
    }
    switch (kind) {
      case 'csgove':
        await ensureCsgove(onProgress)
        break
      case 'whisper':
        await ensureWhisperCli(onProgress)
        break
      case 'model-base':
        await ensureWhisperModel('base', onProgress)
        break
      case 'model-small':
        await ensureWhisperModel('small', onProgress)
        break
      case 'model-medium':
        await ensureWhisperModel('medium', onProgress)
        break
      default:
        throw new Error(`unknown engine kind ${kind}`)
    }
  })
  ipcMain.handle('engines:cancel', async (_e, kind: string) => {
    const { cancelEngine } = await import('./services/engines')
    return cancelEngine(kind)
  })
  ipcMain.handle('engines:openFolder', async () => {
    const { openEnginesFolder } = await import('./services/engines')
    return openEnginesFolder()
  })

  // 通用
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:revealInFolder', (_e, path: string) => {
    shell.showItemInFolder(path)
  })
  ipcMain.handle('app:openUrl', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  // 目录选择（设置页选 CS2 安装路径等）
  ipcMain.handle('app:pickDirectory', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: '选择目录',
      properties: ['openDirectory']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
}

// ─── 更新检测（GitHub Releases）─────────────────────────────────────────────

const UPDATE_REPO = 'B-LIPSTICK/cs2-demo-analyst'

/** 'v1.2.3' / '1.2.3' → [1,2,3]；解析失败返回 null */
function parseVer(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function newerVer(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** 启动后延迟检查 GitHub 最新 Release；有新版 → 发 update:available（离线/被墙静默） */
async function checkForUpdate(): Promise<void> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cs2-demo-analyst' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = parseVer(data.tag_name ?? '')
    const cur = parseVer(app.getVersion())
    if (!latest || !cur || !newerVer(latest, cur)) return
    mainWindow?.webContents.send('update:available', {
      version: String(data.tag_name).replace(/^v/, ''),
      url: data.html_url ?? `https://github.com/${UPDATE_REPO}/releases`
    })
  } catch {
    /* 静默 */
  }
}

// ─── 生命周期 ──────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    // 启动 8s 后检查更新（避开启动高峰；版本相同/无网都静默）
    setTimeout(() => void checkForUpdate(), 8000)
    void library.init()
    void getSettings().then((s) => {
      live.setInstallPath(s.cs2.installPath)
      live.start()
      // 开发模式: --ai-mock 本地生成 AI 回答（无需 Key/网络）
      if (process.argv.includes('--ai-mock')) {
        ai.setMock(true)
        console.log('[ai-mock] AI mock mode on')
      }
    })

    // 开发模式: --overlay-demo=<demoId|文件名片段> 等待解析完成后在悬浮层启动演示
    const overlayDemoArg = process.argv.find((a) => a.startsWith('--overlay-demo='))
    if (overlayDemoArg) {
      const key = overlayDemoArg.slice('--overlay-demo='.length)
      ;(async () => {
        let meta: Awaited<ReturnType<typeof library.list>>[number] | null = null
        for (let i = 0; i < 120; i++) {
          const demos = await library.list()
          meta = demos.find((d) => d.id === key || d.fileName.includes(key)) ?? null
          if (meta && meta.status === 'ready') break
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (!meta || meta.status !== 'ready') {
          console.error(`[overlay] demo not ready: ${key}`)
          app.exit(1)
          return
        }
        const detail = await library.detail(meta.id)
        const { setEnabled } = await import('./overlay')
        setEnabled(true, meta.id, detail)
        console.log(`[overlay] demo sim started: ${detail?.voice.length ?? 0} voice segments`)
      })()
    }
    // 开发模式: --fullpanel-demo=<demoId|文件名片段> 等待解析完成后启动全屏面板
    const fullDemoArg = process.argv.find((a) => a.startsWith('--fullpanel-demo='))
    if (fullDemoArg) {
      const key = fullDemoArg.slice('--fullpanel-demo='.length)
      ;(async () => {
        let meta: Awaited<ReturnType<typeof library.list>>[number] | null = null
        for (let i = 0; i < 120; i++) {
          const demos = await library.list()
          meta = demos.find((d) => d.id === key || d.fileName.includes(key)) ?? null
          if (meta && meta.status === 'ready') break
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (!meta || meta.status !== 'ready') {
          console.error(`[fullpanel] demo not ready: ${key}`)
          app.exit(1)
          return
        }
        const detail = await library.detail(meta.id)
        const { setFullPanel } = await import('./overlay')
        setFullPanel(true, meta.id, detail)
        console.log(`[fullpanel] started: ${detail?.voice.length ?? 0} voice segments`)
      })()
    }
    // 开发模式: --transcribe=<demoId|文件名片段> 等待解析完成后执行转写并退出
    const transcribeArg = process.argv.find((a) => a.startsWith('--transcribe='))
    if (transcribeArg) {
      const key = transcribeArg.slice('--transcribe='.length)
      ;(async () => {
        let meta: Awaited<ReturnType<typeof library.list>>[number] | null = null
        for (let i = 0; i < 120; i++) {
          const demos = await library.list()
          meta = demos.find((d) => d.id === key || d.fileName.includes(key)) ?? null
          if (meta && meta.status === 'ready') break
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (!meta || meta.status !== 'ready') {
          console.error(`[transcribe] demo not ready: ${key}`)
          app.exit(1)
          return
        }
        const t0 = Date.now()
        try {
          await library.transcribe(meta.id)
          const det = await library.detail(meta.id)
          const secs = ((Date.now() - t0) / 1000).toFixed(1)
          console.log(`[transcribe] done: ${det?.voice.length ?? 0} segments in ${secs}s`)
          if (det?.voice.length) {
            console.log('sample:', JSON.stringify(det.voice.slice(0, 3)))
          }
        } catch (err) {
          console.error('[transcribe] FAILED', err)
          app.exit(1)
          return
        }
        app.exit(0)
      })()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // 冒烟模式：加载完成后退出（用于无头验证）
    if (process.env['ELECTRON_SMOKE'] === '1') {
      mainWindow?.webContents.on('did-finish-load', () => {
        console.log('[smoke] renderer loaded OK')
        setTimeout(() => app.exit(0), 500)
      })
      mainWindow?.webContents.on('did-fail-load', (_e, code, desc) => {
        console.error(`[smoke] load failed: ${code} ${desc}`)
        app.exit(1)
      })
    }

    // 截图模式：--screenshot <path> 渲染后直接捕获窗口内容（--shot-delay 毫秒可调）
    const shotIdx = process.argv.indexOf('--screenshot')
    if (shotIdx >= 0 && process.argv[shotIdx + 1]) {
      const shotPath = process.argv[shotIdx + 1]
      const delayArg = process.argv.find((a) => a.startsWith('--shot-delay='))
      const delay = delayArg ? Number(delayArg.slice('--shot-delay='.length)) || 1600 : 1600
      const isOverlayShot = Boolean(
        process.argv.find((a) => a.startsWith('--overlay-demo=')) ||
        process.argv.find((a) => a.startsWith('--fullpanel-demo='))
      )
      const target = () => {
        if (process.argv.find((a) => a.startsWith('--fullpanel-demo='))) {
          return import('./overlay').then((m) => m.getFullWindow())
        }
        if (isOverlayShot) {
          return import('./overlay').then((m) => m.getOverlayWindow())
        }
        return Promise.resolve(mainWindow)
      }
      const onLoaded = async () => {
        // 测试钩子：截图前在渲染进程执行 JS（模拟改设置/切语言等交互，验证 UI 不黑屏）
        const evalArg = process.argv.find((a) => a.startsWith('--eval-js='))
        if (evalArg) {
          try {
            const code = evalArg.slice('--eval-js='.length)
            const r = await mainWindow?.webContents.executeJavaScript(code, true)
            console.log(`[eval-js] result=${JSON.stringify(r) ?? 'undefined'}`)
          } catch (e) {
            console.error('[eval-js] failed', e)
          }
        }
        setTimeout(async () => {
          try {
            let win: BrowserWindow | null = null
            for (let i = 0; i < 8 && !win; i++) {
              win = await target()
              if (!win) await new Promise((r) => setTimeout(r, 500))
            }
            if (!win) throw new Error('target window not found')
            const image = await win.webContents.capturePage()
            const { promises: fs } = await import('node:fs')
            await fs.writeFile(shotPath, image.toPNG())
            console.log(`[shot] saved ${shotPath}`)
          } catch (e) {
            console.error('[shot] failed', e)
          }
          app.exit(0)
        }, delay)
      }
      if (isOverlayShot) {
        // 悬浮层窗口加载完成后再等演示推进
        setTimeout(onLoaded, delay)
      } else {
        mainWindow?.webContents.on('did-finish-load', onLoaded)
      }
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
