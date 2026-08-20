import type { ReactNode } from 'react'
import { IcLibrary, IcTranscript, IcLive, IcSettings, IcSpark } from './ui'
import { useTKey, type TKey } from '@/i18n'

export type Page = 'library' | 'transcript' | 'live' | 'ai' | 'settings'

const ITEMS: { id: Page; icon: (p: { size?: number }) => ReactNode; tagKey?: TKey }[] = [
  { id: 'library', icon: (p) => <IcLibrary {...p} /> },
  { id: 'transcript', icon: (p) => <IcTranscript {...p} /> },
  { id: 'ai', icon: (p) => <IcSpark {...p} />, tagKey: 'nav.aiTag' },
  { id: 'live', icon: (p) => <IcLive {...p} />, tagKey: 'nav.liveTag' },
  { id: 'settings', icon: (p) => <IcSettings {...p} /> }
]

export function NavRail({
  page,
  onNavigate,
  version
}: {
  page: Page
  onNavigate: (p: Page) => void
  version: string
}) {
  const t = useTKey()
  return (
    <nav className="navrail">
      {ITEMS.map((it) => (
        <div
          key={it.id}
          className={`nav-item ${page === it.id ? 'active' : ''}`}
          onClick={() => onNavigate(it.id)}
        >
          {it.icon({ size: 15 })}
          <span>{t(`nav.${it.id}`)}</span>
          {it.tagKey && <span className="tag">{t(it.tagKey)}</span>}
        </div>
      ))}
      <div className="nav-foot">
        <div className="mini">
          Demo Analyst
          <br />
          BUILD 0.1 · {version}
        </div>
      </div>
    </nav>
  )
}
