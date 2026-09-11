/**
 * 语音显示大屏：只渲染「谁在说话 + 转写字幕」。
 * 不显示地图/比分/回合（观战信息游戏内原生已有）。
 */
import './full.css'

interface VPState {
  mode: string
  tick: number
  tickRate: number
  map?: string
  round?: number
  scoreT?: number
  scoreCT?: number
  speakers: { name: string; team: string; avatar?: string; muted?: boolean }[]
  lines: { text: string; playerName: string; team: string; tick?: number }[]
  showMutedSpeakers?: boolean
}

const $ = (id: string) => document.getElementById(id)!
const teamCls = (t?: string) => (t === 'T' ? 't' : t === 'CT' ? 'ct' : '')

function render(s: VPState): void {
  const showMuted = s.showMutedSpeakers !== false
  const visibleSpeakers = s.speakers.filter((x) => showMuted || !x.muted)

  // 说话者
  const spEl = $('speakers')
  const want = new Set(visibleSpeakers.map((x) => x.name))
  for (const el of Array.from(spEl.children) as HTMLElement[]) {
    if (!want.has(el.dataset.name ?? '')) el.classList.remove('on')
  }
  for (const sp of visibleSpeakers.slice(0, 4)) {
    let el = Array.from(spEl.children).find((c) => (c as HTMLElement).dataset.name === sp.name) as HTMLElement | undefined
    if (!el) {
      el = document.createElement('div')
      el.className = 'vp-spk'
      el.dataset.name = sp.name
      el.innerHTML = `<span class="av"></span><span class="nm"></span><span class="vu"><i></i><i></i><i></i><i></i></span>`
      spEl.appendChild(el)
    }
    el.classList.add('on')
    el.classList.toggle('muted', Boolean(sp.muted))
    const avEl = el.querySelector('.av') as HTMLElement
    if (sp.avatar) {
      avEl.innerHTML = ''
      const img = document.createElement('img')
      img.src = sp.avatar
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block'
      avEl.appendChild(img)
    } else {
      avEl.textContent = sp.name[0]?.toUpperCase() ?? '?'
    }
    if (sp.muted) {
      const badge = document.createElement('span')
      badge.className = 'av-mute-badge'
      badge.innerHTML = `<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`
      avEl.appendChild(badge)
    }
    ;(el.querySelector('.nm') as HTMLElement).textContent = sp.name + (sp.muted ? ' (已静音)' : '')
  }

  // 转写字幕（最近 3 条）
  const capEl = $('captions')
  const lines = s.lines.slice(-3)
  const keys = new Set(lines.map((l) => `${l.tick ?? 0}-${l.playerName}`))
  for (const el of Array.from(capEl.children) as HTMLElement[]) {
    if (!keys.has(el.dataset.key ?? '')) el.classList.remove('show')
  }
  for (const l of lines) {
    const key = `${l.tick ?? 0}-${l.playerName}`
    let el = Array.from(capEl.children).find((c) => (c as HTMLElement).dataset.key === key) as HTMLElement | undefined
    if (!el) {
      el = document.createElement('div')
      el.className = 'vp-cap'
      el.dataset.key = key
      el.innerHTML = `<span class="who ${teamCls(l.team)}"></span><span class="txt"></span>`
      capEl.appendChild(el)
    }
    el.classList.add('show')
    ;(el.querySelector('.who') as HTMLElement).textContent = l.playerName
    ;(el.querySelector('.txt') as HTMLElement).textContent = l.text
  }
  while (capEl.children.length > 3) capEl.removeChild(capEl.firstChild!)
}

window.api.onEvent('overlay:state', (e) => {
  render(e.state as unknown as VPState)
})
$('closeBtn').onclick = () => window.api.overlay.command('close')
$('prevBtn').onclick = () => window.api.overlay.command('prevVoice')
$('nextBtn').onclick = () => window.api.overlay.command('nextVoice')
