import { useEffect, useRef, useState } from 'react'
import {
  Btn,
  IcJump,
  IcPause,
  IcPlay,
  Led,
  Panel,
  SectionHead,
  Tag,
  useToast
} from '@/components/ui'
import { useTKey } from '@/i18n'
import type { GsiGameState, LiveStatus } from '@shared/types'

const SPEEDS = [0.5, 1, 2, 4]

export function LivePage() {
  const t = useTKey()
  const toast = useToast()
  const [status, setStatus] = useState<LiveStatus>({
    state: 'idle',
    cs2Running: false,
    vconsoleConnected: false,
    gsiActive: false
  })
  const [gsi, setGsi] = useState<GsiGameState | null>(null)
  const [cmd, setCmd] = useState('')
  const [speed, setSpeed] = useState(1)
  const [roundJump, setRoundJump] = useState('')
  const [specId, setSpecId] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.live.getStatus().then(setStatus)
    const off = window.api.onEvent('live:status', (e) => setStatus(e.status))
    const offGsi = window.api.onEvent('gsi:state', (e) => setGsi(e.state))
    const offCon = window.api.onEvent('live:console', (e) => {
      if (logRef.current) {
        const div = document.createElement('div')
        div.textContent = `[${e.channel}] ${e.text}`
        div.style.color = e.channel === 'VConComm' ? 'var(--green)' : 'var(--text-1)'
        logRef.current.appendChild(div)
        while (logRef.current.children.length > 120) logRef.current.removeChild(logRef.current.firstChild!)
        logRef.current.scrollTop = logRef.current.scrollHeight
      }
    })
    return () => {
      off()
      offGsi()
      offCon()
    }
  }, [])

  const guard = async (fn: () => Promise<boolean>): Promise<boolean> => {
    const ok = await fn()
    if (!ok) toast.push(t('live.toolsHint'), 'warn')
    return ok
  }

  const launchCs2 = async () => {
    const s = await window.api.settings.get()
    const r = await window.api.live.launch({ toolsMode: !!s.cs2?.useToolsMode })
    if (r.ok) toast.push(t('live.launched'))
    else toast.push(r.error ?? t('common.error'), 'warn')
  }

  const sendCmd = () => {
    if (!cmd.trim()) return
    guard(() => window.api.live.sendCommand(cmd.trim())).then((ok) => {
      if (ok) {
        // 本地回显到日志
        if (logRef.current) {
          const div = document.createElement('div')
          div.textContent = `» ${cmd.trim()}`
          logRef.current.appendChild(div)
          logRef.current.scrollTop = logRef.current.scrollHeight
        }
        setCmd('')
      }
    })
  }

  const live = status.state === 'live'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="title">
            {t('live.title')}
          </div>
        </div>
        <div className="actions">
          <span className={`phase-pill ${live ? 'live' : ''}`}>
            {live ? t('live.connected') : t('live.sim')}
          </span>
        </div>
      </div>

      {/* 连接状态 */}
      <Panel className="hud-accent" raised>
        <div className="panel-bd flex" style={{ alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <Led state={status.cs2Running ? 'on' : 'off'} label={t('status.cs2')} />
            <Led state={status.vconsoleConnected ? 'on' : status.cs2Running ? 'warn' : 'off'} label={t('status.vcon')} />
            <Led state={status.gsiActive ? 'on' : 'off'} label={t('status.gsi')} />
          </div>
          <div className="grow" />
          <span style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 600 }}>
            {t(`live.status.${status.state}`)}
          </span>
          {!live && (
            <Btn
              variant="accent"
              onClick={() =>
                guard(async () => {
                  const s = await window.api.live.connect()
                  return s.state === 'live'
                })
              }
            >
              {t('live.connect')}
            </Btn>
          )}
          {!status.cs2Running && (
            <Btn variant="primary" onClick={launchCs2}>
              {t('live.launch')}
            </Btn>
          )}
        </div>
        {!status.cs2Running && (
          <div className="panel-bd" style={{ paddingTop: 0, fontSize: 11, color: 'var(--text-2)' }}>
            {t('live.simHint')} · {t('live.toolsHint')}
          </div>
        )}
      </Panel>

      {/* 控制台 */}
      <SectionHead idx={1}>{t('nav.live')} · {t('live.deck')}</SectionHead>
      <Panel>
        <div className="panel-bd">
          <div className="deck">
            <Btn variant={live ? 'accent' : 'ghost'} onClick={() => guard(() => window.api.live.pause())}>
              <IcPause size={13} />
              {t('live.pause')}
            </Btn>
            <Btn variant={live ? 'accent' : 'ghost'} onClick={() => guard(() => window.api.live.resume())}>
              <IcPlay size={13} />
              {t('live.play')}
            </Btn>
            <span className="gap" />
            <span className="muted" style={{ fontSize: 11.5 }}>
              {t('live.timescale')}
            </span>
            <div className="seg">
              {SPEEDS.map((s) => (
                <span
                  key={s}
                  className={`seg-item ${speed === s ? 'on' : ''}`}
                  onClick={() => {
                    setSpeed(s)
                    guard(() => window.api.live.setTimescale(s))
                  }}
                >
                  {s}x
                </span>
              ))}
            </div>
            <span className="gap" />
            <span className="muted" style={{ fontSize: 11.5 }}>
              {t('live.jumpRound')}
            </span>
            <input
              className="input"
              style={{ width: 64 }}
              placeholder="R"
              value={roundJump}
              onChange={(e) => setRoundJump(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && roundJump) {
                  const r = Number(roundJump)
                  guard(() => window.api.live.jumpTick(r * 64 * 105)).then(() => setRoundJump(''))
                }
              }}
            />
            <Btn variant="ghost" size="sm" onClick={() => guard(() => window.api.live.specPrev())}>
              {t('live.specPrev')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => guard(() => window.api.live.specNext())}>
              {t('live.specNext')}
            </Btn>
            <span className="gap" />
            <input
              className="input"
              style={{ width: 84 }}
              placeholder={t('live.specUserid')}
              value={specId}
              onChange={(e) => setSpecId(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && specId) {
                  guard(() => window.api.live.specGoto(Number(specId))).then(() => setSpecId(''))
                }
              }}
            />
            <Btn variant="ghost" size="sm" onClick={() => guard(() => window.api.live.specGoto(Number(specId)))}>
              {t('live.specGoto')}
            </Btn>
          </div>

          <div className="hr" />

          <div className="flex gap-8" style={{ alignItems: 'center' }}>
            <input
              className="input grow"
              placeholder={`${t('live.command')} — e.g. demo_gototick 12000`}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCmd()}
            />
            <Btn variant="primary" onClick={sendCmd}>
              <IcJump size={13} />
              {t('live.send')}
            </Btn>
          </div>

          <div
            ref={logRef}
            style={{
              marginTop: 10,
              height: 120,
              overflowY: 'auto',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--line-0)',
              borderRadius: 'var(--r-md)',
              padding: '8px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-1)',
              lineHeight: 1.7
            }}
          >
            <div style={{ color: 'var(--text-2)' }}>— {t('live.sim')} console —</div>
          </div>
        </div>
      </Panel>

      {/* GSI 状态 */}
      <SectionHead idx={2}>{t('live.gsiState')}</SectionHead>
      <Panel>
        <div className="panel-bd" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {(
            [
              [t('live.map'), gsi?.map ?? '—'],
              [t('live.round'), gsi?.round != null ? `R${gsi.round}` : '—'],
              [t('live.score'), gsi ? `${gsi.scoreT ?? 0} : ${gsi.scoreCT ?? 0}` : '—'],
              [t('live.phase'), gsi?.phase ?? '—'],
              [t('live.bomb'), gsi?.bomb ? String(gsi.bomb).toUpperCase() : '—']
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>
                {k}
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {v}
              </div>
            </div>
          ))}
          {gsi?.playersAliveT != null && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.2em', color: 'var(--text-2)', textTransform: 'uppercase' }}>
                ALIVE
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                <span style={{ color: 'var(--t)' }}>{gsi.playersAliveT}</span>
                <span style={{ color: 'var(--text-2)' }}> : </span>
                <span style={{ color: 'var(--ct)' }}>{gsi.playersAliveCT}</span>
              </div>
            </div>
          )}
        </div>
        {!status.gsiActive && (
          <div className="panel-bd" style={{ paddingTop: 0, fontSize: 11, color: 'var(--text-2)' }}>
            {t('live.gsiHint')}
          </div>
        )}
      </Panel>

      {/* 说明 */}
      <div className="flex" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Tag tone="ghost">demo_gototick</Tag>
        <Tag tone="ghost">demo_pause / demo_resume</Tag>
        <Tag tone="ghost">demo_timescale</Tag>
        <Tag tone="ghost">spec_goto</Tag>
        <Tag tone="ghost">spec_next / spec_prev</Tag>
      </div>
    </div>
  )
}
