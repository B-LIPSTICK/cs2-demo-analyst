import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import type { UpdateProgress } from '@shared/types'

export interface UpdateInfo {
  /** 新版本号（不含 v 前缀） */
  version: string
  /** Release 页面地址 */
  url: string
  /** 便携 zip 下载地址；为空表示这次发布没有可自动安装的资产 */
  assetUrl?: string
  /** Release body 原文（Markdown） */
  notes?: string
  /** 当前运行版本，仅用于展示 */
  currentVersion?: string
}

/**
 * 把 GitHub Release 的 Markdown body 压成可读纯文本。
 * 不引第三方 markdown 渲染器：更新说明只用于阅读，不需要富文本，
 * 而且 release body 里的 HTML 不应该被当成节点解析。
 */
function plainNotes(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    // 图片行整行丢弃（更新说明里贴图对阅读没帮助）
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
    // 分隔线（--- / *** / ___）
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
    // 标题符号、列表符号、引用符号
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    // 行内强调
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // emoji 与装饰符号：界面字体栈里没有这些字形，会渲染成方框（🆕 ⚠️ ✨ 都是这种情况）。
    // 覆盖 emoji 区、杂项符号/装饰符号区，以及变体选择符与零宽连接符；箭头等常用符号保留。
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu,
      ''
    )
    // 去掉因此产生的行首多余空格
    .replace(/^[ \t]+(?=\S)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 启动更新提示。
 * - 直接展示该版本的更新内容（Release body）
 * - 「稍后」时按勾选项处理：一天内不再提示 / 永久跳过该版本
 * - 「前往下载」同样先记住勾选，再打开浏览器
 */
export function UpdateDialog({
  info,
  onClose
}: {
  info: UpdateInfo
  onClose: () => void
}) {
  const t = useT()
  const [snooze, setSnooze] = useState(false)
  const [skip, setSkip] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const notes = useMemo(() => plainNotes(info.notes ?? ''), [info.notes])
  const canAutoUpdate = Boolean(info.assetUrl)

  /** 记住用户的选择（不关窗） */
  const remember = useCallback(() => {
    if (skip) void window.api.update.skip(info.version).catch(() => {})
    else if (snooze) void window.api.update.snooze(24).catch(() => {})
  }, [skip, snooze, info.version])

  const applyAndClose = useCallback(() => {
    remember()
    onClose()
  }, [remember, onClose])

  // Esc 关闭（等同稍后）；更新进行中不响应，避免把正在下载的流程关掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) applyAndClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyAndClose, busy])

  // 下载/解压进度
  useEffect(() => {
    const off = window.api.onEvent('update:progress', (e) => {
      setProgress(e.progress)
      if (e.progress.phase === 'error') {
        setBusy(false)
        setFailed(e.progress.message ?? '')
      }
    })
    return off
  }, [])

  const goDownload = () => {
    remember()
    void window.api.app.openUrl(info.url).catch(() => {})
    onClose()
  }

  const autoUpdate = async () => {
    if (!info.assetUrl || busy) return
    setBusy(true)
    setFailed(null)
    setProgress({ phase: 'download', received: 0, total: 0 })
    // 成功后应用会自行退出并由脚本重启，这里不需要做别的
    const r = await window.api.update.install(info.assetUrl, info.version).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }))
    if (!r.ok) {
      setBusy(false)
      setFailed(r.error ?? '')
    }
  }

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0
  const progressText = (() => {
    if (!progress) return ''
    switch (progress.phase) {
      case 'download':
        if (progress.total > 0) {
          const mb = (progress.received / 1024 / 1024).toFixed(1)
          const all = (progress.total / 1024 / 1024).toFixed(1)
          return t.t('update.downloading').replace('{pct}', String(pct)).replace('{got}', mb).replace('{all}', all)
        }
        return t.t('update.downloadingUnknown')
      case 'extract':
        return t.t('update.extracting')
      case 'verify':
        return t.t('update.verifying')
      case 'ready':
        return t.t('update.restarting')
      default:
        return ''
    }
  })()

  return createPortal(
    <div className="modal-overlay" onClick={() => (busy ? undefined : applyAndClose())}>
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{t.t('update.dialogTitle').replace('{ver}', info.version)}</div>
        {info.currentVersion && (
          <div className="modal-note update-meta">
            {t.t('update.currentVersion').replace('{ver}', info.currentVersion)}
          </div>
        )}
        <div className="update-notes">{notes || t.t('update.noNotes')}</div>

        {busy && progress && (
          <div className="update-progress">
            <div className="update-bar">
              <div className="update-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="update-progress-text">{progressText}</div>
          </div>
        )}
        {!busy && failed && (
          <div className="update-progress-text error">
            {t.t('update.installFailed').replace('{msg}', failed)}
          </div>
        )}

        <div className="update-checks">
          <label className="update-check">
            <input
              type="checkbox"
              checked={skip}
              disabled={busy}
              onChange={(e) => setSkip(e.target.checked)}
            />
            <span>{t.t('update.skipVersion')}</span>
          </label>
          <label className="update-check">
            <input
              type="checkbox"
              checked={snooze}
              disabled={skip || busy}
              onChange={(e) => setSnooze(e.target.checked)}
            />
            <span>{t.t('update.snoozeOneDay')}</span>
          </label>
        </div>
        <div className="update-actions">
          <button className="btn ghost" onClick={applyAndClose} disabled={busy}>
            {t.t('update.later')}
          </button>
          <button className="btn ghost" onClick={goDownload} disabled={busy}>
            {t.t('update.go')}
          </button>
          <button
            className="btn primary"
            onClick={() => void autoUpdate()}
            disabled={busy || !canAutoUpdate}
            title={canAutoUpdate ? undefined : t.t('update.noAsset')}
          >
            {busy ? t.t('update.updating') : t.t('update.installNow')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
