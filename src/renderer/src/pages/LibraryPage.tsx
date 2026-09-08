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
    const offSettings = window.api.onEvent('settings:changed', (e) => {
      const rs = e.settings.libraryRoots ?? []
      setRoots(rs)
    })
    return () => {
      off()
      offLib()
      offProg()
      offItem()
      offSettings()
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

  const onAddRoot = async () => {
    try {
      const newRoots = await window.api.library.addRoot()
      if (newRoots && newRoots.length > 0) {
        setRoots(newRoots)
        // 自动选中新添加的目录
        const lastAdded = newRoots[newRoots.length - 1]
        if (lastAdded) setRootFilter(lastAdded)
      }
      await load()
    } catch {
      toast.push(t('common.error'), 'err')
    }
  }

  const onRescan = async () => {
    try {
      await window.api.library.rescan()
      await load()
      toast.push(t('library.rescanDone'))
    } catch {
      toast.push(t('common.error'), 'err')
    }
  }

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
    // 目录过滤（zip 容器条目按其容器路径归属；Windows 路径做斜杠与大小写归一化）
    if (rootFilter) {
      const rf = rootFilter.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
      list = list.filter((d) => {
        const p = d.path.replace(/\\/g, '/').toLowerCase()
        const cp = d.containerPath ? d.containerPath.replace(/\\/g, '/').toLowerCase() : ''
        return p.startsWith(rf) || cp.startsWith(rf)
      })
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
              <Btn variant="ghost" onClick={onAddRoot}>
                <IcPlus size={13} />
                {t('library.addRoot')}
              </Btn>
              <Btn variant="ghost" onClick={onRescan}>
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
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <Btn variant="ghost" onClick={onAddRoot}>
              <IcPlus size={13} />
              {t('library.addRoot')}
            </Btn>
            <Btn variant="ghost" onClick={onRescan}>
              <IcRefresh size={13} />
              {t('library.rescan')}
            </Btn>
          </div>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty
          ghost="NO DEMOS"
          hint={query ? t('common.search') : (rootFilter ? `当前目录下暂无 Demo（${rootName(rootFilter)}）` : '')}
        >
          {rootFilter && (
            <Btn variant="ghost" size="sm" onClick={() => setRootFilter('')} style={{ marginTop: 8 }}>
              {t('library.allRoots')}
            </Btn>
          )}
        </Empty>
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

      {/* 单卡操作菜单（⋯）：放在 top 行右侧，不遮挡比分/统计 */}
      <div className="top">
        <div style={{ minWidth: 0 }}>
          <div className="map">{mapName ?? '—'}</div>
          <div className="file" title={demo.path}>
            {demo.fileName}
          </div>
          <div className="date-row">
            <div className="date">{fmtDate(demo.dateMs ?? demo.mtimeMs ?? demo.addedAt)}</div>
            {voiceTag}
          </div>
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
