import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'

export interface UpdateInfo {
  /** 新版本号（不含 v 前缀） */
  version: string
  /** Release 页面地址 */
  url: string
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
  const notes = useMemo(() => plainNotes(info.notes ?? ''), [info.notes])

  /** 记住用户的选择（不关窗） */
  const remember = useCallback(() => {
    if (skip) void window.api.update.skip(info.version).catch(() => {})
    else if (snooze) void window.api.update.snooze(24).catch(() => {})
  }, [skip, snooze, info.version])

  const applyAndClose = useCallback(() => {
    remember()
    onClose()
  }, [remember, onClose])

  // Esc 关闭（等同稍后）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') applyAndClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyAndClose])

  const goDownload = () => {
    remember()
    void window.api.app.openUrl(info.url).catch(() => {})
    onClose()
  }

  return createPortal(
    <div className="modal-overlay" onClick={applyAndClose}>
      <div className="modal update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{t.t('update.dialogTitle').replace('{ver}', info.version)}</div>
        {info.currentVersion && (
          <div className="modal-note update-meta">
            {t.t('update.currentVersion').replace('{ver}', info.currentVersion)}
          </div>
        )}
        <div className="update-notes">{notes || t.t('update.noNotes')}</div>
        <div className="update-checks">
          <label className="update-check">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            <span>{t.t('update.skipVersion')}</span>
          </label>
          <label className="update-check">
            <input
              type="checkbox"
              checked={snooze}
              disabled={skip}
              onChange={(e) => setSnooze(e.target.checked)}
            />
            <span>{t.t('update.snoozeOneDay')}</span>
          </label>
        </div>
        <div className="update-actions">
          <button className="btn ghost" onClick={applyAndClose}>
            {t.t('update.later')}
          </button>
          <button className="btn primary" onClick={goDownload}>
            {t.t('update.go')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
