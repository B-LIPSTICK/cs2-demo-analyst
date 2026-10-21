import type { ReactNode } from 'react'
import { IcLibrary, IcTranscript, IcSettings, IcSpark } from './ui'
import { useTKey, type TKey } from '@/i18n'

export type Page = 'library' | 'transcript' | 'ai' | 'settings'

const ITEMS: { id: Page; icon: (p: { size?: number }) => ReactNode; tagKey?: TKey }[] = [
  { id: 'library', icon: (p) => <IcLibrary {...p} /> },
  { id: 'transcript', icon: (p) => <IcTranscript {...p} /> },
  { id: 'ai', icon: (p) => <IcSpark {...p} />, tagKey: 'nav.aiTag' },
  { id: 'settings', icon: (p) => <IcSettings {...p} /> }
]

export function NavRail({
  page,
  onNavigate
}: {
  page: Page
  onNavigate: (p: Page) => void
}) {
  const t = useTKey()
  return (
    <nav className="navrail" aria-label="主导航">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`nav-item ${page === it.id ? 'active' : ''}`}
          onClick={() => onNavigate(it.id)}
          aria-current={page === it.id ? 'page' : undefined}
        >
          {it.icon({ size: 15 })}
          <span>{t(`nav.${it.id}`)}</span>
          {it.tagKey && <span className="tag">{t(it.tagKey)}</span>}
        </button>
      ))}
      <div className="nav-foot">
        <button
          type="button"
          className="nav-credit-btn"
          onClick={() => window.api.app.openUrl('https://space.bilibili.com/3632307015518585')}
          title="访问 B-LIPSTICK 的 Bilibili 空间"
        >
          {t('nav.credit')}
        </button>
      </div>
    </nav>
  )
}
