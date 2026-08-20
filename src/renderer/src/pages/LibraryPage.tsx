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
  const [dragOver, setDragOver] = useState(false)
  const isWeb = typeof window !== 'undefined' && Boolean((window as unknown as { __demoAnalystWeb?: unknown }).__demoAnalystWeb)

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

  const tryDemo = async () => {
    const w = window as unknown as { __demoAnalystWeb?: { loadDemoDemos: () => void } }
    w.__demoAnalystWeb?.loadDemoDemos()
    toast.push('demo')
  }

  // 拖放导入（Web 模式）
  useEffect(() => {
    if (!isWeb) return
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false)
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const demFiles = files.filter((f) => f.name.toLowerCase().endsWith('.dem'))
      if (demFiles.length === 0) {
        toast.push('仅支持 .dem 文件', 'warn')
        return
      }
      const w = window as unknown as { __demoAnalystWeb?: { addFile: (f: File) => Promise<string | null> } }
      let ok = 0
      for (const f of demFiles) {
        const id = await w.__demoAnalystWeb?.addFile(f)
        if (id) ok++
      }
      if (ok) toast.push(`+${ok} demo`)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [isWeb, toast])

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
          <div className="sub">{isWeb ? t('library.webIntro') : t('library.subtitle')}</div>
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
            {isWeb ? t('library.pickFiles') : t('library.addRoot')}
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
        isWeb ? (
          <div className={`drop-zone ${dragOver ? 'over' : ''}`}>
            <div className="drop-icon">
              <svg viewBox="0 0 48 48" fill="none">
                <path d="M24 6v22M13 17l11-11 11 11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
                <path d="M8 30v8a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
              </svg>
            </div>
            <div className="drop-title">{t('library.dropTitle')}</div>
            <div className="drop-hint">{t('library.dropHint')}</div>
            <div className="flex gap-8" style={{ marginTop: 16, justifyContent: 'center' }}>
              <Btn variant="primary" onClick={addRoot}>
                <IcPlus size={13} />
                {t('library.pickFiles')}
              </Btn>
              <Btn variant="ghost" onClick={tryDemo}>
                {t('library.tryDemo')}
              </Btn>
            </div>
            <div className="drop-steps">
              <div className="ds"><span>{t('library.step1')}</span>{t('library.step1Desc')}</div>
              <div className="ds"><span>{t('library.step2')}</span>{t('library.step2Desc')}</div>
              <div className="ds"><span>{t('library.step3')}</span>{t('library.step3Desc')}</div>
            </div>
          </div>
        ) : (
          <Empty ghost="NO DEMOS" hint={t('library.emptyHint')}>
            <Btn variant="ghost" onClick={addRoot} style={{ marginTop: 6 }}>
              <IcPlus size={13} />
              {t('library.addRoot')}
            </Btn>
          </Empty>
        )
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
      {dragOver && <div className="drop-overlay">{t('library.dropTitle')}</div>}
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
