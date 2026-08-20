/**
 * 游戏内悬浮层（Overlay）：透明置顶窗口，显示说话者 HUD 与转写字幕。
 * 数据驱动：演示模式（模拟 tick 推进，读 demo 转写数据）/ 未来接真实 CS2 tick。
 */
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { DemoDetail, OverlayPosition, TeamSide } from '@shared/types'

interface OverlaySpeaker {
  name: string
  team: TeamSide
}

interface OverlayLine {
  text: string
  playerName: string
  team: TeamSide
  tick: number
}

interface OverlayState {
  mode: 'demo' | 'live' | 'idle'
  tick: number
  tickRate: number
  map?: string
  round?: number
  scoreT?: number
  scoreCT?: number
  speakers: OverlaySpeaker[]
  lines: OverlayLine[]
}

let win: BrowserWindow | null = null
let simTimer: NodeJS.Timeout | null = null
let simTick = 0
let simDetail: DemoDetail | null = null
let simSpeed = 1 // 倍速（演示模式）
let position: OverlayPosition = 'bottom-left'
let clickThrough = false
let lastSpeakers: OverlaySpeaker[] = []
let lineHistory: OverlayLine[] = []

const WIN_W = 560
const WIN_H = 260

function createWindow(): void {
  if (win && !win.isDestroyed()) return
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')}/overlay.html`)
  } else {
    // 本模块被动态导入到 out/main/chunks/，向上两级回到 out/ 再进 renderer
    win.loadFile(join(__dirname, '..', '..', 'renderer', 'overlay.html'))
  }
  win.on('closed', () => {
    win = null
  })
  win.webContents.on('did-finish-load', () => {
    sendState()
  })
}

function applyPosition(pos: OverlayPosition): void {
  if (!win || win.isDestroyed()) return
  const wa = screen.getPrimaryDisplay().workArea
  const margin = 16
  let x = wa.x + wa.width - WIN_W - margin
  let y = wa.y + wa.height - WIN_H - margin
  if (pos === 'bottom-left') {
    x = wa.x + margin
    y = wa.y + wa.height - WIN_H - margin
  } else if (pos === 'bottom-center') {
    x = wa.x + (wa.width - WIN_W) / 2
    y = wa.y + wa.height - WIN_H - margin
  } else if (pos === 'bottom-right') {
    x = wa.x + wa.width - WIN_W - margin
    y = wa.y + wa.height - WIN_H - margin
  } else if (pos === 'top-left') {
    x = wa.x + margin
    y = wa.y + margin
  }
  win.setPosition(Math.round(x), Math.round(y))
}

function applyClickThrough(on: boolean): void {
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(on, { forward: true })
}

function sendState(): void {
  if (!win || win.isDestroyed()) return
  const state: OverlayState = simDetail
    ? {
        mode: simTimer ? 'demo' : 'idle',
        tick: simTick,
        tickRate: simDetail.meta.tickRate ?? 64,
        map: simDetail.meta.mapName,
        round: roundOf(simTick),
        scoreT: simDetail.meta.scoreT,
        scoreCT: simDetail.meta.scoreCT,
        speakers: lastSpeakers,
        lines: lineHistory.slice(-3)
      }
    : { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] }
  win.webContents.send('overlay:state', { state })
}

function roundOf(tick: number): number | undefined {
  if (!simDetail) return undefined
  for (const r of simDetail.rounds) {
    if (tick >= r.startTick && tick < r.endTick) return r.roundNum
  }
  return undefined
}

/** 演示模式：按倍速推进 tick，从转写数据计算说话者与字幕 */
function tickSim(): void {
  if (!simDetail) return
  simTick += 64 * simSpeed
  if (process.env['DEBUG_OVERLAY'] === '1' && simTick % 6400 < 64) {
    console.log(`[overlay] tick=${simTick} speakers=${lastSpeakers.length} lines=${lineHistory.length}`)
  }
  const last = simDetail.lastTick
  if (simTick > last) {
    simTick = 0 // 循环播放
    lineHistory = []
  }
  const rate = simDetail.meta.tickRate ?? 64
  // 当前说话者：转写段在 ±1s 窗口内
  const active = new Map<string, OverlaySpeaker>()
  const nowLines: OverlayLine[] = []
  for (const v of simDetail.voice) {
    if (v.tick <= simTick && v.endTick >= simTick) {
      if (!active.has(v.playerName)) {
        active.set(v.playerName, { name: v.playerName, team: v.team })
      }
      nowLines.push({
        text: v.text,
        playerName: v.playerName,
        team: v.team,
        tick: v.tick
      })
    }
  }
  // 说话者延续显示（说话结束后保持 1.2s）
  const holdTicks = Math.round(1.2 * rate)
  lastSpeakers = lastSpeakers.filter((s) => {
    // 简化：保留上次说话者直到其最近文本超过 hold 窗口
    return lineHistory.some((l) => l.playerName === s.name && simTick - l.tick < holdTicks)
  })
  for (const s of active.values()) {
    if (!lastSpeakers.some((x) => x.name === s.name)) lastSpeakers.push(s)
  }
  for (const l of nowLines) {
    const key = `${l.tick}-${l.playerName}`
    if (!lineHistory.some((x) => `${x.tick}-${x.playerName}` === key)) {
      lineHistory.push(l)
    }
  }
  lineHistory = lineHistory.filter((l) => simTick - l.tick < 30 * rate)
  sendState()
}

export function setEnabled(enabled: boolean, demoId?: string, detail?: DemoDetail | null): void {
  if (enabled) {
    createWindow()
    if (demoId && detail) {
      simDetail = detail
      simTick = detail.firstTick
      lastSpeakers = []
      lineHistory = []
    }
    applyPosition(position)
    applyClickThrough(clickThrough)
    win?.showInactive()
    if (simTimer) clearInterval(simTimer)
    simTimer = setInterval(tickSim, 1000 / 60)
    sendState()
  } else {
    if (simTimer) clearInterval(simTimer)
    simTimer = null
    simDetail = null
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  }
}

export function setPosition(pos: OverlayPosition): void {
  position = pos
  applyPosition(pos)
}

export function setClickThrough(on: boolean): void {
  clickThrough = on
  applyClickThrough(on)
}

export function isEnabled(): boolean {
  return Boolean(win && !win.isDestroyed())
}

/** 供截图模式等开发工具访问窗口 */
export function getOverlayWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function getState(): OverlayState {
  return simDetail
    ? {
        mode: simTimer ? 'demo' : 'idle',
        tick: simTick,
        tickRate: simDetail.meta.tickRate ?? 64,
        map: simDetail.meta.mapName,
        round: roundOf(simTick),
        scoreT: simDetail.meta.scoreT,
        scoreCT: simDetail.meta.scoreCT,
        speakers: lastSpeakers,
        lines: lineHistory.slice(-3)
      }
    : { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] }
}
