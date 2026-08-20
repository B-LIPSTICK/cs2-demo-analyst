/**
 * AI 分析服务：把 demo 解析数据组装成上下文，调用 OpenAI 兼容 chat/completions
 * 流式返回；无 Key 或网络失败时给出可读错误；--ai-mock 模式本地生成回答（开发验证）。
 */
import type { ChatMessage, DemoDetail, KillEvent, VoiceSegment } from '@shared/types'

export interface AiCallbacks {
  delta: (demoId: string, chunk: string) => void
  done: (demoId: string, answer: string) => void
  error: (demoId: string, err: string) => void
}

const MAX_VOICE_LINES = 250

function fmtClock(tick: number, rate: number): string {
  const s = Math.floor(tick / rate)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 把 demo 数据压缩成给 LLM 的上下文文本（时间统一 mm:ss + R回合，便于引用） */
export function buildContext(d: DemoDetail): string {
  const rate = d.meta.tickRate ?? 64
  const lines: string[] = []
  lines.push(`# Demo 概览`)
  lines.push(
    `地图 ${d.meta.mapName ?? '未知'} · 比分 ${d.meta.teamT ?? 'T'} ${d.meta.scoreT ?? 0} : ${d.meta.scoreCT ?? 0} ${d.meta.teamCT ?? 'CT'} · ${d.meta.roundCount ?? 0} 回合 · 时长 ${Math.round((d.meta.durationSec ?? 0) / 60)} 分钟 · 语音转写 ${d.voice.length} 段 · 聊天 ${d.chat.length} 条`
  )
  lines.push('')
  lines.push(`# 选手数据（姓名 阵营 K-D 爆头率 MVP）`)
  for (const p of d.meta.players ?? []) {
    lines.push(`${p.name} ${p.team} ${p.kills}-${p.deaths} ${p.hsp}% MVP${p.mvp}`)
  }
  lines.push('')
  lines.push(`# 回合时间线`)
  for (const r of d.rounds) {
    const endLabel =
      r.endType === 'bomb_exploded'
        ? '爆炸'
        : r.endType === 'bomb_defused'
          ? '拆除'
          : r.endType === 'elimination'
            ? '全灭'
            : r.endType === 'timeout'
              ? '超时'
              : '结束'
    const extras: string[] = []
    if (r.bombPlantedTick) extras.push(`安放 ${fmtClock(r.bombPlantedTick, rate)}`)
    if (r.bombDefusedTick) extras.push(`拆除 ${fmtClock(r.bombDefusedTick, rate)}`)
    if (r.bombExplodedTick) extras.push(`爆炸 ${fmtClock(r.bombExplodedTick, rate)}`)
    lines.push(`R${r.roundNum} ${r.winner === 'T' ? 'T胜' : r.winner === 'CT' ? 'CT胜' : '无'}(${endLabel}) ${r.kills.length}击杀${extras.length ? ' ' + extras.join(' ') : ''}`)
  }
  lines.push('')
  lines.push(`# 击杀记录（时间 R回合 攻击者 -武器-> 受害者 爆头）`)
  const kills: KillEvent[] = d.rounds.flatMap((r) => r.kills).sort((a, b) => a.tick - b.tick)
  for (const k of kills) {
    lines.push(
      `[${fmtClock(k.tick, rate)}] R${k.roundNum} ${k.attackerName ?? '?'} -${k.weapon}-> ${k.victimName ?? '?'}${k.headshot ? ' HS' : ''}${k.throughSmoke ? ' 穿烟' : ''}`
    )
  }
  lines.push('')
  lines.push(`# 语音转写（时间 R回合 玩家: 文本；[BLANK_AUDIO] 为空音频已剔除）`)
  const voices: VoiceSegment[] = d.voice
    .filter((v) => v.text && v.text !== '[BLANK_AUDIO]')
    .sort((a, b) => a.tick - b.tick)
    .slice(0, MAX_VOICE_LINES)
  if (voices.length === 0) lines.push('（无有效转写文本）')
  for (const v of voices) {
    lines.push(`[${fmtClock(v.tick, rate)}] R${v.roundNum ?? '?'} ${v.playerName}: ${v.text}`)
  }
  lines.push('')
  lines.push(`# 文字聊天（时间 R回合 频道 玩家: 文本）`)
  const chats: ChatMessage[] = [...d.chat].sort((a, b) => a.tick - b.tick)
  if (chats.length === 0) lines.push('（无聊天记录）')
  for (const c of chats) {
    lines.push(`[${fmtClock(c.tick, rate)}] R${c.roundNum} (${c.channel}) ${c.playerName}: ${c.text}`)
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `你是一名 CS2（反恐精英2）比赛 demo 数据分析师，服务于视频创作者找素材与复盘。
你会收到一场比赛的结构化数据（选手数据、回合时间线、击杀记录、语音转写、文字聊天）。
规则：
1. 回答语言跟随用户提问语言（中文问题用中文回答）。
2. 引用具体时间点时一律用 [mm:ss] 格式，涉及回合用 R#（如 R12）。数据中的 [mm:ss] 是从比赛开始的时钟。
3. 「高光」的评判：多杀回合、连杀/残局、爆头、关键拆弹/下包回合、语音情绪激动处。
4. 「破防」的评判：聊天/语音中出现辱骂、嘲讽、抱怨、心态崩的语句。
5. 数据可能不完整（转写有误、天梯 demo 无语音），结论要说明依据；不要编造数据里不存在的事件。
6. 回答结构清晰：要点式 + 时间点引用；如果用户要"某一选手"，聚焦该选手。`

export class AiService {
  private controller: AbortController | null = null
  private mockMode = false
  private cb: AiCallbacks

  constructor(cb: AiCallbacks) {
    this.cb = cb
  }

  setMock(on: boolean): void {
    this.mockMode = on
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  /**
   * 发起一次分析。返回 { started }；内容经 delta/done/error 回调流式推送。
   */
  async ask(
    demoId: string,
    question: string,
    detail: DemoDetail,
    cfg: { baseUrl: string; apiKey: string; model: string },
    language: 'zh' | 'en'
  ): Promise<{ started: boolean; error?: string }> {
    if (this.mockMode) {
      this.askMock(demoId, question, detail)
      return { started: true }
    }
    if (!cfg.apiKey) {
      return {
        started: false,
        error: language === 'zh' ? '还没有配置 AI 的 API Key：请到设置页「AI 分析」填写（与转写同一个免费 Groq Key 即可）' : 'No AI API key configured — fill it in Settings → AI analysis (the free Groq key from transcription works)'
      }
    }
    const base = cfg.baseUrl.replace(/\/+$/, '')
    const controller = new AbortController()
    this.controller = controller
    const context = buildContext(detail)
    const langHint = language === 'zh' ? '请用中文回答。' : 'Answer in English.'
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model,
          stream: true,
          temperature: 0.4,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `${langHint}\n\n以下是本场 demo 的数据：\n\n${context}\n\n问题：${question}`
            }
          ]
        }),
        signal: controller.signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(
          `API ${res.status}${res.status === 401 ? '（Key 无效）' : res.status === 404 ? '（模型或地址不存在）' : ''} ${text.slice(0, 160)}`
        )
      }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('no stream')
      const decoder = new TextDecoder()
      let buf = ''
      let full = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const j = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[]
            }
            const chunk = j.choices?.[0]?.delta?.content
            if (chunk) {
              full += chunk
              this.cb.delta(demoId, chunk)
            }
          } catch {
            /* 忽略坏行 */
          }
        }
      }
      this.cb.done(demoId, full)
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? '已取消'
          : err instanceof Error
            ? err.message
            : String(err)
      this.cb.error(demoId, msg)
    } finally {
      if (this.controller === controller) this.controller = null
    }
    return { started: true }
  }

  /** 开发/离线演示：基于真实数据本地生成结构化回答（不调用网络） */
  private askMock(demoId: string, question: string, d: DemoDetail): void {
    const rate = d.meta.tickRate ?? 64
    const players = d.meta.players ?? []
    const kills: KillEvent[] = d.rounds.flatMap((r) => r.kills)
    const voices = d.voice.filter((v) => v.text && v.text !== '[BLANK_AUDIO]')

    // 高光选手：击杀最多
    const byKills = [...players].sort((a, b) => b.kills - a.kills)
    const star = byKills[0]
    // 高光回合：多杀回合 + 炸弹回合优先
    const hotRounds = [...d.rounds]
      .map((r) => ({
        r,
        score: r.kills.length * 1 + (r.bombPlantedTick ? 2 : 0) + (r.endType === 'elimination' ? 1 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    const starKills = kills
      .filter((k) => k.attackerName === star?.name)
      .sort((a, b) => b.tick - a.tick)

    // 破防检测：聊天/语音里的情绪词
    const BAD_WORDS = ['傻', '菜', '狗', '吗', '妈', '操', '废物', '垃圾', 'noob', 'fuck', 'bot', '别叫', '叫', '装', '演']
    const rageChat = d.chat.filter((c) => BAD_WORDS.some((w) => c.text.toLowerCase().includes(w)))
    const rageVoice = voices.filter((v) => BAD_WORDS.some((w) => v.text.includes(w)))

    const parts: string[] = []
    parts.push('（离线演示模式：以下为本地规则分析，配置 API Key 后可获得真正的大模型深度分析）\n')
    parts.push(`## 🎬 高光候选\n`)
    if (star) {
      parts.push(`**${star.name}**（${star.kills} 杀 / HS ${star.hsp}%）是全场击杀最多的选手，适合做个人高光合集：`)
      for (const k of starKills.slice(0, 5)) {
        parts.push(`- [${fmtClock(k.tick, rate)}] R${k.roundNum} 击杀 ${k.victimName}（${k.weapon}${k.headshot ? ' 爆头' : ''}）`)
      }
    }
    parts.push(`\n高光回合：`)
    for (const { r } of hotRounds) {
      parts.push(`- R${r.roundNum}（${r.winner === 'T' ? 'T' : 'CT'}胜 · ${r.kills.length} 击杀${r.bombPlantedTick ? ' · 有下包' : ''}）`)
    }
    if (rageChat.length || rageVoice.length) {
      parts.push(`\n## 😤 破防时刻\n`)
      for (const c of rageChat.slice(0, 5)) {
        parts.push(`- [${fmtClock(c.tick, rate)}] R${c.roundNum} 聊天 ${c.playerName}: ${c.text}`)
      }
      for (const v of rageVoice.slice(0, 5)) {
        parts.push(`- [${fmtClock(v.tick, rate)}] R${v.roundNum ?? '?'} 语音 ${v.playerName}: ${v.text}`)
      }
    } else {
      parts.push(`\n## 😤 破防时刻\n没有检测到明显破防/辱骂内容。`)
    }
    parts.push(`\n## 📋 速览\n- 比分 ${d.meta.teamT} ${d.meta.scoreT} : ${d.meta.scoreCT} ${d.meta.teamCT}，${d.meta.roundCount} 回合`)
    parts.push(`- 共 ${kills.length} 次击杀、${voices.length} 段有效语音、${d.chat.length} 条聊天`)
    parts.push(`\n_注：这是基于你问题的通用模板分析；配置 Key 后可针对「${question.slice(0, 24)}${question.length > 24 ? '…' : ''}」给出定制答案。_`)

    const answer = parts.join('\n')
    // 模拟流式输出
    let i = 0
    const timer = setInterval(() => {
      const step = 24
      const chunk = answer.slice(i, i + step)
      i += step
      if (chunk) this.cb.delta(demoId, chunk)
      if (i >= answer.length) {
        clearInterval(timer)
        this.cb.done(demoId, answer)
      }
    }, 24)
  }
}
