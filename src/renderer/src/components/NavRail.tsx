import type { ReactNode } from 'react'
import { IcLibrary, IcTranscript, IcLive, IcSettings } from './ui'
import { useTKey } from '@/i18n'

export type Page = 'library' | 'transcript' | 'live' | 'settings'

const ITEMS: { id: Page; icon: (p: { size?: number }) => ReactNode; tag?: string }[] = [
  { id: 'library', icon: (p) => <IcLibrary {...p} /> },
  { id: 'transcript', icon: (p) => <IcTranscript {...p} /> },
  { id: 'live', icon: (p) => <IcLive {...p} />, tag: 'INJECT' },
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
          {it.tag && <span className="tag">{it.tag}</span>}
        </div>
      ))}
      <div className="nav-foot">
        <div className="mini">
          CS2 DEMO ANALYST
          <br />
          BUILD 0.1 · {version}
        </div>
      </div>
    </nav>
  )
}
