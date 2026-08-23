/**
 * 悬浮层逻辑：接收主进程 overlay:state 事件，渲染左下角语音悬浮
 * （说话者 HUD + 控制条：上一段语音 / 下一段语音 / 关闭）。
 * 只显示语音内容，不显示地图/比分/回合。
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
const hintEl = document.getElementById('hint')!
const hudEl = document.getElementById('hud')!
const captionEl = document.getElementById('caption')!

function teamCls(team: string): string {
  return team === 'T' ? 't' : team === 'CT' ? 'ct' : ''
}

function render(state: OverlayState): void {
  // 字幕：取最近一条正在播（或刚播完）的语音文字
  const now = state.lines[state.lines.length - 1]
  if (now) {
    captionEl.classList.add('on')
    captionEl.innerHTML = ''
    const who = document.createElement('span')
    who.className = `cap-who ${teamCls(now.team)}`
    who.textContent = now.playerName
    const txt = document.createElement('span')
    txt.className = 'cap-txt'
    txt.textContent = now.text
    captionEl.appendChild(who)
    captionEl.appendChild(txt)
  } else {
    captionEl.classList.remove('on')
    captionEl.innerHTML = ''
  }

  // 说话者（语音 HUD）
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

  // 空态提示：无语音数据时引导用户
  if (state.mode === 'idle') {
    hintEl.textContent =
      '语音悬浮：在某个 Demo 详情页点击「语音悬浮」按钮开始显示谁在说话'
    hintEl.classList.add('show')
    hudEl.classList.add('idle')
  } else {
    hintEl.classList.remove('show')
    hudEl.classList.remove('idle')
  }
}

window.api.onEvent('overlay:state', (e) => {
  const s = e.state as OverlayState
  render(s)
})

// 控制条按钮
document.getElementById('prevBtn')!.onclick = () => window.api.overlay.command('prevVoice')
document.getElementById('nextBtn')!.onclick = () => window.api.overlay.command('nextVoice')
document.getElementById('closeBtn')!.onclick = () => window.api.overlay.command('closeOverlay')

// 初始空态
render({ mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] })
