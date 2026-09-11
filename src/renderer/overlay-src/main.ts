/**
 * 悬浮层逻辑：接收主进程 overlay:state 事件，渲染左下角语音悬浮
 * （说话者 HUD + 控制条：上一段语音 / 下一段语音 / 关闭）。
 * 只显示语音内容，不显示地图/比分/回合。
 * 轻量原生 DOM，不引 React。
 */
import './overlay.css'

interface OverlaySpeaker {
  name: string
  team: string
  avatar?: string
  muted?: boolean
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
  lines: { text: string; playerName: string; team: string; tick: number }[]
  showMutedSpeakers?: boolean
}

const speakersEl = document.getElementById('speakers')!
const hintEl = document.getElementById('hint')!
const hudEl = document.getElementById('hud')!
const captionEl = document.getElementById('caption')!

function teamCls(team: string): string {
  return team === 'T' ? 't' : team === 'CT' ? 'ct' : ''
}

function render(state: OverlayState): void {
  const showMuted = state.showMutedSpeakers !== false

  // 字幕：取最近一条正在播（或刚播完）的语音文字
  const now = state.lines[state.lines.length - 1]
  const nowMuted = state.speakers.find((s) => s.name === now?.playerName)?.muted
  if (now && (!nowMuted || showMuted)) {
    captionEl.classList.add('on')
    captionEl.innerHTML = ''
    const who = document.createElement('span')
    who.className = `cap-who ${teamCls(now.team)} ${nowMuted ? 'muted' : ''}`
    who.textContent = now.playerName + (nowMuted ? ' (已静音)' : '')
    const txt = document.createElement('span')
    txt.className = `cap-txt ${nowMuted ? 'muted' : ''}`
    txt.textContent = now.text
    captionEl.appendChild(who)
    captionEl.appendChild(txt)
  } else {
    captionEl.classList.remove('on')
    captionEl.innerHTML = ''
  }

  // 说话者（语音 HUD）
  const visibleSpeakers = state.speakers.filter((s) => showMuted || !s.muted)
  const want = new Set(visibleSpeakers.map((s) => s.name))
  const existing = new Map<string, HTMLElement>()
  for (const el of Array.from(speakersEl.children) as HTMLElement[]) {
    const name = el.dataset.name ?? ''
    if (want.has(name)) existing.set(name, el)
    else el.classList.remove('on')
  }
  for (const s of visibleSpeakers) {
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
    el.classList.toggle('muted', Boolean(s.muted))
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
    if (s.muted) {
      const badge = document.createElement('span')
      badge.className = 'av-mute-badge'
      badge.innerHTML = `<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`
      avEl.appendChild(badge)
    }
    ;(el.querySelector('.nm') as HTMLElement).textContent = s.name + (s.muted ? ' (已静音)' : '')
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
