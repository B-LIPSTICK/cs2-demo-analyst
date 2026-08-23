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
import { fmtDate } from '@/components/ui'

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
  const [favIds, setFavIds] = useState<Set<string>>(new Set())
  const [roots, setRoots] = useState<string[]>([])
  // 目录过滤：默认记住上次选择的目录（localStorage），「全部目录」需手动点
  const [rootFilter, setRootFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('lib.rootFilter') ?? ''
    } catch {
      return ''
    }
  })
  const [sortMode, setSortMode] = useState<'date' | 'added'>('date')
  const [rootOpen, setRootOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [removeModal, setRemoveModal] = useState<{ ids: string[] } | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})

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

  // 事件回写：语音检测 / 库更新 / 解析进度
  useEffect(() => {
    const off = window.api.onEvent('voice:detected', (e) => {
      setDemos((ds) =>
        ds.map((d) => (d.id === e.id ? { ...d, hasVoice: e.hasVoice, voiceSec: e.voiceSec } : d))
      )
    })
    const offLib = window.api.onEvent('library:updated', (e) => setDemos(e.demos))
    const offProg = window.api.onEvent('library:progress', (e) => {
      // 只更新进度数据（单卡片 Ring 展示），不动整个列表
      setProgress((p) => ({ ...p, [e.id]: typeof e.progress === 'number' ? e.progress : 0 }))
    })
    const offItem = window.api.onEvent('library:item', (e) => {
      // 单条目更新：只替换该 demo 的卡片，清掉其进度
      setProgress((p) => {
        const n = { ...p }
        delete n[e.id]
        return n
      })
      setDemos((ds) => ds.map((d) => (d.id === e.id ? e.meta : d)))
    })
    return () => {
      off()
      offLib()
      offProg()
      offItem()
    }
  }, [])

  // 收藏列表
  useEffect(() => {
    window.api.favorites
      .list()
      .then((list) => setFavIds(new Set(list.map((f) => f.id))))
      .catch(() => {})
  }, [])

  // 库目录（多目录下拉切换）
  useEffect(() => {
    window.api.settings.get().then((s) => {
      const rs = s.libraryRoots ?? []
      setRoots(rs)
      // 记住的目录已不存在 → 回退到第一个目录（而不是全部）
      setRootFilter((cur) => {
        if (cur && rs.includes(cur)) return cur
        return rs[0] ?? ''
      })
    }).catch(() => {})
  }, [])

  // 目录选择持久化（下次启动保持上次目录）
  useEffect(() => {
    try {
      localStorage.setItem('lib.rootFilter', rootFilter)
    } catch {
      /* noop */
    }
  }, [rootFilter])

  const toggleFav = async (id: string) => {
    if (favIds.has(id)) {
      await window.api.favorites.remove(id)
      setFavIds((prev) => new Set([...prev].filter((x) => x !== id)))
      toast.push(t('library.favOff'))
    } else {
      try {
        await window.api.favorites.add(id)
        setFavIds((prev) => new Set([...prev, id]))
        toast.push(t('library.favOn'))
      } catch (err) {
        toast.push(
          t('library.favFailed').replace('{err}', err instanceof Error ? err.message : String(err)),
          'err'
        )
      }
    }
  }

  /** 删除确认后执行（deleteFile=true 同时删源文件） */
  const confirmRemove = async (ids: string[], deleteFile: boolean) => {
    for (const id of ids) {
      try {
        await window.api.library.remove(id, deleteFile ? { deleteFile: true } : undefined)
      } catch {
        /* 单个失败继续 */
      }
    }
    setDemos((ds) => ds.filter((d) => !ids.includes(d.id)))
    setRemoveModal(null)
    setSelectedIds(new Set())
    setSelectMode(false)
    toast.push(t('library.removed'))
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelect = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const rootName = (r: string) => r.split(/[\\/]/).filter(Boolean).at(-1) ?? r

  /** 从下拉里移除目录（主进程同步清理并扫描） */
  const removeRootAt = async (r: string) => {
    try {
      await window.api.library.removeRoot(r)
      setRoots((rs) => rs.filter((x) => x !== r))
      if (rootFilter === r) setRootFilter('')
      setRootOpen(false)
      load()
      toast.push(t('library.rootRemoved'))
    } catch {
      toast.push(t('common.error'), 'err')
    }
  }

  // 点击外部关闭目录下拉
  useEffect(() => {
    if (!rootOpen) return
    const close = () => setRootOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [rootOpen])

  const pendingCount = demos.filter((d) => d.status === 'pending').length

  const filtered = useMemo(() => {
    let list = demos
    // 目录过滤（zip 容器条目按其容器路径归属）
    if (rootFilter) {
      list = list.filter(
        (d) => d.path.startsWith(rootFilter) || (d.containerPath?.startsWith(rootFilter) ?? false)
      )
    }
    // 排序：按日期（默认，新的在前）或按加入时间
    list = [...list].sort((a, b) => {
      const keyA = sortMode === 'date' ? (a.dateMs ?? a.mtimeMs ?? a.addedAt) : a.addedAt
      const keyB = sortMode === 'date' ? (b.dateMs ?? b.mtimeMs ?? b.addedAt) : b.addedAt
      return keyB - keyA
    })
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (d) =>
        d.fileName.toLowerCase().includes(q) ||
        (d.mapName ?? '').toLowerCase().includes(q) ||
        d.teamT?.toLowerCase().includes(q) ||
        d.teamCT?.toLowerCase().includes(q)
    )
  }, [demos, query, rootFilter, sortMode])

  return (
    <div className="page" style={{ position: 'relative' }}>
      <div className="page-head">
        <div>
          <div className="title">
            {t('library.title')}
          </div>
          <div className="sub">{t('library.subtitle')}</div>
        </div>
        <div className="actions">
          {selectedIds.size > 0 ? (
            <>
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('library.selected').replace('{n}', String(selectedIds.size))}
              </span>
              <Btn
                variant="danger"
                disabled={selectedIds.size === 0}
                onClick={() => setRemoveModal({ ids: [...selectedIds] })}
              >
                {t('library.deleteSelected')}
              </Btn>
              <Btn variant="ghost" onClick={exitSelect}>
                {t('library.cancelSelect')}
              </Btn>
            </>
          ) : (
            <>
              {roots.length > 0 && (
                <div className="root-select" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="input root-select-btn"
                    onClick={() => setRootOpen((v) => !v)}
                    title={t('library.rootFilter')}
                  >
                    <span className="grow" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rootFilter ? rootName(rootFilter) : t('library.allRoots')}
                    </span>
                    <span style={{ color: 'var(--text-2)', fontSize: 10 }}>▾</span>
                  </button>
                  {rootOpen && (
                    <div className="root-menu">
                      <button
                        className={`root-item ${rootFilter === '' ? 'on' : ''}`}
                        onClick={() => {
                          setRootFilter('')
                          setRootOpen(false)
                        }}
                      >
                        {t('library.allRoots')}
                      </button>
                      {roots.map((r) => (
                        <div key={r} className={`root-item row ${rootFilter === r ? 'on' : ''}`}>
                          <button
                            className="grow root-name"
                            title={r}
                            onClick={() => {
                              setRootFilter(r)
                              setRootOpen(false)
                            }}
                          >
                            {rootName(r)}
                          </button>
                          <button
                            className="root-del"
                            title={t('library.removeDir')}
                            onClick={() => removeRootAt(r)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="row">
                <IcSearch size={15} />
                <input
                  className="input"
                  style={{ width: 160 }}
                  placeholder={t('common.search')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className="input select"
                style={{ width: 110 }}
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as 'date' | 'added')}
                title={t('library.sortBy')}
              >
                <option value="date">{t('library.sortDate')}</option>
                <option value="added">{t('library.sortAdded')}</option>
              </select>
              <Btn variant="ghost" onClick={async () => {
                await window.api.library.addRoot()
                load()
              }}>
                <IcPlus size={13} />
                {t('library.addRoot')}
              </Btn>
              <Btn variant="ghost" onClick={async () => {
                // 真正重新扫描磁盘（旧实现只读内存缓存，新下载的 demo 不出现）
                await window.api.library.rescan()
                load()
              }}>
                <IcRefresh size={13} />
                {t('library.rescan')}
              </Btn>
              {pendingCount > 0 && (
                <Btn
                  variant="accent"
                  onClick={async () => {
                    await window.api.library.parseAll()
                    toast.push(t('library.parseStart'))
                  }}
                >
                  {t('library.parseAll')}（{pendingCount}）
                </Btn>
              )}
              <Btn variant="ghost" onClick={() => window.api.favorites.reveal()}>
                ★ {t('library.favFolder')}
              </Btn>
              <Btn variant="ghost" onClick={() => setSelectMode(true)}>
                {t('library.select')}
              </Btn>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <Empty ghost="SCANNING" hint="…" />
      ) : filtered.length === 0 && demos.length === 0 ? (
        <Empty ghost="NO DEMOS" hint={t('library.emptyHint')}>
          <Btn
            variant="ghost"
            onClick={async () => {
              await window.api.library.addRoot()
              load()
            }}
            style={{ marginTop: 6 }}
          >
            <IcPlus size={13} />
            {t('library.addRoot')}
          </Btn>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty ghost="NO DEMOS" hint={query ? t('common.search') : ''} />
      ) : (
        <div className="card-grid">
          {filtered.map((d, i) => (
            <DemoCard
              key={d.id}
              demo={d}
              index={i}
              fav={favIds.has(d.id)}
              progress={progress[d.id]}
              selectMode={selectMode}
              selected={selectedIds.has(d.id)}
              onOpen={() => {
                // 打开详情前清空多选状态
                setSelectMode(false)
                setSelectedIds(new Set())
                onOpenDemo(d.id)
              }}
              onToggleSelect={() => toggleSelect(d.id)}
              onToggleFav={() => toggleFav(d.id)}
              onRemoveMenu={() => setRemoveModal({ ids: [d.id] })}
              onParse={() => {
                window.api.library.parse(d.id)
                toast.push(t('library.parseStart'))
              }}
              onReparse={() => {
                window.api.library.parse(d.id, true)
                toast.push(t('library.reparseStart'))
              }}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          {t('library.mmNoVoice')}
        </span>
      </div>

      {/* 删除确认弹窗 */}
      {removeModal && (
        <div className="modal-overlay" onClick={() => setRemoveModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('library.removeTitle')}</div>
            <div className="modal-body">
              {t('library.removeBody').replace('{n}', String(removeModal.ids.length))}
            </div>
            <div className="modal-actions">
              <button
                className="modal-choice"
                onClick={() => confirmRemove(removeModal.ids, false)}
              >
                <span className="modal-choice-t">{t('library.removeOnly')}</span>
                <span className="modal-choice-d">{t('library.removeOnlyHint')}</span>
              </button>
              <button
                className="modal-choice danger"
                onClick={() => confirmRemove(removeModal.ids, true)}
              >
                <span className="modal-choice-t">{t('library.removeWithFile')}</span>
                <span className="modal-choice-d">{t('library.removeWithFileHint')}</span>
              </button>
            </div>
            <div className="modal-cancel">
              <Btn variant="ghost" size="sm" onClick={() => setRemoveModal(null)}>
                {t('common.cancel')}
              </Btn>
            </div>
          </div>
        </div>
      )}
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

/**
 * 地图小地图图标：每张地图一幅简化俯视轮廓（雷达图风格），替代文字缩写。
 * 44×44 viewBox，白色线条 + 炸弹点圆点；未知地图用山形兜底。
 */
function MapGlyph({ map }: { map?: string }) {
  const key = (map ?? '').toLowerCase().replace(/^de_/, '')
  const stroke = {
    stroke: 'rgba(255,255,255,0.92)',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none'
  }
  const site = { fill: 'rgba(255,255,255,0.95)', stroke: 'none' }
  switch (key) {
    case 'dust2':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 15h32M6 29h32" {...stroke} />
          <path d="M15 6v38" {...stroke} />
          <path d="M29 6v38" {...stroke} />
          <path d="M6 15L15 29M38 29L29 15" {...stroke} strokeDasharray="2 2" opacity={0.6} />
          <circle cx="10.5" cy="10.5" r="2.1" {...site} />
          <circle cx="33.5" cy="33.5" r="2.1" {...site} />
        </svg>
      )
    case 'mirage':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M22 6v32" {...stroke} />
          <path d="M6 13h32M6 31h32" {...stroke} />
          <path d="M6 13h9M35 13h-9M6 31h9M35 31h-9" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <circle cx="9.5" cy="25" r="2.1" {...site} />
          <circle cx="34.5" cy="19" r="2.1" {...site} />
        </svg>
      )
    case 'inferno':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 24L24 6M6 38L38 6" {...stroke} />
          <path d="M38 24L24 38" {...stroke} />
          <path d="M24 6L30 12M30 12l-6 6M30 12l6 6" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <circle cx="9" cy="20" r="2.1" {...site} />
          <circle cx="35" cy="28" r="2.1" {...site} />
        </svg>
      )
    case 'anubis':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M10 22q6-5 12 0t12 0" {...stroke} />
          <path d="M10 30q6-5 12 0t12 0" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <path d="M22 6v12M22 32v6" {...stroke} />
          <circle cx="9.5" cy="12" r="2.1" {...site} />
          <circle cx="34.5" cy="34" r="2.1" {...site} />
        </svg>
      )
    case 'nuke':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <circle cx="22" cy="22" r="9" {...stroke} />
          <circle cx="22" cy="22" r="3.4" {...stroke} />
          <path d="M22 13v-7M22 31v7" {...stroke} />
          <path d="M13 22H6M31 22h7" {...stroke} />
          <circle cx="14" cy="10" r="2.1" {...site} />
          <circle cx="30" cy="34" r="2.1" {...site} />
        </svg>
      )
    case 'ancient':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 15h32M6 29h32" {...stroke} />
          <path d="M16 15v14M28 15v14" {...stroke} />
          <path d="M6 22h10M28 22h10" {...stroke} />
          <circle cx="9.5" cy="34.5" r="2.1" {...site} />
          <circle cx="34.5" cy="9.5" r="2.1" {...site} />
        </svg>
      )
    case 'train':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 14h32M6 30h32" {...stroke} />
          <path d="M14 14v16M30 14v16" {...stroke} />
          <path d="M14 6v8M14 30v8M30 6v8M30 30v8" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <circle cx="9.5" cy="10" r="2.1" {...site} />
          <circle cx="34.5" cy="34" r="2.1" {...site} />
        </svg>
      )
    case 'vertigo':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <rect x="13" y="13" width="18" height="18" rx="3" {...stroke} />
          <path d="M22 6v7M22 31v7M6 22h7M31 22h7" {...stroke} />
          <path d="M13 22H6M31 22h7" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <circle cx="22" cy="22" r="2.1" {...site} />
        </svg>
      )
    case 'overpass':
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 14h32M6 30h32" {...stroke} />
          <path d="M20 6v38" {...stroke} />
          <path d="M20 14l-7 8M20 14l7 8" {...stroke} strokeDasharray="2 2" opacity={0.55} />
          <circle cx="10" cy="37" r="2.1" {...site} />
          <circle cx="34" cy="7" r="2.1" {...site} />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <rect x="6" y="6" width="32" height="32" rx="4" {...stroke} />
          <path d="M6 34L17 14l7 12 4-6 10 14z" {...stroke} />
          <circle cx="33.5" cy="10.5" r="2.1" {...site} />
        </svg>
      )
  }
}

/** 未解析时从文件名推断地图（文件名常含 de_xxx；纯数字文件名的平台 demo 推不出返回 undefined） */
function inferMap(fileName: string): string | undefined {
  const f = fileName.toLowerCase()
  const m = f.match(/de_[a-z0-9_]+/)
  if (m) return m[0]
  const known = Object.keys(MAP_BADGE_CLASS)
  return known.find((k) => k.startsWith('de_') && f.includes(k))
}

function DemoCard({
  demo,
  index,
  fav,
  progress,
  selectMode,
  selected,
  onOpen,
  onToggleSelect,
  onToggleFav,
  onRemoveMenu,
  onParse,
  onReparse
}: {
  demo: DemoMeta
  index: number
  fav: boolean
  progress?: number
  selectMode: boolean
  selected: boolean
  onOpen: () => void
  onToggleSelect: () => void
  onToggleFav: () => void
  onRemoveMenu: () => void
  onParse: () => void
  onReparse: () => void
}) {
  const t = useTKey()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  // 未解析时用文件名推断地图（已解析用真实 mapName）
  const mapName = demo.mapName ?? inferMap(demo.fileName)
  const badge = mapBadge(mapName)

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])

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
      className={`card ${selected ? 'selected' : ''}`}
      style={{ ['--i' as string]: index } as React.CSSProperties}
      onClick={(e) => {
        // Ctrl/⌘ 点击或选择模式 → 切换选中；普通点击 → 打开详情
        if (e.ctrlKey || e.metaKey || selectMode) {
          e.preventDefault()
          onToggleSelect()
        } else {
          onOpen()
        }
      }}
    >
      {/* 选择模式：左上角勾选 */}
      {selectMode && <span className={`card-check ${selected ? 'on' : ''}`}>{selected ? '✓' : ''}</span>}

      {/* 单卡操作菜单（⋯）：放在 top 行比分右侧，不遮挡比分/统计 */}
      <div className="top">
        <span className={`map-badge ${badge.cls}`}>
          <MapGlyph map={mapName} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="map">{mapName ?? '—'}</div>
          <div className="file" title={demo.path}>
            {demo.fileName}
          </div>
          <div className="date">{fmtDate(demo.dateMs ?? demo.mtimeMs ?? demo.addedAt)}</div>
        </div>
        <div className="score">
          <span className="t">{demo.scoreT ?? 0}</span>
          <span className="sep">:</span>
          <span className="ct">{demo.scoreCT ?? 0}</span>
        </div>
        {!selectMode && (
          <div className="card-menu-wrap">
            <button
              className="card-menu-btn"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="card-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  className="card-menu-item"
                  onClick={() => {
                    onToggleFav()
                    setMenuOpen(false)
                  }}
                >
                  {fav ? `★ ${t('library.menuUnfav')}` : `☆ ${t('library.menuFav')}`}
                </button>
                {demo.status === 'ready' && (
                  <button
                    className="card-menu-item"
                    onClick={() => {
                      onReparse()
                      setMenuOpen(false)
                    }}
                  >
                    ↻ {t('library.menuReparse')}
                  </button>
                )}
                <button
                  className="card-menu-item danger"
                  onClick={() => {
                    onRemoveMenu()
                    setMenuOpen(false)
                  }}
                >
                  ✕ {t('library.menuRemove')}
                </button>
              </div>
            )}
          </div>
        )}
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
          {progress !== undefined || demo.status === 'parsing' ? (
            <Ring pct={Math.max(0.03, Math.min(0.99, progress ?? 0.03))} label={`${Math.round((progress ?? 0.03) * 100)}%`} />
          ) : (
            <Btn
              size="sm"
              variant="accent"
              onClick={(e) => {
                e.stopPropagation()
                onParse()
              }}
            >
              {t('library.parseNow')}
            </Btn>
          )}
        </div>
      )}
      {demo.status === 'error' && (
        <div className="status-cover">
          <Btn
            size="sm"
            variant="danger"
            onClick={(e) => {
              e.stopPropagation()
              onParse()
            }}
          >
            {t('library.retry')}
          </Btn>
        </div>
      )}
    </article>
  )
}
