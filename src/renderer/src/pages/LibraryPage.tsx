import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Btn,
  Empty,
  IcPlus,
  IcRefresh,
  IcSearch,
  Ring,
  Tag,
  fmtBytes,
  fmtTime,
  useToast
} from '@/components/ui'
import { useTKey } from '@/i18n'
import type { DemoMeta } from '@shared/types'
import { DemoDetailPage } from './DemoDetailPage'

function LibraryPageInner({
  onOpenDemo
}: {
  onOpenDemo: (id: string) => void
}) {
  const t = useTKey()
  const toast = useToast()
  const [demos, setDemos] = useState<DemoMeta[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.library.list()
      setDemos(list)
    } catch {
      toast.push('library load failed', 'err')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // 语音检测事件回写
  useEffect(() => {
    const off = window.api.onEvent('voice:detected', (e) => {
      setDemos((ds) =>
        ds.map((d) => (d.id === e.id ? { ...d, hasVoice: e.hasVoice, voiceSec: e.voiceSec } : d))
      )
    })
    const offLib = window.api.onEvent('library:updated', (e) => setDemos(e.demos))
    return () => {
      off()
      offLib()
    }
  }, [])

  const addRoot = async () => {
    const roots = await window.api.library.addRoot()
    if (roots.length) {
      toast.push(`+${roots.length} demos`)
      load()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return demos
    return demos.filter(
      (d) =>
        d.fileName.toLowerCase().includes(q) ||
        (d.mapName ?? '').toLowerCase().includes(q) ||
        d.teamT?.toLowerCase().includes(q) ||
        d.teamCT?.toLowerCase().includes(q)
    )
  }, [demos, query])

  return (
    <div className="page" style={{ position: 'relative' }}>
      <div className="page-head">
        <div>
          <div className="title">
            {t('library.title')} <span className="accent">//</span>
          </div>
          <div className="sub">{t('library.subtitle')}</div>
        </div>
        <div className="actions">
          <div className="row">
            <IcSearch size={15} />
            <input
              className="input"
              style={{ width: 220 }}
              placeholder={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Btn variant="ghost" onClick={addRoot}>
            <IcPlus size={13} />
            {t('library.addRoot')}
          </Btn>
          <Btn variant="ghost" onClick={load}>
            <IcRefresh size={13} />
            {t('library.rescan')}
          </Btn>
        </div>
      </div>

      {loading ? (
        <Empty ghost="SCANNING" hint="…" />
      ) : filtered.length === 0 && demos.length === 0 ? (
        <Empty ghost="NO DEMOS" hint={t('library.emptyHint')}>
          <Btn variant="ghost" onClick={addRoot} style={{ marginTop: 6 }}>
            <IcPlus size={13} />
            {t('library.addRoot')}
          </Btn>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty ghost="NO DEMOS" hint={query ? t('common.search') : ''} />
      ) : (
        <div className="card-grid">
          {filtered.map((d, i) => (
            <DemoCard key={d.id} demo={d} index={i} onOpen={() => onOpenDemo(d.id)} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          {t('library.mmNoVoice')}
        </span>
      </div>
    </div>
  )
}

export function LibraryPage({
  demoId,
  onOpenDemo,
  onGoTranscript
}: {
  demoId?: string
  onOpenDemo: (id: string) => void
  onGoTranscript: (id: string) => void
}) {
  if (demoId) {
    return (
      <DemoDetailPage
        id={demoId}
        onBack={() => onOpenDemo('')}
        onGoTranscript={() => onGoTranscript(demoId)}
      />
    )
  }
  return (
    <LibraryPageInner onOpenDemo={onOpenDemo} />
  )
}

const MAP_BADGE_CLASS: Record<string, string> = {
  de_mirage: 'm-mirage',
  mirage: 'm-mirage',
  de_dust2: 'm-dust2',
  dust2: 'm-dust2',
  de_inferno: 'm-inferno',
  inferno: 'm-inferno',
  de_anubis: 'm-anubis',
  anubis: 'm-anubis',
  de_nuke: 'm-nuke',
  nuke: 'm-nuke',
  de_ancient: 'm-ancient',
  ancient: 'm-ancient',
  de_train: 'm-train',
  train: 'm-train',
  de_vertigo: 'm-vertigo',
  vertigo: 'm-vertigo',
  de_overpass: 'm-overpass',
  overpass: 'm-overpass'
}

function mapBadge(mapName?: string): { cls: string; abbr: string } {
  const key = (mapName ?? '').toLowerCase()
  const cls = MAP_BADGE_CLASS[key] ?? 'm-default'
  const abbr = mapName
    ? mapName.replace(/^de_/, '').slice(0, 2).toUpperCase()
    : '??'
  return { cls, abbr }
}

function DemoCard({
  demo,
  index,
  onOpen
}: {
  demo: DemoMeta
  index: number
  onOpen: () => void
}) {
  const t = useTKey()
  const toast = useToast()
  const badge = mapBadge(demo.mapName)

  const voiceTag = (() => {
    if (demo.hasVoice === true) {
      return (
        <Tag tone="voice" dot>
          {t('library.voice')}
        </Tag>
      )
    }
    if (demo.hasVoice === false) {
      return <Tag tone="ghost">{t('library.noVoice')}</Tag>
    }
    return (
      <Tag tone="ghost">
        {t('library.voicePending')}
        <span
          className="muted"
          style={{ cursor: 'pointer', marginLeft: 4, textDecoration: 'underline dotted' }}
          onClick={async (e) => {
            e.stopPropagation()
            const r = await window.api.voice.detect(demo.id)
            toast.push(r.hasVoice ? `VOICE ${r.voiceSec}s` : t('library.noVoice'))
          }}
        >
          {t('library.voiceScan')}
        </span>
      </Tag>
    )
  })()

  return (
    <article
      className="card"
      style={{ ['--i' as string]: index } as React.CSSProperties}
      onClick={onOpen}
    >
      <div className="top">
        <span className={`map-badge ${badge.cls}`}>{badge.abbr}</span>
        <div style={{ minWidth: 0 }}>
          <div className="map">{demo.mapName ?? '—'}</div>
          <div className="file" title={demo.path}>
            {demo.fileName}
          </div>
        </div>
        <div className="score">
          <span className="t">{demo.scoreT ?? 0}</span>
          <span className="sep">:</span>
          <span className="ct">{demo.scoreCT ?? 0}</span>
        </div>
      </div>

      <div className="mid">
        {demo.teamT && <Tag tone="t">{demo.teamT}</Tag>}
        {demo.teamCT && <Tag tone="ct">{demo.teamCT}</Tag>}
        {voiceTag}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">{t('library.duration')}</div>
          <div className="v">{fmtTime(demo.durationSec ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="k">{t('library.rounds')}</div>
          <div className="v">{demo.roundCount ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="k">{t('library.size')}</div>
          <div className="v">{fmtBytes(demo.sizeBytes)}</div>
        </div>
        <div className="stat">
          <div className="k">{t('library.players')}</div>
          <div className="v">{demo.players?.length ?? '—'}</div>
        </div>
      </div>

      {(demo.status === 'parsing' || demo.status === 'pending') && (
        <div className="status-cover">
          <Ring pct={0.35} label={t('library.parsing')} />
        </div>
      )}
      {demo.status === 'error' && (
        <div className="status-cover">
          <Ring pct={1} label="!" />
        </div>
      )}
    </article>
  )
}
