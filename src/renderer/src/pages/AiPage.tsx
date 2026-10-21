import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn, CustomSelect, IcPlus, IcSend, IcSpark, IcStop, Panel, Tag, useToast } from '@/components/ui'
import { useTKey } from '@/i18n'
import { formatMapName } from '@/utils/format'
import { computeVoiceMask } from './DemoDetailPage'
import type { AiChatSession, DemoDetail, DemoMeta, RoundInfo } from '@shared/types'

interface Msg {
  id: number
  role: 'user' | 'ai'
  text: string
  done: boolean
  error?: boolean
}

const PROMPT_CARDS = [
  { titleKey: 'ai.card1Title', descKey: 'ai.card1Desc', qKey: 'ai.q1' },
  { titleKey: 'ai.card2Title', descKey: 'ai.card2Desc', qKey: 'ai.q2' },
  { titleKey: 'ai.card3Title', descKey: 'ai.card3Desc', qKey: 'ai.q3' },
  { titleKey: 'ai.card4Title', descKey: 'ai.card4Desc', qKey: 'ai.q4' }
] as const

/** 行内渲染：**加粗**、[mm:ss] 与 R# 转可点击跳转 chip */
function renderInline(
  text: string,
  onJump: (tick: number) => void,
  rounds: RoundInfo[],
  rate: number
): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\[(\d{1,2}):(\d{2})\]|R(\d{1,2})\b|\*\*([^*]+)\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    const mm: RegExpExecArray = m
    if (mm.index > last) out.push(text.slice(last, mm.index))
    if (mm[2] !== undefined) {
      const sec = Number(mm[2]) * 60 + Number(mm[3])
      const jumpTick = Math.max(0, Math.round(sec * rate) - Math.round(rate * 4))
      out.push(
        <button key={`t${i++}`} className="time-chip" onClick={() => onJump(jumpTick)}>
          {mm[1]}
        </button>
      )
    } else if (mm[4] !== undefined) {
      const r = rounds.find((x) => x.roundNum === Number(mm[4]))
      out.push(
        <button
          key={`r${i++}`}
          className="time-chip round"
          disabled={!r}
          onClick={() => r && onJump(r.startTick)}
        >
          {mm[0]}
        </button>
      )
    } else if (mm[5] !== undefined) {
      out.push(<b key={`b${i++}`}>{mm[5]}</b>)
    }
    last = mm.index + mm[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Markdown-lite 行渲染 */
function renderBlock(
  text: string,
  onJump: (tick: number) => void,
  rounds: RoundInfo[],
  rate: number
): ReactNode {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={idx} style={{ height: 8 }} />
        if (trimmed.startsWith('## '))
          return (
            <div key={idx} className="ai-h2">
              {renderInline(trimmed.slice(3), onJump, rounds, rate)}
            </div>
          )
        if (trimmed.startsWith('### '))
          return (
            <div key={idx} className="ai-h3">
              {renderInline(trimmed.slice(4), onJump, rounds, rate)}
            </div>
          )
        if (trimmed.startsWith('- '))
          return (
            <div key={idx} className="ai-li">
              <span className="ai-dot" />
              <span>{renderInline(trimmed.slice(2), onJump, rounds, rate)}</span>
            </div>
          )
        if (trimmed.startsWith('_') && trimmed.endsWith('_') && trimmed.length > 2)
          return (
            <div key={idx} className="ai-note">
              {renderInline(trimmed.slice(1, -1), onJump, rounds, rate)}
            </div>
          )
        return (
          <div key={idx} className="ai-p">
            {renderInline(trimmed, onJump, rounds, rate)}
          </div>
        )
      })}
    </>
  )
}

export function fmtSessionTime(ts: number = Date.now()): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 单次 AI 请求 id：用于把流式事件绑定到发起请求的会话，切换会话后旧事件不会串台 */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function newSession(demoId: string, mapName: string | undefined, chatLabel: string): AiChatSession {
  const now = Date.now()
  const time = fmtSessionTime(now)
  const prefix = mapName ? `${formatMapName(mapName)} · ` : ''
  return {
    id: `chat-${now}-${Math.floor(Math.random() * 1e6)}`,
    title: `${prefix}${chatLabel} ${time}`,
    demoId,
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}



export function AiPage({ onGoSettings }: { onGoSettings: () => void }) {
  const t = useTKey()
  const toast = useToast()
  const [demos, setDemos] = useState<DemoMeta[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<DemoDetail | null>(null)
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [currentId, setCurrentId] = useState('')
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 当前进行中的请求：事件必须同时匹配 requestId/sessionId/demoId 才写入会话
  const activeRequestRef = useRef<{ requestId: string; sessionId: string; demoId: string } | null>(null)

  const current = sessions.find((s) => s.id === currentId) ?? null
  const messages: Msg[] = useMemo(
    () =>
      (current?.messages ?? []).map((m, i) => ({
        id: i,
        role: m.role === 'user' ? 'user' : 'ai',
        text: m.text,
        done: true
      })),
    [current]
  )

  useEffect(() => {
    window.api.library.list().then((list) => {
      setDemos(list)
      if (list.length > 0) {
        const withVoice = list.find((d) => d.hasVoice === true || d.hasVoice == null)
        setSelectedId((withVoice ?? list[0]).id)
      }
    })
    window.api.settings.get().then((s) => setHasKey(Boolean(s.ai?.apiKey)))
    // 载入历史会话（记忆切换）
    window.api.ai
      .listChats()
      .then((chats) => {
        if (chats.length > 0) {
          setSessions(chats)
          setCurrentId(chats[0].id)
        } else {
          const s = newSession('', undefined, t('ai.chatTitlePrefix'))
          setSessions([s])
          setCurrentId(s.id)
        }
      })
      .catch(() => {
        const s = newSession('', undefined, t('ai.chatTitlePrefix'))
        setSessions([s])
        setCurrentId(s.id)
      })
  }, [])

  // 选中 demo → 拉详情（R# → tick 映射），并同步当前会话 demoId
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    // 先清掉旧 demo 的详情，避免新 detail 到达前 R# 仍按上一场映射
    setDetail(null)
    let alive = true
    window.api.library
      .detail(selectedId)
      .then((d) => {
        if (alive) setDetail(d)
      })
      .catch(() => {
        if (alive) setDetail(null)
      })
    setSessions((ss) => ss.map((s) => (s.id === currentId ? { ...s, demoId: selectedId } : s)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 切换会话 → 按该会话的 demoId 同步 selectedId 与详情，保证 R# 跳转使用正确 demo。
  // 空 demoId 的新会话沿用当前选择并补绑定，避免首次启动时把默认 demo 清空。
  useEffect(() => {
    if (!currentId) return
    const session = sessions.find((s) => s.id === currentId)
    if (!session) return
    const targetDemoId = session.demoId
    if (!targetDemoId) {
      if (selectedId) {
        setSessions((ss) => ss.map((s) => (s.id === currentId ? { ...s, demoId: selectedId } : s)))
      }
      return
    }
    if (targetDemoId !== selectedId) {
      // selectedId 变化后由上面的 effect 统一拉详情
      setSelectedId(targetDemoId)
      return
    }
    let alive = true
    window.api.library
      .detail(targetDemoId)
      .then((d) => {
        if (alive) setDetail(d)
      })
      .catch(() => {
        if (alive) setDetail(null)
      })
    return () => {
      alive = false
    }
    // 只响应会话切换；selectedId 由上面 effect 单向写入，避免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  /** 保存当前会话（持久化记忆） */
  const persistCurrent = (next: AiChatSession) => {
    setSessions((ss) => ss.map((s) => (s.id === next.id ? next : s)))
    window.api.ai.saveChat(next).catch(() => {})
  }

  /** 终止一次请求：只写回发起它的会话，并持久化；错误时保留已收到的部分文本 */
  const finishRequest = useCallback(
    (request: { requestId: string; sessionId: string; demoId: string }, answer: string, error?: string) => {
      const active = activeRequestRef.current
      if (!active || active.requestId !== request.requestId || active.sessionId !== request.sessionId) return
      activeRequestRef.current = null
      setAsking(false)
      setSessions((ss) => {
        const s = ss.find((x) => x.id === request.sessionId)
        if (!s) return ss
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        const base = last?.role === 'assistant' ? last.text : ''
        const text = error ? (base ? `${base}\n\n⚠️ ${error}` : error) : answer || base
        if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, text }
        else msgs.push({ role: 'assistant', text })
        const next = { ...s, messages: msgs, updatedAt: Date.now() }
        window.api.ai.saveChat(next).catch(() => {})
        return ss.map((x) => (x.id === next.id ? next : x))
      })
    },
    []
  )

  // AI 流式事件：requestId/sessionId/demoId 三重匹配，切换会话后旧流不会写进新会话
  useEffect(() => {
    const activeFor = (e: { demoId: string; sessionId?: string; requestId: string }) => {
      const active = activeRequestRef.current
      if (!active) return null
      if (e.requestId !== active.requestId) return null
      if (e.sessionId && e.sessionId !== active.sessionId) return null
      if (e.demoId !== active.demoId) return null
      return active
    }
    const offDelta = window.api.onEvent('ai:delta', (e) => {
      const active = activeFor(e)
      if (!active) return
      setSessions((ss) =>
        ss.map((s) => {
          if (s.id !== active.sessionId) return s
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role !== 'assistant') return s
          msgs[msgs.length - 1] = { ...last, text: last.text + e.chunk }
          return { ...s, messages: msgs }
        })
      )
    })
    const offDone = window.api.onEvent('ai:done', (e) => {
      const active = activeFor(e)
      if (active) finishRequest(active, e.answer)
    })
    const offError = window.api.onEvent('ai:error', (e) => {
      const active = activeFor(e)
      if (active) finishRequest(active, '', e.error)
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [finishRequest])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const rounds = detail?.rounds ?? []
  const rate = detail?.meta.tickRate ?? 64
  // 只有当前会话仍是请求发起方时才显示流式光标，切换会话后不串流
  const askingCurrent = asking && activeRequestRef.current?.sessionId === currentId

  const jump = async (tick: number) => {
    const targetTick = Math.max(0, Math.round(tick))
    const jumped = await window.api.live.jumpTick(targetTick).catch(() => false)
    if (jumped) {
      toast.push(t('common.jumpDirectSuccess').replace('{tick}', String(targetTick)))
      return
    }
    const cmd = `demo_gototick ${targetTick}`
    try {
      await navigator.clipboard.writeText(cmd)
    } catch {
      /* ignore */
    }
    const status = await window.api.live.getStatus().catch(() => null)
    if (status?.cs2Running) {
      toast.push(t('common.jumpCopiedRunning').replace('{cmd}', cmd))
      return
    }
    if (detail?.meta.path) {
      const s = await window.api.settings.get()
      const hudMode = s.cs2?.hudMode ?? 'addon'
      if (hudMode !== 'off') toast.push(t('detail.voiceHudPreparing'))
      // 与详情页一致：按静音名单计算 GOTV 语音位掩码，保证各入口启动行为统一
      const voiceIndices = computeVoiceMask(
        detail.meta.players ?? [],
        new Set(s.overlay?.mutedPlayers ?? [])
      )
      const r = await window.api.live.launch({
        playDemoPath: detail.meta.path,
        hudMode,
        startTick: targetTick,
        tvVoiceIndices: { low: voiceIndices.low, high: voiceIndices.high }
      })
      if (r.ok) {
        toast.push(t('common.jumpLaunched').replace('{tick}', String(targetTick)))
        return
      }
    }
    toast.push(t('common.jumpCopied').replace('{cmd}', cmd))
  }

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || asking || !selectedId || !current) return
    const sessionId = current.id
    const requestId = newRequestId()
    const active = { requestId, sessionId, demoId: selectedId }
    // 兼容历史会话标题（中文/英文）以及带时间戳的自动标题
    const isAutoTitle =
      ['新对话', '对话', 'Chat'].some(
        (label) =>
          current.title === label ||
          current.title.startsWith(`${label} `) ||
          current.title.includes(` · ${label}`)
      ) || current.title.includes(' · 20')
    const title = isAutoTitle ? (question.length > 18 ? question.slice(0, 18) + '…' : question) : current.title
    const next: AiChatSession = {
      ...current,
      title,
      demoId: selectedId,
      messages: [...current.messages, { role: 'user', text: question }, { role: 'assistant', text: '' }]
    }
    activeRequestRef.current = active
    persistCurrent(next)
    setInput('')
    setAsking(true)
    const history = next.messages.slice(0, -2) // 历史（不含刚加的问题与空回答）
    try {
      const res = await window.api.ai.ask(selectedId, question, history, sessionId, requestId)
      if (!res.started) {
        finishRequest(active, '', res.error ?? t('common.error'))
      }
    } catch (err) {
      // IPC reject / 主进程异常：立即把错误写回发起会话，并复位 asking
      finishRequest(active, '', err instanceof Error ? err.message : String(err))
    } finally {
      // 正常结束/异常都确保按钮复位；若 done/error 事件稍后到达，仍可通过 activeRequestRef 匹配
      if (activeRequestRef.current?.requestId === requestId) setAsking(false)
    }
  }

  const newChat = () => {
    if (asking) return
    const curDemo = demos.find((d) => d.id === selectedId)
    const s = newSession(selectedId, curDemo?.mapName, t('ai.chatTitlePrefix'))
    setSessions((ss) => [s, ...ss])
    setCurrentId(s.id)
  }

  const deleteChat = () => {
    if (!current || asking) return
    setDeleteOpen(true)
  }

  const confirmDeleteChat = () => {
    setDeleteOpen(false)
    if (!current || asking) return
    window.api.ai.removeChat(current.id).catch(() => {})
    setSessions((ss) => {
      const rest = ss.filter((s) => s.id !== current.id)
      if (rest.length === 0) {
        const curDemo = demos.find((d) => d.id === selectedId)
        const s = newSession(selectedId, curDemo?.mapName, t('ai.chatTitlePrefix'))
        setCurrentId(s.id)
        return [s]
      }
      setCurrentId(rest[0].id)
      return rest
    })
  }

  const sampleDemo = useMemo(() => demos.find((d) => d.id === selectedId), [demos, selectedId])

  return (
    <div className="page ai-page">
      <div className="page-head">
        <div>
          <div className="title">
            {t('ai.title')}
          </div>
        </div>
        <div className="actions ai-actions">
          {/* 会话组 */}
          <div className="ai-group">
            <CustomSelect
              width={210}
              value={currentId}
              placeholder={t('ai.title')}
              options={sessions.map((s) => {
                const targetDemo = demos.find((d) => d.id === s.demoId)
                const timeStr = fmtSessionTime(s.updatedAt || s.createdAt)
                return {
                  value: s.id,
                  label: s.title,
                  sublabel: targetDemo?.mapName ? `${formatMapName(targetDemo.mapName)} · ${timeStr}` : timeStr
                }
              })}
              onChange={(v) => setCurrentId(v)}
            />
            <Btn variant="ghost" size="sm" onClick={newChat} title={t('ai.newChat')}>
              <IcPlus size={12} />
              {t('ai.newChat')}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={deleteChat} title={t('ai.deleteChat')}>
              {t('ai.deleteChat')}
            </Btn>
          </div>
          <div className="ai-group-sep" />
          {/* Demo 组 */}
          <div className="ai-group">
            <CustomSelect
              width={240}
              value={selectedId}
              placeholder={t('ai.selectDemo')}
              options={demos.map((d) => ({
                value: d.id,
                label: d.mapName ? `${formatMapName(d.mapName)} · ${d.fileName}` : d.fileName,
                sublabel: d.hasVoice === true ? t('ai.hasVoice') : undefined
              }))}
              onChange={(v) => setSelectedId(v)}
            />
            {sampleDemo && (
              <Tag tone={sampleDemo.hasVoice ? 'voice' : 'ghost'} dot={Boolean(sampleDemo.hasVoice)}>
                {sampleDemo.hasVoice ? t('ai.voiceYes') : t('ai.voiceNo')}
              </Tag>
            )}
            {!hasKey && (
              <Btn variant="ghost" size="sm" onClick={onGoSettings}>
                {t('ai.configureKey')} →
              </Btn>
            )}
          </div>
        </div>
      </div>

      <Panel className="ai-panel grow" raised>
        {messages.length === 0 ? (
          <div className="ai-empty">
            <div className="ai-prompt-grid">
              {PROMPT_CARDS.map((card, i) => {
                const question = t(card.qKey as never)
                return (
                  <div key={i} className="ai-prompt-card" onClick={() => ask(question)}>
                    <div className="ai-prompt-card-head">
                      <span className="ai-prompt-card-title">{t(card.titleKey as never)}</span>
                      <span className="ai-prompt-card-arrow">→</span>
                    </div>
                    <div className="ai-prompt-card-desc">{t(card.descKey as never)}</div>
                    <div className="ai-prompt-card-q">{question}</div>
                  </div>
                )
              })}
            </div>
            {!hasKey && (
              <div className="ai-key-hint" onClick={onGoSettings}>
                {t('ai.keyHint')} →
              </div>
            )}
          </div>
        ) : (
          <div className="ai-chat" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={`ai-msg ${m.role}`}>
                <div className="ai-msg-tag">
                  {m.role === 'user' ? t('ai.you') : <IcSpark size={11} />}
                </div>
                <div className={`ai-bubble ${m.error ? 'error' : ''}`}>
                  {m.role === 'user' ? (
                    m.text
                  ) : (
                    <>
                      {renderBlock(m.text, jump, rounds, rate)}
                      {askingCurrent && m.id === messages.length - 1 && m.text.length > 0 && (
                        <span className="ai-cursor" />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="ai-input-row">
          <input
            className="input grow"
            placeholder={t('ai.placeholder')}
            value={input}
            disabled={asking}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask(input)}
          />
          {asking ? (
            <Btn variant="danger" onClick={() => window.api.ai.cancel()}>
              <IcStop size={13} />
              {t('ai.stop')}
            </Btn>
          ) : (
            <Btn variant="primary" disabled={!selectedId} onClick={() => ask(input)}>
              <IcSend size={13} />
              {t('ai.send')}
            </Btn>
          )}
        </div>
      </Panel>

      {/* 删除会话确认：应用内 Modal（createPortal 到 body，避免 .page 的 transform 影响 fixed 定位） */}
      {deleteOpen &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16
            }}
            onClick={() => setDeleteOpen(false)}
          >
            <div
              style={{
                width: 420,
                maxWidth: '92vw',
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
                borderRadius: 14,
                padding: 22,
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                {t('ai.deleteChatTitle')}
              </div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                {t('ai.deleteChatConfirm')}
              </div>
              <div className="flex" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                <Btn variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
                  {t('common.cancel')}
                </Btn>
                <Btn variant="danger" size="sm" onClick={confirmDeleteChat}>
                  {t('common.delete')}
                </Btn>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
