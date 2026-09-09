/**
 * 游戏内悬浮层（Overlay）：透明置顶窗口，显示说话者 HUD 与转写字幕。
 * 数据驱动：演示模式（模拟 tick 推进，读 demo 转写数据）/ 未来接真实 CS2 tick。
 */
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { DemoDetail, GsiGameState, OverlayPosition, TeamSide } from '@shared/types'

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
  full?: boolean
  events?: { type: 'kill' | 'voice' | 'bomb'; tick: number; text: string; sub?: string; team?: TeamSide }[]
  players?: { name: string; team: TeamSide; kills: number; deaths: number; hs: number }[]
  rounds?: { num: number; startTick: number; endTick: number; winner: 'T' | 'CT' | 'none' }[]
}

let win: BrowserWindow | null = null
let fullWin: BrowserWindow | null = null
let simTimer: NodeJS.Timeout | null = null
let simPaused = false
let simTick = 0
let simDetail: DemoDetail | null = null
let simSpeed = 1 // 倍速（演示模式）
let position: OverlayPosition = 'bottom-left'
let clickThrough = false
let lastSpeakers: OverlaySpeaker[] = []
let lineHistory: OverlayLine[] = []
let eventHistory: NonNullable<OverlayState['events']> = []
let liveGsi: GsiGameState | null = null // 实况模式：最近一次 GSI 状态

const WIN_W = 560
const WIN_H = 260

const PRELOAD = join(__dirname, '..', '..', 'preload', 'index.js')

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
      preload: PRELOAD,
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
  const state: OverlayState = simDetail
    ? {
        mode: simTimer ? 'demo' : 'idle',
        tick: simTick,
        tickRate: simDetail.meta.tickRate ?? 64,
        map: simDetail.meta.mapName,
        round: roundOf(simTick),
        scoreT: simDetail.meta.scoreT,
        scoreCT: simDetail.meta.scoreCT,
        speakers: lastSpeakers.map((s) => ({
          ...s,
          avatar: (simDetail?.meta.players ?? []).find((p) => p.name === s.name)?.avatar
        })),
        lines: lineHistory.slice(-3),
        full: true,
        events: eventHistory.slice(-24),
        players: (simDetail.meta.players ?? []).slice(0, 10).map((p) => ({
          name: p.name,
          team: p.team,
          kills: p.kills,
          deaths: p.deaths,
          hs: p.hsp
        })),
        rounds: simDetail.rounds.map((r) => ({
          num: r.roundNum,
          startTick: r.startTick,
          endTick: r.endTick,
          winner: r.winner
        }))
      }
    : liveGsi && (liveGsi.map || liveGsi.round != null)
      ? {
          mode: 'live',
          tick: 0,
          tickRate: 64,
          map: liveGsi.map,
          round: liveGsi.round,
          scoreT: liveGsi.scoreT,
          scoreCT: liveGsi.scoreCT,
          speakers: [],
          lines: []
        }
      : { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] }
  if (win && !win.isDestroyed()) win.webContents.send('overlay:state', { state })
  if (fullWin && !fullWin.isDestroyed()) fullWin.webContents.send('overlay:state', { state })
}

function roundOf(tick: number): number | undefined {
  if (!simDetail) return undefined
  for (const r of simDetail.rounds) {
    if (tick >= r.startTick && tick < r.endTick) return r.roundNum
  }
  return undefined
}

let lastSimAt = 0 // 上帧时间戳（按真实时间推进 tick）

/** 演示模式：按真实时间 × 倍速推进 tick，从转写数据计算说话者与字幕 */
function tickSim(): void {
  if (!simDetail || simPaused) return
  const now = Date.now()
  const dt = lastSimAt ? Math.min(now - lastSimAt, 250) : 0 // 卡顿后不跳帧
  lastSimAt = now
  if (dt > 0) simTick += Math.round(64 * simSpeed * (dt / 1000))
  if (simTick < 0) simTick = 0
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

  // 事件流：往前 45s 内的击杀/炸弹 + 当前语音
  if (simTick % 64 === 0) {
    const winTicks = 45 * rate
    const ev: NonNullable<OverlayState['events']> = []
    for (const r of simDetail.rounds) {
      for (const k of r.kills) {
        if (k.tick >= simTick - winTicks && k.tick <= simTick) {
          ev.push({
            type: 'kill',
            tick: k.tick,
            text: `${k.attackerName ?? '?'} → ${k.victimName ?? '?'}`,
            sub: `${k.weapon}${k.headshot ? ' ☠' : ''}`,
            team: k.attackerTeam
          })
        }
        if (r.bombPlantedTick && r.bombPlantedTick >= simTick - winTicks && r.bombPlantedTick <= simTick) {
          ev.push({ type: 'bomb', tick: r.bombPlantedTick, text: 'Bomb planted' })
        }
      }
    }
    for (const v of simDetail.voice) {
      if (v.tick >= simTick - winTicks && v.tick <= simTick) {
        ev.push({ type: 'voice', tick: v.tick, text: v.text, sub: v.playerName, team: v.team })
      }
    }
    ev.sort((a, b) => a.tick - b.tick)
    eventHistory = [...eventHistory, ...ev.filter((e) => e.tick > (eventHistory.at(-1)?.tick ?? -1))].slice(-40)
  }
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
    lastSimAt = 0
    simTimer = setInterval(tickSim, 1000 / 20)
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

export function updateLiveGsi(_s?: unknown): void {
  // GSI 模块已移除
}

// ─── 全屏面板（游戏内观战控制台） ───────────────────────────────────────────

function createFullWindow(): void {
  if (fullWin && !fullWin.isDestroyed()) return
  const wa = screen.getPrimaryDisplay().bounds
  fullWin = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    focusable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: false
    }
  })
  fullWin.setAlwaysOnTop(true, 'screen-saver')
  if (process.env['ELECTRON_RENDERER_URL']) {
    fullWin.loadURL(`${process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '')}/overlay-full.html`)
  } else {
    fullWin.loadFile(join(__dirname, '..', '..', 'renderer', 'overlay-full.html'))
  }
  fullWin.on('closed', () => {
    fullWin = null
  })
  fullWin.webContents.on('did-finish-load', () => sendState())
}

export function setFullPanel(enabled: boolean, demoId?: string, detail?: DemoDetail | null): void {
  if (enabled) {
    if (!simDetail && demoId && detail) {
      simDetail = detail
      simTick = detail.firstTick
      lastSpeakers = []
      lineHistory = []
      eventHistory = []
    }
    createFullWindow()
    fullWin?.showInactive()
    if (simTimer) clearInterval(simTimer)
    simPaused = false
    lastSimAt = 0
    simTimer = setInterval(tickSim, 1000 / 20)
    sendState()
  } else {
    if (fullWin && !fullWin.isDestroyed()) fullWin.destroy()
    fullWin = null
  }
}

/** 全屏面板控制指令 */
export function command(cmd: string, arg?: number): void {
  switch (cmd) {
    case 'jump':
      simTick = Math.max(0, arg ?? 0)
      lineHistory = []
      eventHistory = []
      sendState()
      break
    case 'pause':
      simPaused = true
      if (simTimer) clearInterval(simTimer)
      simTimer = null
      sendState()
      break
    case 'resume':
      simPaused = false
      if (!simTimer) simTimer = setInterval(tickSim, 1000 / 20)
      sendState()
      break
    case 'speed':
      simSpeed = arg ?? 1
      break
    case 'close':
      setFullPanel(false)
      break
    case 'closeOverlay':
      setEnabled(false)
      break
    case 'nextVoice':
    case 'prevVoice': {
      // 跳到下一段/上一段语音：直接构造该段的说话者与字幕并渲染
      if (!simDetail) break
      const rate = simDetail.meta.tickRate ?? 64
      const list = simDetail.voice
      if (list.length === 0) break
      let target = -1
      if (cmd === 'nextVoice') {
        for (const v of list) {
          if (v.tick > simTick + rate) {
            target = v.tick
            break
          }
        }
        if (target < 0) target = list[0].tick // 到底后循环到第一段
      } else {
        for (const v of [...list].reverse()) {
          if (v.tick < simTick - rate) {
            target = v.tick
            break
          }
        }
        if (target < 0) target = list[list.length - 1].tick
      }
      simTick = target
      // 直接渲染该时刻的说话者与最近字幕（无需等下一帧 tick）
      const segs = list.filter((v) => v.tick <= target && v.endTick >= target)
      lastSpeakers = segs.map((v) => ({ name: v.playerName, team: v.team }))
      lineHistory = segs.map((v) => ({
        text: v.text,
        playerName: v.playerName,
        team: v.team,
        tick: v.tick
      }))
      eventHistory = []
      lastSimAt = 0
      sendState()
      break
    }
    default:
      break
  }
}

export function isEnabled(): boolean {
  return Boolean(win && !win.isDestroyed())
}

/** 供截图模式等开发工具访问窗口 */
export function getOverlayWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function getFullWindow(): BrowserWindow | null {
  return fullWin && !fullWin.isDestroyed() ? fullWin : null
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
    : liveGsi && (liveGsi.map || liveGsi.round != null)
      ? {
          mode: 'live',
          tick: 0,
          tickRate: 64,
          map: liveGsi.map,
          round: liveGsi.round,
          scoreT: liveGsi.scoreT,
          scoreCT: liveGsi.scoreCT,
          speakers: [],
          lines: []
        }
      : { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] }
}
