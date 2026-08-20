import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Btn, IcSend, IcSpark, IcStop, Panel, Tag, useToast } from '@/components/ui'
import { useTKey } from '@/i18n'
import type { DemoDetail, DemoMeta, RoundInfo } from '@shared/types'

interface Msg {
  id: number
  role: 'user' | 'ai'
  text: string
  done: boolean
  error?: boolean
}

const QUICK_KEYS = ['ai.q1', 'ai.q2', 'ai.q3', 'ai.q4'] as const

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

/** Markdown-lite 行渲染（标题/列表/斜体注记/普通段） */
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

export function AiPage({ onGoSettings }: { onGoSettings: () => void }) {
  const t = useTKey()
  const toast = useToast()
  const [demos, setDemos] = useState<DemoMeta[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<DemoDetail | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const askingId = useRef('')

  useEffect(() => {
    window.api.library.list().then((list) => {
      setDemos(list)
      if (list.length > 0) {
        const withVoice = list.find((d) => d.hasVoice === true || d.hasVoice == null)
        setSelectedId((withVoice ?? list[0]).id)
      }
    })
    window.api.settings.get().then((s) => setHasKey(Boolean(s.ai?.apiKey)))
  }, [])

  // 选中 demo → 拉详情（用于 R# → tick 映射）
  useEffect(() => {
    if (!selectedId) return
    window.api.library.detail(selectedId).then(setDetail).catch(() => setDetail(null))
  }, [selectedId])

  // AI 流式事件
  useEffect(() => {
    const offDelta = window.api.onEvent('ai:delta', (e) => {
      if (e.demoId !== selectedId) return
      setMessages((ms) => {
        const last = ms[ms.length - 1]
        if (last && last.role === 'ai' && !last.done && !last.error) {
          return [...ms.slice(0, -1), { ...last, text: last.text + e.chunk }]
        }
        return ms
      })
    })
    const offDone = window.api.onEvent('ai:done', (e) => {
      if (e.demoId !== selectedId) return
      setAsking(false)
      setMessages((ms) => {
        const last = ms[ms.length - 1]
        if (last && last.role === 'ai') {
          return [...ms.slice(0, -1), { ...last, text: e.answer || last.text, done: true }]
        }
        return [...ms, { id: Date.now(), role: 'ai', text: e.answer, done: true }]
      })
    })
    const offError = window.api.onEvent('ai:error', (e) => {
      if (e.demoId !== selectedId) return
      setAsking(false)
      setMessages((ms) => {
        const last = ms[ms.length - 1]
        if (last && last.role === 'ai') {
          return [...ms.slice(0, -1), { ...last, text: e.error, done: true, error: true }]
        }
        return [...ms, { id: Date.now(), role: 'ai', text: e.error, done: true, error: true }]
      })
    })
    return () => {
      offDelta()
      offDone()
      offError()
    }
  }, [selectedId])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const rounds = detail?.rounds ?? []
  const rate = detail?.meta.tickRate ?? 64

  const jump = (tick: number) => {
    window.api.live.jumpTick(tick).then((ok) => {
      if (!ok) toast.push(t('common.notimpl'), 'warn')
    })
  }

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || asking || !selectedId) return
    const userMsg: Msg = { id: Date.now(), role: 'user', text: question, done: true }
    const aiMsg: Msg = { id: Date.now() + 1, role: 'ai', text: '', done: false }
    setMessages((ms) => [...ms, userMsg, aiMsg])
    setInput('')
    setAsking(true)
    askingId.current = selectedId
    const res = await window.api.ai.ask(selectedId, question)
    if (!res.started) {
      setAsking(false)
      setMessages((ms) => [
        ...ms.slice(0, -1),
        { ...aiMsg, text: res.error ?? 'failed', done: true, error: true }
      ])
    }
  }

  const quickQs = QUICK_KEYS.map((k) => t(k))
  const sampleDemo = useMemo(() => demos.find((d) => d.id === selectedId), [demos, selectedId])

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-head">
        <div>
          <div className="title">
            {t('ai.title')}
          </div>
          <div className="sub">{t('ai.subtitle')}</div>
        </div>
        <div className="actions">
          <select
            className="input select"
            style={{ minWidth: 260 }}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {demos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName}
                {d.hasVoice === true ? ' · VOICE' : ''}
              </option>
            ))}
          </select>
          {!hasKey && (
            <Btn variant="ghost" size="sm" onClick={onGoSettings}>
              {t('ai.configureKey')} →
            </Btn>
          )}
        </div>
      </div>

      <Panel className="ai-panel grow" raised>
        {messages.length === 0 ? (
          <div className="ai-empty">
            <div className="ai-empty-ic">
              <IcSpark size={30} />
            </div>
            <div className="ai-empty-title">{t('ai.emptyTitle')}</div>
            <div className="ai-empty-sub">{t('ai.emptySub')}</div>
            <div className="ai-quick">
              {quickQs.map((q, i) => (
                <button key={i} className="ai-quick-chip" onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
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
                      {!m.done && <span className="ai-cursor" />}
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

      <div className="flex" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <Tag tone="ghost">{t('ai.tag1')}</Tag>
        <Tag tone="ghost">{t('ai.tag2')}</Tag>
        {sampleDemo?.hasVoice === true && <Tag tone="voice" dot>{t('ai.tagVoice')}</Tag>}
      </div>
    </div>
  )
}
