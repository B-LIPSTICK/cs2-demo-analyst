import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Btn, CustomSelect, IcPlus, IcSend, IcSpark, IcStop, Panel, Tag, useToast } from '@/components/ui'
import { useTKey } from '@/i18n'
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
      out.push(
        <button key={`t${i++}`} className="time-chip" onClick={() => onJump(Math.round(sec * rate))}>
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

function newSession(demoId: string, mapName?: string): AiChatSession {
  const now = Date.now()
  const time = fmtSessionTime(now)
  const prefix = mapName ? `${mapName} · ` : ''
  return {
    id: `chat-${now}-${Math.floor(Math.random() * 1e6)}`,
    title: `${prefix}对话 ${time}`,
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
  const scrollRef = useRef<HTMLDivElement>(null)

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
          const s = newSession('')
          setSessions([s])
          setCurrentId(s.id)
        }
      })
      .catch(() => {
        const s = newSession('')
        setSessions([s])
        setCurrentId(s.id)
      })
  }, [])

  // 选中 demo → 拉详情（R# → tick 映射），并同步当前会话 demoId
  useEffect(() => {
    if (!selectedId) return
    window.api.library.detail(selectedId).then(setDetail).catch(() => setDetail(null))
    setSessions((ss) => ss.map((s) => (s.id === currentId ? { ...s, demoId: selectedId } : s)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  /** 保存当前会话（持久化记忆） */
  const persistCurrent = (next: AiChatSession) => {
    setSessions((ss) => ss.map((s) => (s.id === next.id ? next : s)))
    window.api.ai.saveChat(next).catch(() => {})
  }

  // AI 流式事件
  useEffect(() => {
    const offDelta = window.api.onEvent('ai:delta', (e) => {
      if (e.demoId !== selectedId) return
      setSessions((ss) =>
        ss.map((s) => {
          if (s.id !== currentId || s.messages.length === 0) return s
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last.role !== 'assistant') return s
          msgs[msgs.length - 1] = { ...last, text: last.text + e.chunk }
          return { ...s, messages: msgs }
        })
      )
    })
    const finish = (answer: string) => {
      setAsking(false)
      setSessions((ss) => {
        const s = ss.find((x) => x.id === currentId)
        if (!s) return ss
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last.role === 'assistant') msgs[msgs.length - 1] = { ...last, text: answer || last.text }
        else msgs.push({ role: 'assistant', text: answer })
        const next = { ...s, messages: msgs, updatedAt: Date.now() }
        window.api.ai.saveChat(next).catch(() => {})
        return ss.map((x) => (x.id === next.id ? next : x))
      })
    }
    const offDone = window.api.onEvent('ai:done', (e) => {
      if (e.demoId !== selectedId) return
      finish(e.answer)
    })
    const offError = window.api.onEvent('ai:error', (e) => {
      if (e.demoId !== selectedId) return
      finish(e.error)
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, currentId])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const rounds = detail?.rounds ?? []
  const rate = detail?.meta.tickRate ?? 64

  const jump = async (tick: number) => {
    const cmd = `demo_gototick ${tick}`
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
      const voiceHud = !!s.cs2?.voiceHud
      if (voiceHud) toast.push(t('detail.voiceHudPreparing'))
      const r = await window.api.live.launch({
        playDemoPath: detail.meta.path,
        voiceHud,
        startTick: tick
      })
      if (r.ok) {
        toast.push(t('common.jumpLaunched').replace('{tick}', String(tick)))
        return
      }
    }
    toast.push(t('common.jumpCopied').replace('{cmd}', cmd))
  }

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || asking || !selectedId || !current) return
    const isAutoTitle =
      current.title === '新对话' ||
      current.title.startsWith('对话 ') ||
      current.title.includes(' · 对话') ||
      current.title.includes(' · 20')
    const title = isAutoTitle ? (question.length > 18 ? question.slice(0, 18) + '…' : question) : current.title
    const next: AiChatSession = {
      ...current,
      title,
      demoId: selectedId,
      messages: [...current.messages, { role: 'user', text: question }, { role: 'assistant', text: '' }]
    }
    persistCurrent(next)
    setInput('')
    setAsking(true)
    const history = next.messages.slice(0, -2) // 历史（不含刚加的问题与空回答）
    const res = await window.api.ai.ask(selectedId, question, history)
    if (!res.started) {
      setAsking(false)
      setSessions((ss) => {
        const s = ss.find((x) => x.id === currentId)
        if (!s) return ss
        const msgs = [...s.messages]
        msgs[msgs.length - 1] = { role: 'assistant', text: res.error ?? 'failed' }
        const done = { ...s, messages: msgs, updatedAt: Date.now() }
        window.api.ai.saveChat(done).catch(() => {})
        return ss.map((x) => (x.id === done.id ? done : x))
      })
    }
  }

  const newChat = () => {
    if (asking) return
    const curDemo = demos.find((d) => d.id === selectedId)
    const s = newSession(selectedId, curDemo?.mapName)
    setSessions((ss) => [s, ...ss])
    setCurrentId(s.id)
  }

  const deleteChat = () => {
    if (!current || asking) return
    if (!window.confirm(t('ai.deleteChatConfirm'))) return
    window.api.ai.removeChat(current.id).catch(() => {})
    setSessions((ss) => {
      const rest = ss.filter((s) => s.id !== current.id)
      if (rest.length === 0) {
        const curDemo = demos.find((d) => d.id === selectedId)
        const s = newSession(selectedId, curDemo?.mapName)
        setCurrentId(s.id)
        return [s]
      }
      setCurrentId(rest[0].id)
      return rest
    })
  }

  const sampleDemo = useMemo(() => demos.find((d) => d.id === selectedId), [demos, selectedId])

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                  sublabel: targetDemo?.mapName ? `${targetDemo.mapName} · ${timeStr}` : timeStr
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
                label: d.mapName ? `${d.mapName} · ${d.fileName}` : d.fileName,
                sublabel: d.hasVoice === true ? '含语音' : undefined
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
                      {asking && m.id === messages.length - 1 && m.text.length > 0 && (
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
    </div>
  )
}
