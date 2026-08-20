/**
 * 悬浮层逻辑：接收主进程 overlay:state 事件，只渲染左下角语音 HUD
 * （说话者：头像 + 名字 + 声波）。不显示地图/比分/回合等观战信息。
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

function teamCls(team: string): string {
  return team === 'T' ? 't' : team === 'CT' ? 'ct' : ''
}

function render(state: OverlayState): void {
  // 仅渲染说话者（语音 HUD）
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
}

window.api.onEvent('overlay:state', (e) => {
  render(e.state as OverlayState)
})

// 初始空态
render({ mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] })
