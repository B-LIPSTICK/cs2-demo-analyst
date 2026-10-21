import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Btn,
  CustomSelect,
  Empty,
  IcPlus,
  IcRadar,
  IcRefresh,
  IcSearch,
  Ring,
  Tag,
  fmtBytes,
  fmtTime,
  useToast
} from '@/components/ui'
import { useT, useTKey, type Lang } from '@/i18n'
import { formatMapName } from '@/utils/format'
import type { DemoMeta } from '@shared/types'
import { DemoDetailPage } from './DemoDetailPage'
import { fmtDate } from '@/components/ui'

/** Enter / Space 激活自定义可点击容器；嵌套控件自身处理时直接忽略。 */
function activateOnKey(e: ReactKeyboardEvent<Element>, action: () => void) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault()
    action()
  }
}

/** 格式化目录展示标签（识别常用对战平台与多层级路径，避免只显示 demo） */
export function formatRootLabel(rootPath: string, lang: Lang = 'zh'): {
  title: string
  subtitle: string
  badge?: string
  badgeClass?: string
} {
  const norm = rootPath.replace(/\\/g, '/').toLowerCase()
  if (norm.includes('wmpvp/demo') || norm.includes('wmpvp\\demo') || norm.includes('/wmpvp')) {
    return {
      title: lang === 'en' ? 'Perfect World Arena' : '完美世界对战平台',
      subtitle: rootPath,
      badge: 'Wmpvp',
      badgeClass: 'root-badge-wmpvp'
    }
  }
  if (norm.includes('5edemocache') || norm.includes('5eclient')) {
    return {
      title: lang === 'en' ? '5E Arena' : '5E 对战平台',
      subtitle: rootPath,
      badge: '5EPlay',
      badgeClass: 'root-badge-5e'
    }
  }
  if (
    norm.includes('game/csgo/demos') ||
    norm.includes('game/csgo/replays') ||
    norm.includes('counter-strike global offensive')
  ) {
    return {
      title: lang === 'en' ? 'CS2 Official Replay' : 'CS2 官方录像',
      subtitle: rootPath,
      badge: 'Steam',
      badgeClass: 'root-badge-steam'
    }
  }
  const parts = rootPath.split(/[\\/]/).filter(Boolean)
  const last2 = parts.length >= 2 ? parts.slice(-2).join(' / ') : parts[0] ?? rootPath
  return {
    title: last2,
    subtitle: rootPath,
    badge: lang === 'en' ? 'Folder' : '文件夹',
    badgeClass: 'root-badge-custom'
  }
}

function LibraryPageInner({
  onOpenDemo
}: {
  onOpenDemo: (id: string) => void
}) {
  const { t, tf, lang } = useT()
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
  const [scanning, setScanning] = useState<{
    phase: 'walk' | 'zip' | 'done'
    done: number
    total: number
  } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const list = await window.api.library.list()
      setDemos(list)
    } catch {
      toast.push('library load failed', 'err')
    } finally {
      if (!silent) setLoading(false)
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
    const offScan = window.api.onEvent('library:scan', (e) => {
      setScanning(e.phase === 'done' ? null : { phase: e.phase, done: e.done, total: e.total })
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
      offScan()
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

  /** 点击解析后立即把卡片切到解析态，避免等待主进程第一条 progress 才出现动画 */
  const markParsing = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setDemos((ds) =>
      ds.map((d) =>
        idSet.has(d.id) && d.status !== 'parsing'
          ? { ...d, status: 'parsing' as const, error: undefined }
          : d
      )
    )
    setProgress((p) => {
      const next = { ...p }
      for (const id of ids) if (next[id] === undefined) next[id] = 0
      return next
    })
  }, [])

  const onRescan = async () => {
    if (scanning) return
    setScanning({ phase: 'walk', done: 0, total: roots.length })
    try {
      await window.api.library.rescan()
      await load(true)
      toast.push(t('library.rescanDone'))
    } catch {
      toast.push(t('common.error'), 'err')
    } finally {
      setScanning(null)
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



  /** 自动扫描本地对战平台（完美/5E/Steam）并一键添加到监控目录 */
  const onAutoDetectRoots = async () => {
    try {
      const res = await window.api.library.autoAddPlatformRoots()
      if (res.added.length > 0) {
        setRoots(res.roots)
        setRootFilter(res.added[0].path)
        toast.push(
          t('library.autoDetectDone').replace('{n}', String(res.added.length))
        )
      } else {
        toast.push(t('library.autoDetectNone'))
      }
      await load()
    } catch {
      toast.push(t('common.error'), 'err')
    }
  }

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

  // 删除确认弹窗支持 Esc 关闭
  useEffect(() => {
    if (!removeModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRemoveModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeModal])

  const pendingCount = demos.filter((d) => d.status === 'pending').length
  const parsingCount = demos.filter((d) => d.status === 'parsing').length

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
    <div className="page library-page" style={{ position: 'relative' }}>
      <div className="page-head">
        <div className="library-page-heading">
          <div className="title">{t('library.title')}</div>
          <div className="library-page-subtitle">{t('library.subtitle')}</div>
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
              <div className="root-select" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`root-select-btn ${rootOpen ? 'active' : ''}`}
                  onClick={() => setRootOpen((v) => !v)}
                  aria-expanded={rootOpen}
                  aria-haspopup="menu"
                  title={rootFilter ? formatRootLabel(rootFilter, lang).subtitle : t('library.allRoots')}
                >
                  <span style={{ fontSize: 13, flex: 'none' }}>📁</span>
                  <span className="grow" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {rootFilter ? formatRootLabel(rootFilter, lang).title : t('library.allRoots')}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 10, flex: 'none' }}>▾</span>
                </button>
                {rootOpen && (
                  <div className="root-menu">
                    {/* 全部目录 */}
                    <div
                      className={`root-menu-item ${rootFilter === '' ? 'on' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-current={rootFilter === '' ? 'true' : undefined}
                      onClick={() => {
                        setRootFilter('')
                        setRootOpen(false)
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        activateOnKey(e, () => {
                          setRootFilter('')
                          setRootOpen(false)
                        })
                      }}
                    >
                      <span style={{ fontSize: 14 }}>🌐</span>
                      <div className="root-item-body">
                        <div className="root-item-title">{t('library.allRoots')}</div>
                        <div className="root-item-sub">
                          {t('library.demosCount').replace('{n}', String(demos.length))}
                        </div>
                      </div>
                      {rootFilter === '' && <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span>}
                    </div>

                    {roots.length > 0 && <div className="root-menu-divider" />}

                    {/* 平台/自定义目录列表 */}
                    {roots.map((r) => {
                      const info = formatRootLabel(r, lang)
                      const rf = r.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
                      const count = demos.filter((d) => {
                        const p = d.path.replace(/\\/g, '/').toLowerCase()
                        const cp = d.containerPath ? d.containerPath.replace(/\\/g, '/').toLowerCase() : ''
                        return p.startsWith(rf) || cp.startsWith(rf)
                      }).length
                      const isCur = rootFilter === r
                      return (
                        <div
                          key={r}
                          className={`root-menu-item ${isCur ? 'on' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-current={isCur ? 'true' : undefined}
                          onClick={() => {
                            setRootFilter(r)
                            setRootOpen(false)
                          }}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return
                            activateOnKey(e, () => {
                              setRootFilter(r)
                              setRootOpen(false)
                            })
                          }}
                        >
                          {info.badge && (
                            <span className={`root-platform-badge ${info.badgeClass}`}>
                              {info.badge}
                            </span>
                          )}
                          <div className="root-item-body">
                            <div className="root-item-title">
                              <span>{info.title}</span>
                              <span className="muted" style={{ fontSize: 11.5, fontWeight: 'normal' }}>
                                ({count})
                              </span>
                            </div>
                            <div className="root-item-sub" title={r}>
                              {info.subtitle}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="root-del-btn"
                            title={t('library.removeDir')}
                            aria-label={`${t('library.removeDir')}：${info.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              removeRootAt(r)
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}

                    <div className="root-menu-divider" />

                    {/* 底部动作栏：自动检测平台目录 + 手动添加目录 */}
                    <div className="root-menu-actions">
                      <button
                        type="button"
                        className="root-menu-action highlight"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRootOpen(false)
                          onAutoDetectRoots()
                        }}
                      >
                        <IcRadar size={13} />
                        <span>{t('library.autoDetect')}</span>
                      </button>
                      <button
                        type="button"
                        className="root-menu-action"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRootOpen(false)
                          onAddRoot()
                        }}
                      >
                        <IcPlus size={13} />
                        <span>{t('library.addCustomDir')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="row library-search">
                <IcSearch size={15} />
                <input
                  className="input library-search-input"
                  placeholder={t('common.search')}
                  aria-label={t('common.search')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <CustomSelect
                width={125}
                value={sortMode}
                options={[
                  { value: 'date', label: t('library.sortDate') },
                  { value: 'added', label: t('library.sortAdded') }
                ]}
                onChange={(v) => setSortMode(v as 'date' | 'added')}
              />
              <Btn variant="secondary" onClick={onAddRoot}>
                <IcPlus size={13} />
                {t('library.addRoot')}
              </Btn>
              <Btn variant="secondary" onClick={onRescan} disabled={!!scanning}>
                <IcRefresh size={13} />
                {t('library.rescan')}
              </Btn>
              {pendingCount > 0 && (
                <Btn
                  variant="accent"
                  onClick={async () => {
                    const ids = demos
                      .filter((d) => d.status === 'pending' || d.status === 'error')
                      .map((d) => d.id)
                    markParsing(ids)
                    try {
                      await window.api.library.parseAll()
                      toast.push(t('library.parseStart'))
                    } catch {
                      toast.push(t('common.error'), 'err')
                    }
                  }}
                >
                  {t('library.parseAll')}（{pendingCount}）
                </Btn>
              )}
              {scanning && (
                <span className="scan-status" role="status" aria-live="polite">
                  <span className="spinner" />
                  {scanning.phase === 'walk'
                    ? t('library.scanning')
                    : `${t('library.scanZips')} ${scanning.done}/${scanning.total}`}
                </span>
              )}
              {parsingCount > 0 && (
                <span className="parse-status" role="status" aria-live="polite">
                  <span className="spinner" />
                  {tf('library.parsingCount', { n: parsingCount })}
                </span>
              )}
              <Btn variant="secondary" onClick={() => window.api.favorites.reveal()}>
                ★ {t('library.favFolder')}
              </Btn>
              <Btn variant="secondary" onClick={() => setSelectMode(true)}>
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
          <div className="empty-actions">
            <Btn variant="accent" className="empty-action-btn" onClick={onAutoDetectRoots}>
              <IcRadar size={15} />
              {t('library.autoDetect')}
            </Btn>
            <Btn variant="secondary" className="empty-action-btn" onClick={onAddRoot}>
              <IcPlus size={14} />
              {t('library.addRoot')}
            </Btn>
            <Btn variant="secondary" className="empty-action-btn" onClick={onRescan}>
              <IcRefresh size={14} />
              {t('library.rescan')}
            </Btn>
          </div>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty
          ghost="NO DEMOS"
          hint={query ? t('common.search') : rootFilter ? tf('library.emptyInRoot', { root: formatRootLabel(rootFilter, lang).title }) : ''}
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
                markParsing([d.id])
                void window.api.library.parse(d.id).catch(() => toast.push(t('common.error'), 'err'))
                toast.push(t('library.parseStart'))
              }}
              onReparse={() => {
                markParsing([d.id])
                void window.api.library
                  .parse(d.id, true)
                  .catch(() => toast.push(t('common.error'), 'err'))
                toast.push(t('library.reparseStart'))
              }}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <span className="muted library-footnote">
          {t('library.mmNoVoice')}
        </span>
      </div>

      {/* 删除确认弹窗 */}
      {removeModal && (
        <div className="modal-overlay" onClick={() => setRemoveModal(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title" id="remove-modal-title">{t('library.removeTitle')}</div>
            <div className="modal-body">
              {t('library.removeBody').replace('{n}', String(removeModal.ids.length))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-choice"
                onClick={() => confirmRemove(removeModal.ids, false)}
              >
                <span className="modal-choice-t">{t('library.removeOnly')}</span>
                <span className="modal-choice-d">{t('library.removeOnlyHint')}</span>
              </button>
              <button
                type="button"
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
  const rawMapName = demo.mapName ?? inferMap(demo.fileName)
  const mapName = rawMapName ? formatMapName(rawMapName) : undefined

  // 点击外部或按 Esc 关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
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
        <button
          type="button"
          className="voice-scan-btn"
          aria-label={t('library.voiceScan')}
          onClick={async (e) => {
            e.stopPropagation()
            const r = await window.api.voice.detect(demo.id)
            toast.push(r.hasVoice ? `VOICE ${r.voiceSec}s` : t('library.noVoice'))
          }}
        >
          {t('library.voiceScan')}
        </button>
      </Tag>
    )
  })()

  return (
    <article
      className={`card ${selected ? 'selected' : ''} ${selectMode ? 'is-selecting' : ''} ${demo.status === 'error' ? 'has-error' : ''}`}
      style={{ ['--i' as string]: index } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={selectMode ? `${selected ? '取消选择' : '选择'} ${demo.fileName}` : `打开 ${demo.fileName} 详情`}
      aria-pressed={selectMode ? selected : undefined}
      onClick={(e) => {
        // Ctrl/⌘ 点击或选择模式 → 切换选中；普通点击 → 打开详情
        if (e.ctrlKey || e.metaKey || selectMode) {
          e.preventDefault()
          onToggleSelect()
        } else {
          onOpen()
        }
      }}
      onKeyDown={(e) => {
        // 内部菜单 / 麦克风 / 播放按钮自行处理键盘，卡片只在自身聚焦时响应。
        if (e.target !== e.currentTarget) return
        activateOnKey(e, () => {
          if (selectMode) onToggleSelect()
          else onOpen()
        })
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
              type="button"
              className="card-menu-btn"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="card-menu" role="menu" aria-label="Demo 操作" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  role="menuitem"
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
                    type="button"
                    role="menuitem"
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
                  type="button"
                  role="menuitem"
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
            <Ring
              pct={Math.max(0.03, Math.min(0.99, progress ?? 0.03))}
              label={progress !== undefined && progress > 0 ? `${Math.round(progress * 100)}%` : '…'}
              indeterminate={progress === undefined || progress <= 0}
            />
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
