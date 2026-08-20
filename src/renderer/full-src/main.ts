/**
 * 语音显示大屏：渲染「谁在说话 + 转写字幕」，顶部小比分/回合。
 * 其余观战信息（时间轴/选手/控制）游戏内原生已有，这里不做。
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
  speakers: { name: string; team: string; avatar?: string }[]
  lines: { text: string; playerName: string; team: string; tick?: number }[]
}

const $ = (id: string) => document.getElementById(id)!
const teamCls = (t?: string) => (t === 'T' ? 't' : t === 'CT' ? 'ct' : '')

function render(s: VPState): void {
  $('map').textContent = s.map ?? '—'
  $('scT').textContent = String(s.scoreT ?? 0)
  $('scCT').textContent = String(s.scoreCT ?? 0)
  $('round').textContent = s.round ? `R${s.round}` : ''

  // 说话者
  const spEl = $('speakers')
  const want = new Set(s.speakers.map((x) => x.name))
  for (const el of Array.from(spEl.children) as HTMLElement[]) {
    if (!want.has(el.dataset.name ?? '')) el.classList.remove('on')
  }
  for (const sp of s.speakers.slice(0, 4)) {
    let el = Array.from(spEl.children).find((c) => (c as HTMLElement).dataset.name === sp.name) as HTMLElement | undefined
    if (!el) {
      el = document.createElement('div')
      el.className = 'vp-spk'
      el.dataset.name = sp.name
      el.innerHTML = `<span class="av"></span><span class="nm"></span><span class="vu"><i></i><i></i><i></i><i></i></span>`
      spEl.appendChild(el)
    }
    el.classList.add('on')
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
    ;(el.querySelector('.nm') as HTMLElement).textContent = sp.name
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
