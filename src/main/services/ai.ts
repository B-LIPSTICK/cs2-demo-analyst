/**
 * AI 分析服务：把 demo 解析数据组装成上下文，调用 OpenAI 兼容 chat/completions
 * 流式返回；无 Key 或网络失败时给出可读错误；--ai-mock 模式本地生成回答（开发验证）。
 * 附带对话会话（记忆）持久化：userData/ai-chats.json。
 */
import { app, net } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AiChatMessage, AiChatSession, ChatMessage, DemoDetail, KillEvent, VoiceSegment } from '@shared/types'

export interface AiCallbacks {
  /** sessionId 可选：兼容旧调用；requestId 始终存在，供 renderer 过滤过期流 */
  delta: (demoId: string, chunk: string, sessionId: string | undefined, requestId: string) => void
  done: (demoId: string, answer: string, sessionId: string | undefined, requestId: string) => void
  error: (demoId: string, err: string, sessionId: string | undefined, requestId: string) => void
}

const MAX_VOICE_LINES = 250
/** 击杀明细上限：超出时优先保留关键击杀（首杀/多杀/炸弹/残局） */
const MAX_KILL_LINES = 600
/** 聊天明细上限：超出时均匀抽样，并在上下文中写明省略数量 */
const MAX_CHAT_LINES = 300
/** buildContext 默认总字符预算；调用方可通过第二个参数覆盖 */
const MAX_CONTEXT_CHARS = 60_000
/** 炸弹事件前后多少秒内的击杀视为“炸弹相关” */
const BOMB_KEY_KILL_WINDOW_SEC = 15

/** buildContext 的可选预算参数；不传时使用上面的安全默认值 */
export interface BuildContextOptions {
  /** 上下文总字符预算（默认 60000；低于 2000 按 2000 处理） */
  maxChars?: number
  /** 击杀明细上限（默认 600；关键击杀优先保留） */
  maxKills?: number
  /** 聊天明细上限（默认 300） */
  maxChats?: number
  /** 语音明细上限（默认 250） */
  maxVoiceLines?: number
  /**
   * 本轮问题点名的玩家。给出时击杀明细只保留与这些人相关的行，
   * 避免模型把整段击杀记录当成答案原样抄出来。
   */
  focus?: string[]
}

interface KillLine {
  text: string
  /** 是否为关键击杀，仅用于预算裁剪优先级 */
  key: boolean
  tick: number
}

function fmtClock(tick: number, rate: number): string {
  const s = Math.floor(tick / rate)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 安全地取整并夹到最小值；非法值回退到默认值 */
function clampInt(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value))
}

/**
 * 从数组中等距抽取 limit 条（保留首尾，尽量覆盖整场）。
 * 仅用于预算裁剪，不改变原始数据。
 */
function pickEvenly<T>(items: T[], limit: number): T[] {
  if (limit <= 0 || items.length === 0) return []
  if (limit >= items.length) return items
  if (limit === 1) return [items[Math.floor(items.length / 2)]]
  const result: T[] = []
  let last = -1
  for (let i = 0; i < limit; i++) {
    let idx = Math.round((i * (items.length - 1)) / (limit - 1))
    if (idx <= last) idx = last + 1
    if (idx >= items.length) idx = items.length - 1
    result.push(items[idx])
    last = idx
  }
  return result
}

/** 击杀唯一键：tick 在 demo 内唯一，roundNum + tick + 双方足以避免同时击杀碰撞 */
function killKey(k: KillEvent): string {
  return `${k.roundNum}:${k.tick}:${k.victimUid ?? k.victimName ?? '?'}:${k.attackerUid ?? k.attackerName ?? '?'}`
}

/** 同一攻击者的稳定标识（优先 SteamID，其次名字，最后 uid） */
function attackerId(k: KillEvent): string {
  return k.attackerSteamId || k.attackerName || `uid:${k.attackerUid ?? '?'}`
}

/**
 * 标记关键击杀，仅用于预算裁剪优先级，不改变击杀输出格式：
 * - 每回合首个“跨阵营”击杀（纯队内击杀不算首杀）
 * - 多杀：同一攻击者本回合 >=2 个跨阵营击杀
 * - 炸弹相关：安放/拆除/爆炸前后 15 秒内的跨阵营击杀
 * - 残局近似：按竞技 5v5（或更小规模）初始人数与击杀顺序推算，
 *   任一方 <=2 人时发生的跨阵营击杀；击杀后任一方 <=1 人也标记
 *
 * 说明：残局判定只是启发式，用来决定“先保留谁”，不写入上下文结论。
 */
function markKeyKills(d: DemoDetail, kills: KillEvent[], rate: number): Set<string> {
  const key = new Set<string>()
  const byRound = new Map<number, KillEvent[]>()
  for (const k of kills) {
    const arr = byRound.get(k.roundNum)
    if (arr) arr.push(k)
    else byRound.set(k.roundNum, [k])
  }

  const metaPlayers = d.meta.players ?? []
  // 竞技模式通常 5v5；人数缺失时按 5 人估算，超过 5 人按 5 人封顶（仅用于优先级）
  const teamSizeT = Math.max(1, Math.min(5, metaPlayers.filter((p) => p.team === 'T').length || 5))
  const teamSizeCT = Math.max(1, Math.min(5, metaPlayers.filter((p) => p.team === 'CT').length || 5))

  for (const r of d.rounds) {
    const rk = byRound.get(r.roundNum)
    if (!rk || rk.length === 0) continue
    rk.sort((a, b) => a.tick - b.tick)

    // 首杀：优先取第一个跨阵营击杀
    const firstEnemyKill = rk.find((k) => k.attackerTeam !== k.victimTeam) ?? rk[0]
    key.add(killKey(firstEnemyKill))

    // 多杀：只统计跨阵营击杀
    const attackerCounts = new Map<string, number>()
    for (const k of rk) {
      if (k.attackerTeam === k.victimTeam) continue
      const id = attackerId(k)
      attackerCounts.set(id, (attackerCounts.get(id) ?? 0) + 1)
    }
    for (const k of rk) {
      if (k.attackerTeam === k.victimTeam) continue
      if ((attackerCounts.get(attackerId(k)) ?? 0) >= 2) key.add(killKey(k))
    }

    // 炸弹事件前后窗口
    const bombTicks = [r.bombPlantedTick, r.bombDefusedTick, r.bombExplodedTick].filter(
      (t): t is number => typeof t === 'number'
    )
    if (bombTicks.length > 0) {
      const window = BOMB_KEY_KILL_WINDOW_SEC * rate
      for (const k of rk) {
        if (k.attackerTeam !== k.victimTeam && bombTicks.some((t) => Math.abs(k.tick - t) <= window)) {
          key.add(killKey(k))
        }
      }
    }

    // 残局近似：任一方 <=2 人时发生的击杀；击杀后任一方 <=1 人也标记
    let aliveT = teamSizeT
    let aliveCT = teamSizeCT
    for (const k of rk) {
      const enemyKill = k.attackerTeam !== k.victimTeam
      if (enemyKill && Math.min(aliveT, aliveCT) <= 2) key.add(killKey(k))
      if (k.victimTeam === 'T') aliveT = Math.max(0, aliveT - 1)
      else if (k.victimTeam === 'CT') aliveCT = Math.max(0, aliveCT - 1)
      if (enemyKill && Math.min(aliveT, aliveCT) <= 1) key.add(killKey(k))
    }
  }

  // 解析器显式给出的 firstKill 也纳入，防止回合内排序异常导致漏标
  for (const r of d.rounds) {
    if (r.firstKill && r.firstKill.attackerTeam !== r.firstKill.victimTeam) {
      key.add(killKey(r.firstKill))
    }
  }
  return key
}

/** 从提问里找出被点名的玩家（用于收窄击杀明细，见 buildContext 的 focus） */
function detectFocusPlayers(question: string, d: DemoDetail): string[] {
  const players = (d.meta.players ?? []).map((p) => p.name).filter(Boolean)
  const hits: string[] = []
  for (const name of players) {
    if (question.includes(name)) {
      hits.push(name)
      continue
    }
    // 玩家名常带装饰字符（如 🗲LIPSTICK🗲），提问里只会写核心部分：
    // 去掉首尾非字母数字的装饰后再匹配，且要求长度 ≥ 3 防止误命中。
    const core = name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (core.length >= 3 && question.toLowerCase().includes(core.toLowerCase())) hits.push(name)
  }
  return hits
}

/**
 * 提问里隐含的武器线索（「电」= 电击枪、「狙」= AWP 等）。
 * 用于把「谁被 X 电了」这类问法落到具体武器上，而不是只给总击杀数。
 */
const WEAPON_HINTS: { keys: string[]; weapon: string; label: string }[] = [
  { keys: ['电击枪', '电击', '电', 'zeus', 'taser'], weapon: 'Zeus x27', label: '电击枪（Zeus x27）' },
  { keys: ['刀', 'knife'], weapon: 'Knife', label: '刀' },
  { keys: ['大狙', 'awp'], weapon: 'AWP', label: 'AWP' },
  { keys: ['鸟狙', 'ssg'], weapon: 'SSG 08', label: '鸟狙（SSG 08）' }
]

/** 从提问里猜出用户问的是哪种武器；没有线索返回 null */
function detectWeaponHint(question: string): { weapon: string; label: string } | null {
  const q = question.toLowerCase()
  for (const h of WEAPON_HINTS) {
    if (h.keys.some((k) => q.includes(k))) return { weapon: h.weapon, label: h.label }
  }
  return null
}

/**
 * 事实类提问（「谁被 X 电了」「X 杀了几个」「X 死几次」）用本地计算直接作答。
 *
 * 为什么不让模型答：实测 glm-4-flash 在这类带前提的问题上会把击杀方向读反、
 * 把 Zeus 意译成「电击」后安到别人头上，而且只要历史里有过错答就会照着抄。
 * 提示词写到 14 条仍然压不住（同一问题三次运行三种结果），
 * 所以这里改成「能从数据算出来的问题就不问模型」——答案永远正确、也更快。
 *
 * 只在同时满足以下条件时接管：提问点名了玩家，且问的是击杀/阵亡这类可枚举事实。
 * 其它问题（战术分析、谁打得最好、为什么输）仍交给模型。
 */
export function buildFactAnswer(question: string, d: DemoDetail): string | null {
  const rate = d.meta.tickRate ?? 64
  const focus = detectFocusPlayers(question, d)
  if (focus.length === 0) return null

  const eventWords = ['被', '杀', '电', '死', '击杀', '人头']
  const q = question.toLowerCase()
  if (!eventWords.some((w) => q.includes(w))) return null

  const allKills: KillEvent[] = d.rounds.flatMap((r) => r.kills).sort((a, b) => a.tick - b.tick)
  const hint = detectWeaponHint(question)
  const out: string[] = []

  for (const name of focus) {
    const asAttacker = allKills.filter((k) => (k.attackerName ?? '') === name)
    const asVictim = allKills.filter((k) => (k.victimName ?? '') === name)
    const short = name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || name

    // ── 先给结论：直接回答「电了几个」这类问题 ──────────────────────────
    if (hint) {
      const withWeapon = asAttacker.filter((k) => k.weapon === hint.weapon)
      if (withWeapon.length === 0) {
        out.push(`## ${short} 没有用${hint.label}击杀任何人`)
        out.push(
          `本局 ${name} 共 ${asAttacker.length} 杀，用到的武器：${
            asAttacker.length === 0
              ? '无'
              : [...new Set(asAttacker.map((k) => k.weapon))].join('、')
          }。`
        )
      } else {
        out.push(`## ${short} 用${hint.label}击杀 ${withWeapon.length} 人`)
        for (const k of withWeapon) {
          out.push(
            `- [${fmtClock(k.tick, rate)}] R${k.roundNum} 击杀 ${k.victimName ?? '?'}${k.headshot ? '（爆头）' : ''}`
          )
        }
      }
      out.push('')
    } else {
      out.push(`## ${short} 本局 ${asAttacker.length} 杀 / ${asVictim.length} 死`)
      out.push('')
    }

    // ── 明细：作为攻击者 ────────────────────────────────────────────────
    if (asAttacker.length > 0) {
      out.push(`### ${short} 的击杀（${asAttacker.length} 次）`)
      for (const k of asAttacker) {
        out.push(
          `- [${fmtClock(k.tick, rate)}] R${k.roundNum} 用 ${k.weapon} 击杀 ${k.victimName ?? '?'}${k.headshot ? '（爆头）' : ''}`
        )
      }
      out.push('')
    }

    // ── 明细：作为受害者（这是用户真正在问的「谁把 X 杀了」）────────────
    if (asVictim.length > 0) {
      out.push(`### ${short} 的阵亡（${asVictim.length} 次）`)
      for (const k of asVictim) {
        out.push(
          `- [${fmtClock(k.tick, rate)}] R${k.roundNum} 被 ${k.attackerName ?? '?'} 用 ${k.weapon} 击杀${k.headshot ? '（爆头）' : ''}`
        )
      }
      out.push('')
    }
  }

  out.push('_以上数字直接取自 demo 解析结果，可用界面上的击杀流逐条核对。_')
  return out.join('\n')
}

/** 把 demo 数据压缩成给 LLM 的上下文文本（时间统一 mm:ss + R回合，便于引用） */
export function buildContext(d: DemoDetail, opts: BuildContextOptions = {}): string {
  const rate = d.meta.tickRate ?? 64
  const maxChars = clampInt(opts.maxChars, MAX_CONTEXT_CHARS, 2000)
  const maxKills = clampInt(opts.maxKills, MAX_KILL_LINES, 0)
  const maxChats = clampInt(opts.maxChats, MAX_CHAT_LINES, 0)
  const maxVoiceLines = clampInt(opts.maxVoiceLines, MAX_VOICE_LINES, 0)

  // ─── 原始数据与固定段落 ────────────────────────────────────────────────
  const overviewLine = `地图 ${d.meta.mapName ?? '未知'} · 比分 ${d.meta.teamT ?? 'T'} ${d.meta.scoreT ?? 0} : ${d.meta.scoreCT ?? 0} ${d.meta.teamCT ?? 'CT'} · ${d.meta.roundCount ?? 0} 回合 · 时长 ${Math.round((d.meta.durationSec ?? 0) / 60)} 分钟 · 语音转写 ${d.voice.length} 段 · 聊天 ${d.chat.length} 条`

  const playerLines = (d.meta.players ?? []).map(
    (p) => `${p.name} ${p.team} ${p.kills}-${p.deaths} ${p.hsp}% MVP${p.mvp}`
  )

  const roundLines = d.rounds.map((r) => {
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
    return `R${r.roundNum} ${r.winner === 'T' ? 'T胜' : r.winner === 'CT' ? 'CT胜' : '无'}(${endLabel}) ${r.kills.length}击杀${extras.length ? ' ' + extras.join(' ') : ''}`
  })

  // ─── 击杀：先按关键击杀优先做单节上限，再由总预算进一步裁剪 ───────────
  const allKills: KillEvent[] = d.rounds.flatMap((r) => r.kills).sort((a, b) => a.tick - b.tick)
  const keySet = markKeyKills(d, allKills, rate)
  const killTotal = allKills.length
  const keyKills = allKills.filter((k) => keySet.has(killKey(k)))
  const normalKills = allKills.filter((k) => !keySet.has(killKey(k)))
  const keyTotal = keyKills.length

  let selectedKills: KillEvent[]
  if (killTotal <= maxKills) {
    selectedKills = allKills
  } else if (keyKills.length >= maxKills) {
    // 关键击杀本身已超上限：只保留关键击杀，并均匀抽取
    selectedKills = pickEvenly(keyKills, maxKills)
  } else {
    // 保留全部关键击杀，剩余名额均匀分给普通击杀
    const slots = maxKills - keyKills.length
    selectedKills = [...keyKills, ...pickEvenly(normalKills, slots)].sort((a, b) => a.tick - b.tick)
  }

  // 问题里点了名字：击杀明细只保留与这些人相关的行。
  // 只靠提示词约束不住 —— 实测模型会把整段击杀记录原样抄成答案，
  // 从数据层面先收窄，模型就没有可抄的无关内容。
  const focusNames = (opts.focus ?? []).map((s) => s.trim()).filter(Boolean)
  let focusFiltered = false
  if (focusNames.length > 0) {
    const related = selectedKills.filter((k) =>
      focusNames.some((n) => (k.attackerName ?? '').includes(n) || (k.victimName ?? '').includes(n))
    )
    if (related.length > 0) {
      selectedKills = related
      focusFiltered = true
    }
  }

  // 用「A 用 W 击杀 B」的中文句式，而不是「A -W-> B」的箭头简写：
  // 实测 glm-4-flash 在「谁被 X 电了」这类带前提的问题上会把箭头两端读反，
  // 把受害者当成攻击者、并把 Zeus 意译成「电击」后安到别人头上。
  const killLines: KillLine[] = selectedKills.map((k) => ({
    key: keySet.has(killKey(k)),
    tick: k.tick,
    text: `[${fmtClock(k.tick, rate)}] R${k.roundNum} ${k.attackerName ?? '?'} 用 ${k.weapon} 击杀 ${k.victimName ?? '?'}${k.headshot ? '（爆头）' : ''}${k.throughSmoke ? '（穿烟）' : ''}`
  }))

  // ─── 玩家武器统计：回答「某人用某武器杀了多少人」时的事实基线 ─────────────
  // 只统计跨阵营击杀以外也用「—」（自杀/环境）与 C4（炸弹）区分，不做额外过滤。
  const weaponLines: string[] = (d.meta.players ?? []).map((p) => {
    const mine = allKills.filter((k) => k.attackerName === p.name)
    if (mine.length === 0) return `${p.name}：本局无击杀记录`
    const byW = new Map<string, number>()
    for (const k of mine) byW.set(k.weapon, (byW.get(k.weapon) ?? 0) + 1)
    const list = [...byW.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([w, n]) => `${w}×${n}`)
      .join(' ')
    return `${p.name}：共 ${mine.length} 杀 · ${list}`
  })

  // ─── 点名玩家事实核对：直接给「杀了几个 / 被谁杀」的硬数字 ────────────────
  // 模型自己数行容易数错，也不愿意承认用户前提有误；这里把答案先算好摆在最前面。
  const focusFacts: string[] = focusNames.map((n) => {
    const asAttacker = allKills.filter((k) => (k.attackerName ?? '').includes(n))
    const asVictim = allKills.filter((k) => (k.victimName ?? '').includes(n))
    const byWeapon = new Map<string, number>()
    for (const k of asAttacker) byWeapon.set(k.weapon, (byWeapon.get(k.weapon) ?? 0) + 1)
    const weaponText =
      asAttacker.length === 0
        ? '本局没有击杀'
        : [...byWeapon.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([w, c]) => `${w} ${c} 次`)
            .join('、')
    const killList =
      asAttacker.length === 0
        ? ''
        : `（${asAttacker.map((k) => `[${fmtClock(k.tick, rate)}] R${k.roundNum} 杀 ${k.victimName ?? '?'} 用 ${k.weapon}`).join('；')}）`
    return `${n}：作为攻击者共 ${asAttacker.length} 杀 —— ${weaponText}${killList}；作为受害者共死 ${asVictim.length} 次`
  })

  // ─── 语音：保持原有 250 条上限；总预算紧张时再均匀裁剪 ─────────────────
  const allVoices: VoiceSegment[] = d.voice
    .filter((v) => v.text && v.text !== '[BLANK_AUDIO]')
    .sort((a, b) => a.tick - b.tick)
  const voiceTotal = allVoices.length
  const voiceLines = allVoices.slice(0, maxVoiceLines).map(
    (v) => `[${fmtClock(v.tick, rate)}] R${v.roundNum ?? '?'} ${v.playerName}: ${v.text}`
  )

  // ─── 聊天：单节上限内均匀抽样；摘要始终保留 ────────────────────────────
  const allChats: ChatMessage[] = [...d.chat].sort((a, b) => a.tick - b.tick)
  const chatTotal = allChats.length
  const chatLines = (chatTotal > maxChats ? pickEvenly(allChats, maxChats) : allChats).map(
    (c) => `[${fmtClock(c.tick, rate)}] R${c.roundNum} (${c.channel}) ${c.playerName}: ${c.text}`
  )

  const channelCounts = new Map<string, number>()
  for (const c of allChats) channelCounts.set(c.channel, (channelCounts.get(c.channel) ?? 0) + 1)
  const channelText = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ch, n]) => `${ch} ${n}`)
    .join(' · ')
  const speakerCount = new Set(allChats.map((c) => c.playerName)).size
  const chatSummaryLine =
    chatTotal === 0
      ? '（无聊天记录）'
      : `摘要：共 ${chatTotal} 条（${channelText}），涉及 ${speakerCount} 名玩家。`

  // ─── 可裁剪状态：初始为单节上限后的结果 ───────────────────────────────
  let retainedPlayers = [...playerLines]
  let retainedWeapons = [...weaponLines]
  let retainedRounds = [...roundLines]
  let retainedKills = [...killLines]
  let retainedVoices = [...voiceLines]
  let retainedChats = [...chatLines]

  const hasOmission = (): boolean =>
    retainedPlayers.length < playerLines.length ||
    retainedWeapons.length < weaponLines.length ||
    retainedRounds.length < roundLines.length ||
    retainedKills.length < killTotal ||
    retainedVoices.length < voiceTotal ||
    retainedChats.length < chatTotal

  /** 按当前保留状态渲染完整上下文；省略说明会随保留数量动态变化 */
  const render = (): string => {
    const out: string[] = []
    out.push('# Demo 概览')
    out.push(overviewLine)
    if (hasOmission()) {
      out.push('> 预算说明：本上下文已按优先级省略部分记录（数量见各节）；未展示不代表未发生，请勿据此断言“没有”。')
    }
    out.push('')
    if (focusFacts.length > 0) {
      out.push('# 提问点名玩家的事实核对（此处是算好的准确数字，回答以它为准）')
      out.push(...focusFacts)
      out.push('')
    }

    out.push('# 选手数据（姓名 阵营 K-D 爆头率 MVP）')
    if (retainedPlayers.length < playerLines.length) {
      out.push(`（已省略 ${playerLines.length - retainedPlayers.length} 名选手）`)
    }
    out.push(...retainedPlayers)
    out.push('')

    out.push('# 玩家武器统计（每名玩家本局的击杀数与其使用的武器；用于核对“谁用某武器击杀”这类问题）')
    if (retainedWeapons.length < weaponLines.length) {
      out.push(`（已省略 ${weaponLines.length - retainedWeapons.length} 名玩家的武器统计）`)
    }
    out.push(...retainedWeapons)
    out.push('')

    out.push('# 回合时间线')
    if (retainedRounds.length < roundLines.length) {
      out.push(`（已省略 ${roundLines.length - retainedRounds.length} 个回合）`)
    }
    out.push(...retainedRounds)
    out.push('')

    out.push(
      retainedKills.length < killTotal || focusFiltered
        ? '# 击杀记录（预算筛选版；格式：时间 R回合 攻击者 用 武器 击杀 受害者）'
        : '# 击杀记录（格式：时间 R回合 攻击者 用 武器 击杀 受害者）'
    )
    if (focusFiltered) {
      out.push(
        `（已按提问点名的玩家 ${focusNames.join('、')} 过滤：只列出他作为攻击者或受害者的击杀，共 ${retainedKills.length} 条；其余玩家之间的击杀未列出，也不要回答）`
      )
    } else if (retainedKills.length < killTotal) {
      const keyRetained = retainedKills.filter((k) => k.key).length
      const keyPart = keyTotal > 0 ? `；关键击杀保留 ${keyRetained}/${keyTotal} 条` : ''
      out.push(
        `（共 ${killTotal} 条；本上下文保留 ${retainedKills.length} 条，已省略 ${killTotal - retainedKills.length} 条；优先保留首杀/多杀/炸弹/残局相关击杀${keyPart}）`
      )
    }
    out.push(...retainedKills.map((k) => k.text))
    out.push('')

    out.push('# 语音转写（时间 R回合 玩家: 文本；[BLANK_AUDIO] 为空音频已剔除）')
    if (voiceTotal === 0) {
      out.push('（无有效转写文本）')
    } else if (retainedVoices.length < voiceTotal) {
      out.push(
        `（有效转写共 ${voiceTotal} 段；本上下文保留 ${retainedVoices.length} 段，已省略 ${voiceTotal - retainedVoices.length} 段）`
      )
    }
    out.push(...retainedVoices)
    out.push('')

    out.push('# 文字聊天（时间 R回合 频道 玩家: 文本）')
    out.push(chatSummaryLine)
    if (retainedChats.length < chatTotal) {
      out.push(`（本上下文保留 ${retainedChats.length} 条明细，已省略 ${chatTotal - retainedChats.length} 条）`)
    }
    out.push(...retainedChats)
    return out.join('\n')
  }

  // ─── 总字符预算：按“低优先级先裁”的顺序逐节收缩 ───────────────────────
  // 裁剪顺序（从低到高）：聊天明细 → 普通击杀 → 语音 → 关键击杀 → 回合 → 选手 → 玩家武器统计
  const fits = (): boolean => render().length <= maxChars

  /** 先清空该节；若清空后能放下，再二分查找最多保留多少条 */
  const fitArray = <T>(all: T[], set: (items: T[]) => void): boolean => {
    set([])
    if (!fits()) return false
    let lo = 0
    let hi = all.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      set(pickEvenly(all, mid))
      if (fits()) lo = mid
      else hi = mid - 1
    }
    set(pickEvenly(all, lo))
    return true
  }

  // 1) 聊天明细（最低优先级；摘要已固定在 header 下）
  if (retainedChats.length > 0) {
    const done = fitArray(chatLines, (items) => {
      retainedChats = items
    })
    if (done) return render()
  }

  // 2) 普通击杀：先清空普通击杀，保留全部关键击杀；能放下再逐步加回
  if (retainedKills.some((k) => !k.key)) {
    const keyOnly = killLines.filter((k) => k.key)
    const normal = killLines.filter((k) => !k.key)
    retainedKills = [...keyOnly]
    if (fits()) {
      let lo = 0
      let hi = normal.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        retainedKills = [...keyOnly, ...pickEvenly(normal, mid)].sort((a, b) => a.tick - b.tick)
        if (fits()) lo = mid
        else hi = mid - 1
      }
      retainedKills = [...keyOnly, ...pickEvenly(normal, lo)].sort((a, b) => a.tick - b.tick)
      return render()
    }
    // 只保留关键击杀仍超预算：保留关键击杀，继续裁语音
  }

  // 3) 语音
  if (retainedVoices.length > 0) {
    const done = fitArray(voiceLines, (items) => {
      retainedVoices = items
    })
    if (done) return render()
  }

  // 4) 关键击杀（此时普通击杀已清空；若仍超预算，关键击杀也要让位给回合/选手）
  if (retainedKills.length > 0) {
    const keyOnly = killLines.filter((k) => k.key)
    const done = fitArray(keyOnly, (items) => {
      retainedKills = items
    })
    if (done) return render()
  }

  // 5) 回合时间线
  if (retainedRounds.length > 0) {
    const done = fitArray(roundLines, (items) => {
      retainedRounds = items
    })
    if (done) return render()
  }

  // 6) 选手数据
  if (retainedPlayers.length > 0) {
    const done = fitArray(playerLines, (items) => {
      retainedPlayers = items
    })
    if (done) return render()
  }

  // 7) 玩家武器统计（事实基线，放在最后才让位）
  if (retainedWeapons.length > 0) {
    const done = fitArray(weaponLines, (items) => {
      retainedWeapons = items
    })
    if (done) return render()
  }

  // 极端兜底：默认 60000 字符下不会走到这里；保留概览并做硬截断，避免请求超限
  const out = render()
  return out.length <= maxChars ? out : out.slice(0, maxChars)
}

const SYSTEM_PROMPT = `你是一名顶级的 CS2（反恐精英 2）职业级比赛复盘分析师，同时也是视频创作者的剪辑素材顾问。
你会收到一场比赛的结构化数据：选手数据（K-D/爆头率/MVP）、回合时间线（胜负/结束方式/炸弹）、击杀记录（武器/爆头/穿烟）、语音转写（玩家原话）、文字聊天。

## 数据说明
- 时间统一为比赛时钟 [mm:ss]，回合用 R# 表示（如 R12）。
- **击杀记录的方向固定为「攻击者 用 武器 击杀 受害者」**：第一个名字是杀人者，最后一个名字是死者。用户问「谁被 X 杀了」时，要找的是「X 用 … 击杀 某人」这种行，受害者是行尾那个名字，不要把方向读反。
- **玩家武器统计一节是核对武器归属的事实基线**：每人一行，列出本局击杀总数与每种武器的击杀次数。若某人某武器的次数是 0，就说明他这一局没用该武器杀人，绝不能凭印象罗列。
- 语音转写中的 [BLANK_AUDIO] 已剔除；语音转写可能有误，判断"破防/情绪"时优先采信聊天与语气明确的语音。
- 击杀记录来自 demo 解析，可能因解析版本或异常事件存在缺漏；若与选手统计或回合结果冲突，以统计/回合结果为准，不要编造数据中不存在的事件。

## 回答规则（最重要：简洁）
1. 回答语言跟随用户提问语言（中文提问用中文回答）。
2. **总长度控制在 300 字以内**（约 15-25 行），除非用户明确要求详细。每个要点一句话，不展开解释、不重复、不写总结性废话。
3. 结构：开头先用一句话给直接结论（可以是最重要的 1-3 个片段），再列要点。
4. 引用任何时刻必须给出 [mm:ss]；涉及回合给出 R#。数据里没有的事件一律不许编造，信息不足一句话说明即可。
5. 输出用 Markdown：「##」分节（每节标题下 1-3 行）、「-」列表、「**加粗**」强调最值得看的部分。
6. **数据优先于对话历史**：如果前面几轮的回答和本轮给出的数据冲突，以本轮数据为准，并直接按数据重答，不要沿用之前的错答。
7. **数量必须自洽**：回答里列出的事件条数，不能超过数据里该事件的真实条数；不确定时先数一遍再写。
8. **只答所问，不要复述全场**：用户问某名玩家时，只列「他是攻击者的行」和「他是受害者的行」，其余玩家之间的击杀一律不要出现在回答里。数据里共有上百行击杀记录，把它们抄一遍等于没回答。
9. **禁止推断性因果**：数据里只有直接击杀，没有「谁的死导致了谁的死」。不许写「间接导致」「连带」「因此」这类因果推断；用户没问就直接不提。
10. **时间必须照抄**：引用 [mm:ss] 时把数据行里的时间原样抄下来，不要自己换算、估算或凭印象写。
11. **提问里的前提可能是错的，数据才是准的**：用户常带着印象提问（例如「LIPSTICK 一局能电那么多人？」）。先在心里拿数据核一遍——把该玩家作为攻击者的行挑出来数一数。如果前提不成立，**第一句就直接纠正**（例：「这局 LIPSTICK 只电死过 1 个人（[04:56] R4 愚昧5555），他自己被杀了 4 次」），然后再列真实的行。绝不能顺着提问的前提编答案。
12. **武器名照抄数据**：数据写 USP-S 就是 USP-S，写 MP9 就是 MP9。不许把别的武器改写成提问里提到的武器（提问说「电」不代表所有击杀都是电击枪）。
13. **「事实核对」一节是唯一权威**：如果上下文里有「提问点名玩家的事实核对」，那一节的杀人数、武器次数、死亡次数都是程序算好的准确值。你的回答里每一个数字都必须和它一致；不一致就是错的。用户的前提和它冲突时，直接指出用户记错了，并给出这一节的数字。
14. **只写上下文里出现过的击杀行**：回答里每一条 [mm:ss] 事件，都必须在「击杀记录」一节里逐字存在。找不到就不要写——宁可只给统计数字，也不要凑一条看起来合理的事件。

## 分析框架（按需裁剪，不要每节都写满）
- 高光/转折：只给**最值得的 3-5 个片段**，每条格式一行：「[mm:ss] R# 事件一句话」（如「[12:34] R14 Patsi 三杀翻盘 1v3」）。
- 破防：给 1-3 条，每条一行：「[mm:ss] R# 谁说了什么」。
- 选手点评：一句话点出关键选手 + 其 1-2 个关键片段；用户指定选手时聚焦该选手。
- 用户问"发生了什么"类问题：3-5 行讲清走势即可，不要罗列比分过程。

## 角色定位
像"看过整场的剪辑师"直接甩结论：只给"值得看的时刻"和依据，拒绝小作文。`

export class AiService {
  private controller: AbortController | null = null
  private mockMode = false
  private cb: AiCallbacks

  constructor(cb: AiCallbacks) {
    this.cb = cb
  }

  // ─── 对话会话（记忆）持久化 ────────────────────────────────────────────────

  private chatsPath(): string {
    return join(app.getPath('userData'), 'ai-chats.json')
  }

  private async loadChats(): Promise<AiChatSession[]> {
    try {
      return JSON.parse(await fs.readFile(this.chatsPath(), 'utf-8')) as AiChatSession[]
    } catch {
      return []
    }
  }

  private async persistChats(list: AiChatSession[]): Promise<void> {
    const p = this.chatsPath()
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    const tmp = p + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(list), 'utf-8')
    await fs.rename(tmp, p)
  }

  async listChats(): Promise<AiChatSession[]> {
    return this.loadChats()
  }

  async saveChat(session: AiChatSession): Promise<void> {
    const list = await this.loadChats()
    const idx = list.findIndex((s) => s.id === session.id)
    const next = { ...session, updatedAt: Date.now() }
    if (idx >= 0) list[idx] = next
    else list.unshift(next)
    await this.persistChats(list)
  }

  async removeChat(id: string): Promise<void> {
    const list = await this.loadChats()
    await this.persistChats(list.filter((s) => s.id !== id))
  }

  setMock(on: boolean): void {
    this.mockMode = on
  }

  /** 拉取服务商提供的模型列表（GET /v1/models，OpenAI 兼容） */
  async listModels(cfg: { baseUrl: string; apiKey: string }): Promise<string[]> {
    if (this.mockMode) {
      return [
        'Qwen/Qwen2.5-7B-Instruct',
        'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        'THUDM/glm-4-9b-chat',
        'glm-4-flash',
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'gpt-4o-mini',
        'deepseek-chat',
        'qwen-plus',
        'moonshot-v1-8k'
      ]
    }
    if (!cfg.apiKey) throw new Error('请先填写 AI API Key')
    const base = cfg.baseUrl.replace(/\/+$/, '')
    // net.fetch：跟随系统代理（全局 fetch 不走代理，国内网络直连外网 API 会失败）
    const res = await net.fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = ''
      try {
        const j = JSON.parse(text) as { error?: { message?: string }; message?: string }
        detail = j.error?.message || j.message || text.slice(0, 120)
      } catch {
        detail = text.slice(0, 120)
      }
      let hint = ''
      if (res.status === 401) hint = '（Key 无效）'
      else if (res.status === 403) hint = '（受地域限制或网络拦截，建议使用国内硅基流动）'
      throw new Error(`API ${res.status}${hint} ${detail}`)
    }
    const j = (await res.json()) as { data?: { id?: string }[] }
    const ids = (j.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    // 常用聊天模型置顶，其余按字母序
    const preferred = [
      'Qwen/Qwen2.5-7B-Instruct',
      'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
      'THUDM/glm-4-9b-chat',
      'glm-4-flash',
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'gpt-4o',
      'gpt-4o-mini',
      'deepseek-chat',
      'deepseek-reasoner',
      'qwen-plus',
      'qwen-max',
      'moonshot-v1-8k',
      'claude-3-5-sonnet-latest'
    ]
    ids.sort((a, b) => {
      const pa = preferred.indexOf(a)
      const pb = preferred.indexOf(b)
      if (pa >= 0 || pb >= 0) {
        if (pa < 0) return 1
        if (pb < 0) return -1
        return pa - pb
      }
      return a.localeCompare(b)
    })
    return ids
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  /**
   * 发起一次分析。返回 { started }；内容经 delta/done/error 回调流式推送。
   * history 为多轮对话记忆（最近若干条 user/assistant 消息）。
   */
  async ask(
    demoId: string,
    question: string,
    detail: DemoDetail,
    cfg: { baseUrl: string; apiKey: string; model: string },
    language: 'zh' | 'en',
    history: AiChatMessage[] = [],
    sessionId?: string,
    requestId?: string
  ): Promise<{ started: boolean; error?: string }> {
    // 兼容旧调用：未传 requestId 时由主进程补一个，保证事件始终可被过滤
    const reqId = requestId || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    if (this.mockMode) {
      await this.askMock(demoId, question, detail, sessionId, reqId)
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

    // 能从数据里算出来的事实类问题，直接本地作答，不经过模型。
    // 理由见 buildFactAnswer 的注释：弱模型在带前提的问题上会读反击杀方向，
    // 而且只要历史里有过错答就会照着抄，提示词压不住。
    const factAnswer = language === 'zh' ? buildFactAnswer(question, detail) : null
    if (factAnswer) {
      // 仍然分块推送，保持界面上的流式观感与「可取消」语义一致
      const chunks = factAnswer.match(/[\s\S]{1,48}/g) ?? []
      for (const chunk of chunks) {
        if (controller.signal.aborted) break
        this.cb.delta(demoId, chunk, sessionId, reqId)
        await new Promise((r) => setTimeout(r, 12))
      }
      this.cb.done(demoId, factAnswer, sessionId, reqId)
      this.controller = null
      return { started: true }
    }

    const context = buildContext(detail, { focus: detectFocusPlayers(question, detail) })
    const langHint = language === 'zh' ? '请用中文回答。' : 'Answer in English.'
    try {
      const res = await net.fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model,
          stream: true,
          // 0.2 而不是 0.4：这个场景是「按数据如实复述」，不是创作。
          // 实测 0.4 时模型会在「谁被 X 杀了」这类问题上补出不存在的情节。
          temperature: 0.2,
          // 硬上限：规则要求 300 字以内（中文约 450-600 token），给到 900 足够写完结论，
          // 又能物理上挡住「把上百行击杀记录原样抄一遍」这种失控输出——
          // 实测 2000 时模型会抄满上下文里的全部击杀行，撞不到上限就停不下来。
          max_tokens: 900,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            // 多轮记忆：只回放最近 12 条，控制 token
            ...history
              .slice(-12)
              .map((h) => ({ role: h.role === 'user' ? 'user' as const : 'assistant' as const, content: h.text })),
            {
              role: 'user',
              content: `${langHint}\n\n以下是本场 demo 的数据（每轮都附上，供核对）：\n\n${context}\n\n${history.length ? '用户上轮的问题你已回答过，请在已有讨论基础上继续。' : ''}\n问题：${question}`
            }
          ]
        }),
        signal: controller.signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let detail = ''
        try {
          const j = JSON.parse(text) as { error?: { message?: string }; message?: string }
          detail = j.error?.message || j.message || text.slice(0, 180)
        } catch {
          detail = text.slice(0, 180)
        }
        let hint = ''
        if (res.status === 401) hint = '（Key 无效或未激活）'
        else if (res.status === 403) hint = '（受地域限制或网络拦截，建议在设置中切换为「硅基流动」国内直连服务）'
        else if (res.status === 404) hint = '（模型名称或 API 路径不存在）'
        else if (res.status === 429) hint = '（请求频次或 Token 超限，建议切换模型或国内服务商）'
        throw new Error(`API 错误 ${res.status}${hint}: ${detail}`)
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
              this.cb.delta(demoId, chunk, sessionId, reqId)
            }
          } catch {
            /* 忽略坏行 */
          }
        }
      }
      this.cb.done(demoId, full, sessionId, reqId)
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? '已取消'
          : err instanceof Error
            ? err.message
            : String(err)
      this.cb.error(demoId, msg, sessionId, reqId)
    } finally {
      if (this.controller === controller) this.controller = null
    }
    return { started: true }
  }

  /** 开发/离线演示：基于真实数据本地生成结构化回答（不调用网络） */
  private askMock(
    demoId: string,
    question: string,
    d: DemoDetail,
    sessionId: string | undefined,
    requestId: string
  ): Promise<void> {
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
    // 模拟流式输出；返回 Promise 让 ask 的 finally 与真实流式保持一致
    return new Promise((resolve) => {
      let i = 0
      const timer = setInterval(() => {
        const step = 24
        const chunk = answer.slice(i, i + step)
        i += step
        if (chunk) this.cb.delta(demoId, chunk, sessionId, requestId)
        if (i >= answer.length) {
          clearInterval(timer)
          this.cb.done(demoId, answer, sessionId, requestId)
          resolve()
        }
      }, 24)
    })
  }
}
