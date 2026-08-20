/**
 * 悬浮层逻辑：接收主进程 overlay:state 事件，渲染左下角 CS2 原生语音 HUD
 * （说话者：头像 + 名字 + 声波；无字幕——字幕是分析功能，不进游戏内）。
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
  speakers: { name: string; team: string; avatar?: string }[]
  lines: { text: string; playerName: string; team: string; tick: number }[]
}

const speakersEl = document.getElementById('speakers')!
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
        <span class="av"></span>
        <span class="nm"></span>
        <span class="vu"><i></i><i></i><i></i><i></i></span>
      `
      speakersEl.appendChild(el)
    }
    el.classList.add('on')
    const avEl = el.querySelector('.av') as HTMLElement
    if (s.avatar) {
      avEl.innerHTML = ''
      const img = document.createElement('img')
      img.src = s.avatar
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block'
      avEl.appendChild(img)
    } else {
      avEl.textContent = s.name[0]?.toUpperCase() ?? '?'
    }
    ;(el.querySelector('.nm') as HTMLElement).textContent = s.name
  }
  while (speakersEl.children.length > 6) {
    speakersEl.removeChild(speakersEl.firstChild!)
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
