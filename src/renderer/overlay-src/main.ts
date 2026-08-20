/**
 * 悬浮层逻辑：接收主进程 overlay:state 事件，渲染说话者 HUD + 转写字幕。
 * 轻量原生 DOM，不引 React。
 */
import './overlay.css'

interface OverlayState {
  mode: 'demo' | 'live' | 'idle'
  tick: number
  tickRate: number
  map?: string
  round?: number
  scoreT?: number
  scoreCT?: number
  speakers: { name: string; team: string }[]
  lines: { text: string; playerName: string; team: string; tick: number }[]
}

const speakersEl = document.getElementById('speakers')!
const linesEl = document.getElementById('lines')!
const statusEl = document.getElementById('status')!

function teamCls(team: string): string {
  return team === 'T' ? 't' : team === 'CT' ? 'ct' : ''
}

function render(state: OverlayState): void {
  // ── 说话者 ──
  const want = new Set(state.speakers.map((s) => s.name))
  const existing = new Map<string, HTMLElement>()
  for (const el of Array.from(speakersEl.children) as HTMLElement[]) {
    const name = el.dataset.name ?? ''
    if (want.has(name)) existing.set(name, el)
    else el.classList.remove('on')
  }
  for (const s of state.speakers) {
    let el = existing.get(s.name)
    if (!el) {
      el = document.createElement('div')
      el.className = `speaker ${teamCls(s.team)}`
      el.dataset.name = s.name
      el.innerHTML = `
        <span class="tag"></span>
        <span class="nm ${teamCls(s.team)}"></span>
        <span class="vu"><i></i><i></i><i></i><i></i><i></i></span>
      `
      speakersEl.appendChild(el)
    }
    el.classList.add('on')
    el.querySelector('.nm')!.textContent = s.name
  }
  while (speakersEl.children.length > 6) {
    speakersEl.removeChild(speakersEl.firstChild!)
  }

  // ── 字幕 ──
  const lines = state.lines.slice(-3)
  const wantL = new Set(lines.map((l) => `${l.tick}-${l.playerName}`))
  for (const el of Array.from(linesEl.children) as HTMLElement[]) {
    const key = el.dataset.key ?? ''
    if (wantL.has(key)) continue
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }
  for (const l of lines) {
    const key = `${l.tick}-${l.playerName}`
    let el = Array.from(linesEl.children).find(
      (c) => (c as HTMLElement).dataset.key === key
    ) as HTMLElement | undefined
    if (!el) {
      el = document.createElement('div')
      el.className = 'ovline'
      el.dataset.key = key
      el.innerHTML = `<span class="who ${teamCls(l.team)}"></span><span class="txt"></span>`
      linesEl.appendChild(el)
      requestAnimationFrame(() => el!.classList.add('show'))
    }
    ;(el.querySelector('.who') as HTMLElement).textContent = l.playerName
    ;(el.querySelector('.txt') as HTMLElement).textContent = l.text
  }
  while (linesEl.children.length > 3) {
    linesEl.removeChild(linesEl.firstChild!)
  }

  // ── 状态条 ──
  if (state.mode === 'idle' || (!state.map && !state.round)) {
    statusEl.classList.remove('show')
    return
  }
  statusEl.classList.add('show')
  statusEl.innerHTML = `
    <span class="dot-live"></span>
    <span class="map">${state.map ?? '—'}</span>
    <span class="sc"><span class="t">${state.scoreT ?? 0}</span>:<span class="ct">${state.scoreCT ?? 0}</span></span>
    <span class="tm">R${state.round ?? '—'} · ${fmtTick(state.tick, state.tickRate)}</span>
  `
}

function fmtTick(tick: number, rate: number): string {
  const s = Math.floor(tick / rate)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

window.api.onEvent('overlay:state', (e) => {
  render(e.state as OverlayState)
})

// 初始空态
render({ mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] })
