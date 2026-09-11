/**
 * 真实 demo 解析器（deadem 纯 JS 引擎）
 * 解析: 地图/比分/回合/击杀/聊天/语音存在性/选手统计
 *
 * CS2 1.41 事件事实（经真实 demo 验证）:
 * - 回合边界: round_prestart / round_officially_ended（同 tick 触发）;
 *   首回合无 prestart（从首包 tick 隐式开始）
 * - round_end 事件已不存在; 胜负由炸弹事件 + 回合最后一杀推导
 * - 地图名: svc_ServerInfo.mapName
 * - 权威比分: CCSTeam.m_iScore; 队名 m_szTeamname
 * - 阵营: player_team 事件(userid, team 2=T 3=CT)
 */
import { createReadStream } from 'node:fs'
import { statSync } from 'node:fs'
import { PassThrough, type Readable } from 'node:stream'
import {
  InterceptorStage,
  MessagePacketType,
  Parser,
  ParserConfiguration,
  StringTableType
} from '@deademx/cs2'
import type {
  BuyType,
  ChatChannel,
  ChatMessage,
  KillEvent,
  PlayerInfo,
  RoundEconomy,
  RoundEndType,
  RoundInfo,
  RoundWinner,
  TeamSide
} from '@shared/types'

export interface ParseProgress {
  bytes: number
  total: number
}

export interface ParseResult {
  mapName?: string
  tickRate: number
  firstTick: number
  lastTick: number
  players: PlayerInfo[]
  rounds: RoundInfo[]
  chat: ChatMessage[]
  hasVoice: boolean
  voiceSec: number
  teamT?: string
  teamCT?: string
  scoreT: number
  scoreCT: number
}

const TICK_RATE = 64

// ─── 武器显示名 ─────────────────────────────────────────────────────────────

const WEAPON_NAMES: Record<string, string> = {
  ak47: 'AK-47',
  m4a4: 'M4A4',
  m4a1: 'M4A4',
  m4a1_silencer: 'M4A1-S',
  awp: 'AWP',
  ssg08: 'SSG 08',
  deagle: 'Desert Eagle',
  glock: 'Glock-18',
  usp_silencer: 'USP-S',
  hkp2000: 'P2000',
  p2000: 'P2000',
  p250: 'P250',
  fiveseven: 'Five-SeveN',
  tec9: 'Tec-9',
  cz75a: 'CZ75-A',
  cz75: 'CZ75-A',
  elite: 'Dual Berettas',
  revolver: 'R8 Revolver',
  mac10: 'MAC-10',
  mp9: 'MP9',
  mp7: 'MP7',
  mp5sd: 'MP5-SD',
  p90: 'P90',
  bizon: 'PP-Bizon',
  ump45: 'UMP-45',
  xm1014: 'XM1014',
  nova: 'Nova',
  sawedoff: 'Sawed-Off',
  mag7: 'MAG-7',
  m249: 'M249',
  negev: 'Negev',
  galilar: 'Galil AR',
  famas: 'FAMAS',
  sg556: 'SG 553',
  aug: 'AUG',
  scar20: 'SCAR-20',
  g3sg1: 'G3SG1',
  taser: 'Zeus x27',
  zeus: 'Zeus x27',
  knife: 'Knife',
  knife_t: 'Knife',
  bayonet: 'Knife',
  karambit: 'Knife',
  knife_karambit: 'Knife',
  knife_m9_bayonet: 'Knife',
  knife_butterfly: 'Knife',
  knife_falchion: 'Knife',
  knife_flip: 'Knife',
  knife_gut: 'Knife',
  knife_tactical: 'Knife',
  knife_push: 'Knife',
  knife_survival_bowie: 'Knife',
  knife_ursus: 'Knife',
  knife_gypsy_jackknife: 'Knife',
  knife_stiletto: 'Knife',
  knife_widowmaker: 'Knife',
  knife_canis: 'Knife',
  knife_cord: 'Knife',
  knife_skeleton: 'Knife',
  knife_outdoor: 'Knife',
  knife_kukri: 'Knife',
  knife_css: 'Knife',
  hegrenade: 'HE Grenade',
  molotov: 'Molotov',
  incgrenade: 'Incendiary',
  inferno: 'Molotov',
  flashbang: 'Flashbang',
  smokegrenade: 'Smoke',
  decoy: 'Decoy',
  c4: 'C4'
}

const CHAT_CHANNELS: Record<string, ChatChannel> = {
  Cstrike_Chat_All: 'ALL',
  Cstrike_Chat_AllDead: 'DEAD',
  Cstrike_Chat_AllSpec: 'SPEC',
  Cstrike_Chat_CT: 'CT',
  Cstrike_Chat_CT_Dead: 'CT',
  Cstrike_Chat_T: 'T',
  Cstrike_Chat_T_Dead: 'T'
}

/**
 * 武器名规范化：官方 demo 事件里是 ak47/hkp2000/m4a1_silencer 等；
 * 5E 等平台带皮肤前缀/后缀（5e_2024pass5_awp、hkp2000_txz04、ak47_tx12、5e_2024pass5_knife_skeleton），
 * 需剥掉皮肤部分再查表。
 */
function weaponName(raw: unknown): string {
  let s = String(raw ?? '').toLowerCase().trim()
  if (!s || s === 'world') return '—'
  if (s.startsWith('weapon_')) s = s.slice(7)
  if (WEAPON_NAMES[s]) return WEAPON_NAMES[s]
  // 剥 5E 等平台皮肤前缀（如 5e_2024pass5_ / 5e_2025_）与 _tx12/_txz04/_vip 等皮肤后缀
  const stripped = s
    .replace(/^5e_20\d{2}pass\d+_/, '')
    .replace(/^5e_[a-z0-9]+_/, '')
    .replace(/_(txz?\d*|fm\d*|vip|gold|blood|dawn|volt|emerald|chroma|prem|elite|s\d+)$/, '')
  if (WEAPON_NAMES[stripped]) return WEAPON_NAMES[stripped]
  // 若剥除后仍残留类似 _txz04 / _tx01 之类的下划线后缀变种，尝试去掉末尾 _xxx 再次查表
  const baseName = stripped.replace(/_[a-z0-9]+$/, '')
  if (baseName && WEAPON_NAMES[baseName]) return WEAPON_NAMES[baseName]
  // 兜底：从长到短匹配已知武器名子串（如 5e_2024pass5_knife_skeleton → knife）
  const keys = Object.keys(WEAPON_NAMES).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (stripped.includes(k) || s.includes(k)) return WEAPON_NAMES[k]
  }
  if (stripped.includes('knife') || s.includes('knife') || stripped.includes('bayonet')) return 'Knife'
  return s
}

// ─── 内部累积结构 ────────────────────────────────────────────────────────────

interface PlayerSlot {
  userid: number
  name: string
  steamId?: string
  slot?: number
  team: TeamSide
  kills: number
  deaths: number
  assists: number
  headshots: number
  mvp: number
  avatar?: string
  flashAssists: number
}

interface RoundAcc {
  roundNum: number
  startTick: number
  endTick?: number
  winner: RoundWinner
  endType: RoundEndType
  kills: KillEvent[]
  bombPlantedTick?: number
  bombDefusedTick?: number
  bombExplodedTick?: number
  economy?: RoundEconomy
  firstKill?: KillEvent
}

interface EventKey {
  type?: number
  valString?: string
  valFloat?: number
  valLong?: number | bigint
  valShort?: number
  valByte?: number
  valBool?: boolean
  valUint64?: number | bigint
}

function valueOf(key: EventKey | null | undefined): unknown {
  if (key === null || key === undefined) return null
  switch (key.type) {
    case 1: return key.valString
    case 2: return key.valFloat
    case 3: return key.valLong
    case 4: return key.valShort
    case 5: return key.valByte
    case 6: return key.valBool
    case 7: return key.valUint64
    case 8: return key.valLong
    case 9: return key.valShort
    default: return null
  }
}

function zipEvent(descriptor: { keys: { name: string }[] }, keys: (EventKey | null)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < descriptor.keys.length; i++) {
    out[descriptor.keys[i].name] = valueOf(keys[i])
  }
  return out
}

const int = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

function normalizeTeamName(name: string): string | undefined {
  if (!name) return undefined
  if (name === 'TERRORIST') return 'T'
  if (name === 'COUNTER-TERRORIST' || name === 'CT') return 'CT'
  return name
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────

export async function parseDemo(
  filePath: string,
  onProgress?: (p: ParseProgress) => void,
  onPhase?: (phase: string) => void
): Promise<ParseResult> {
  onPhase?.('parse')
  const stream = createReadStream(filePath, { highWaterMark: 512 * 1024 })
  const total = statSync(filePath).size
  const counter = new PassThrough()
  let bytes = 0
  let lastReport = 0
  counter.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes - lastReport > total / 50) {
      lastReport = bytes
      onProgress?.({ bytes, total })
    }
  })
  stream.pipe(counter)

  const parser = new Parser(
    new ParserConfiguration({
      messagePacketTypes: [
        MessagePacketType.SVC_SERVER_INFO,
        MessagePacketType.SVC_CREATE_STRING_TABLE,
        MessagePacketType.SVC_UPDATE_STRING_TABLE,
        MessagePacketType.SVC_VOICE_DATA,
        MessagePacketType.SVC_PACKET_ENTITIES,
        MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST,
        MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT,
        MessagePacketType.USER_MESSAGE_SAY_TEXT_2
      ],
      entityClasses: ['CCSPlayerController', 'CCSTeam', 'CCSGameRulesProxy', 'CCSPlayerPawn']
    })
  )

  const playersByUserid = new Map<number, PlayerSlot>()
  // ★实时阵营跟踪: uid → 当前阵营（parse 过程中每 32 tick 从 CCSPlayerController 实体采样。
  //   CS2 demo 的 player_team 事件从不触发（描述符存在但 0 条），实体 m_iTeamNum 是唯一可靠
  //   且实时（换边 tick 全体翻转）的阵营来源。击杀用「当时」快照着色 → 上半场黄/下半场蓝正确。）
  //   同时维护 名字 → 阵营（5E 平台个别玩家击杀事件 uid 与实体 idx 存在 -1 偏移，如
  //   "我也要打残局么" 击杀 uid=3 但实体 idx=4；名字兜底解决）
  const teamNowByUid = new Map<number, TeamSide>()
  const teamNowByName = new Map<string, TeamSide>()
  // ★回合开始阵营分配（round_prestart 时从实体读取；比 32 tick 采样更精确，换边对齐回合）
  const roundTeamByUid = new Map<number, TeamSide>()
  const roundTeamByName = new Map<string, TeamSide>()
  // ★最近实体快照（每 32 tick）：idx → 名字/阵营。击杀名字/阵营直接用此快照 →
  //   完全绕过 USER_INFO 编号错位（5E 平台 USER_INFO userid 与实体 idx 不对应，
  //   曾导致 uid=8 击杀被回填成"圣洁首脑"）
  const idxNameNow = new Map<number, string>()
  const idxTeamNow = new Map<number, TeamSide>()
  // CS2 底层槽位 (0~63)：供 tv_listen_voice_indices 位掩码消音
  const slotBySteamId = new Map<string, number>()
  const slotByName = new Map<string, number>()
  // ★上半场分配（R1 采样）与名字；R13+ 按回合号翻转（换边时刻实体采样不可靠）
  const firstHalfTeams = new Map<number, TeamSide>()
  const firstHalfNames = new Map<number, string>()
  // 开局阵营（按名字）：选手数据表显示「开局阵营」（黄=开局匪 T，蓝=开局警 CT）
  const firstHalfTeamByName = new Map<string, TeamSide>()
  let prestartCount = 0
  // ★pawn 实体阵营（击杀句柄低 12 位 = pawn 索引；击杀时刻权威阵营）
  const pawnIdxTeam = new Map<number, TeamSide>()
  const descriptors = new Map<number, { keys: { name: string }[]; name?: string }>()
  const chat: RawChat[] = []
  let voiceCount = 0
  // 真实累计语音时长：收集「有语音数据的 tick」去重累加（同 tick 多帧只算一次），
  // 而非首尾跨度（跨度会把静音/游戏过程也算进去，导致「语音 1700s」的假象）
  const voiceTicks = new Set<number>()
  let firstTick = Infinity
  let lastTick = 0
  let mapName: string | undefined
  let userInfoLoaded = false

  // ★伤害统计（player_hurt 事件累加，截断至有效伤害，过滤队友误伤）
  const playerDamage = new Map<string, number>()
  const damageByName = new Map<string, number>()
  // roundVictimDamage: `${roundNum}:${victimKey}` -> attackerKey -> dmg（用于助攻与 KAST 判定）
  const roundVictimDamage = new Map<string, Map<string, number>>()

  // ★投掷物伤害统计（HE手雷、燃烧弹、火）
  const playerUtilityDamage = new Map<string, number>()
  const utilityDamageByName = new Map<string, number>()

  // ★闪光致盲统计（敌方致盲 vs 队友误闪）
  const enemyBlindCountByName = new Map<string, number>()
  const enemyBlindDurationByName = new Map<string, number>()
  const teamBlindCountByName = new Map<string, number>()
  const teamBlindDurationByName = new Map<string, number>()

  // ★首杀 / 首死统计
  const firstKillsByName = new Map<string, number>()
  const firstDeathsByName = new Map<string, number>()

  // ★连败补偿状态机（MR12 官方规则：$1400~$3400，每胜-1，每负+1；R13换边重置）
  const LOSS_BONUS_TABLE = [1400, 1900, 2400, 2900, 3400]
  const getLossBonus = (level: number) => LOSS_BONUS_TABLE[Math.max(0, Math.min(4, level))]
  let lossStreakT = 0
  let lossStreakCT = 0

  // 回合累积: 首回合从 firstTick 隐式开始
  let currentRound: RoundAcc = {
    roundNum: 1,
    startTick: 0,
    winner: 'none',
    endType: 'unknown',
    kills: []
  }
  const rounds: RoundAcc[] = []
  let roundsStarted = false
  let lastBeginNewMatchTick = -1
  let lastMatchStartTick = -1

  /** 从 CCSPlayerController 实体采样当前回合双方装备消费与资金 */
  const sampleEconomy = (round: RoundAcc) => {
    if (round.economy) return
    try {
      const demo = parser.getDemo()
      const controllers = demo.getEntitiesByClassName('CCSPlayerController') as unknown as {
        _index: number
        getField(name: string): unknown
      }[]
      let tSpent = 0, tStart = 0
      let ctSpent = 0, ctStart = 0
      for (const c of controllers) {
        const name = str(c.getField('m_iszPlayerName'))
        if (!name || name === 'SourceTV' || name === 'GOTV' || name === '5EGOTV' || name === '完美世界竞技平台CSTV') continue
        const uid = c._index
        const team = roundTeamByName.get(name) ?? roundTeamByUid.get(uid) ?? (int(c.getField('m_iTeamNum')) === 2 ? 'T' : int(c.getField('m_iTeamNum')) === 3 ? 'CT' : 'NONE')
        const spent = int(c.getField('m_pInGameMoneyServices.m_iCashSpentThisRound'))
        const start = int(c.getField('m_pInGameMoneyServices.m_iStartAccount'))
        if (team === 'T') {
          tSpent += spent
          tStart += start
        } else if (team === 'CT') {
          ctSpent += spent
          ctStart += start
        }
      }

      const isPistol = round.roundNum === 1 || round.roundNum === 13
      const getBuyType = (spent: number, start: number, isPistolRound: boolean): BuyType => {
        if (isPistolRound) return 'eco'
        if (spent >= 16000) return 'full'
        if (spent < 6000 && start > 12000) return 'eco'
        if (spent < 4000) return 'eco'
        if (start > 0 && spent / start >= 0.7 && spent < 16000) return 'force'
        return 'semi'
      }

      round.economy = {
        t: {
          equipValue: tSpent,
          startCash: tStart,
          spentCash: tSpent,
          buyType: getBuyType(tSpent, tStart, isPistol),
          lossBonusLevel: lossStreakT,
          lossBonusAmount: getLossBonus(lossStreakT)
        },
        ct: {
          equipValue: ctSpent,
          startCash: ctStart,
          spentCash: ctSpent,
          buyType: getBuyType(ctSpent, ctStart, isPistol),
          lossBonusLevel: lossStreakCT,
          lossBonusAmount: getLossBonus(lossStreakCT)
        }
      }
    } catch {
      /* 实体读取失败时兜底 */
    }
  }

  const closeRound = (endTick: number) => {
    const r = currentRound
    r.endTick = endTick
    // 胜负推导: 炸弹事件 > 回合最后一杀
    if (r.bombExplodedTick !== undefined) {
      r.winner = 'T'
      r.endType = 'bomb_exploded'
    } else if (r.bombDefusedTick !== undefined) {
      r.winner = 'CT'
      r.endType = 'bomb_defused'
    } else {
      const lastKill = r.kills[r.kills.length - 1]
      if (lastKill && lastKill.victimTeam !== 'NONE') {
        r.winner = lastKill.victimTeam === 'T' ? 'CT' : 'T'
        r.endType = 'elimination'
      } else {
        r.winner = 'none'
        r.endType = r.kills.length ? 'elimination' : 'timeout'
      }
    }

    // 经济采样收尾
    if (!r.economy) {
      sampleEconomy(r)
    }
    if (!r.economy) {
      const isPistol = r.roundNum === 1 || r.roundNum === 13
      r.economy = {
        t: {
          equipValue: 0,
          startCash: 0,
          spentCash: 0,
          buyType: isPistol ? 'eco' : 'semi',
          lossBonusLevel: lossStreakT,
          lossBonusAmount: getLossBonus(lossStreakT)
        },
        ct: {
          equipValue: 0,
          startCash: 0,
          spentCash: 0,
          buyType: isPistol ? 'eco' : 'semi',
          lossBonusLevel: lossStreakCT,
          lossBonusAmount: getLossBonus(lossStreakCT)
        }
      }
    }

    // 连败状态机更新
    if (r.winner === 'T') {
      lossStreakT = Math.max(0, lossStreakT - 1)
      lossStreakCT = Math.min(4, lossStreakCT + 1)
    } else if (r.winner === 'CT') {
      lossStreakCT = Math.max(0, lossStreakCT - 1)
      lossStreakT = Math.min(4, lossStreakT + 1)
    }
    // R12 结束（即上半场打完）：连败等级重置
    if (r.roundNum === 12) {
      lossStreakT = 0
      lossStreakCT = 0
    }

    rounds.push(r)
  }

  const startRound = (tick: number) => {
    if (roundsStarted) {
      closeRound(tick) // 上一回合已由 round_officially_ended 记录 endTick 时此处直接收尾
    } else if (
      // ★CS2 首回合没有 round_prestart（首回合隐式从首包开始）：首个 prestart 到来前
      //   currentRound 里已有击杀/炸弹 = 真实首回合（手枪局）→ 先闭合收进 rounds，
      //   否则会被下方覆盖丢失（5E/完美 demo 无 begin_new_match 时必然触发）
      currentRound.kills.length > 0 ||
      currentRound.bombPlantedTick !== undefined
    ) {
      closeRound(tick)
    }
    roundsStarted = true
    currentRound = {
      roundNum: rounds.length + 1,
      startTick: tick,
      winner: 'none',
      endType: 'unknown',
      kills: []
    }
  }

  const handleGameEvent = (eventId: number, keys: (EventKey | null)[], tick: number) => {
    const descriptor = descriptors.get(eventId)
    if (!descriptor) return
    const name = descriptor.name ?? ''
    const ev = zipEvent(descriptor, keys)

    switch (name) {
      case 'round_prestart': {
        // ★每回合开始：从实体读取本回合 T/CT 分配。CS2 竞技固定：R1-12 一队恒 T 另一队恒
        //   CT，R13 换边翻转。round_prestart 采样在换边时刻可能读到翻转后的实体（换边发生在
        //   回合间隙），因此用「R1 分配 + 回合号」推导：R1 采样 = 上半场分配，R13+ 翻转。
        try {
          const demo = parser.getDemo()
          const controllers = demo.getEntitiesByClassName('CCSPlayerController') as unknown as {
            _index: number
            getField(name: string): unknown
          }[]
          const sampled = new Map<number, TeamSide>()
          for (const c of controllers) {
            const name = str(c.getField('m_iszPlayerName'))
            if (!name || name === 'SourceTV' || name === 'GOTV' || name === '5EGOTV' || name === '完美世界竞技平台CSTV') continue
            const uid = c._index
            const teamN = int(c.getField('m_iTeamNum'))
            const team: TeamSide = teamN === 2 ? 'T' : teamN === 3 ? 'CT' : 'NONE'
            if (team !== 'NONE') sampled.set(uid, team)
          }
          if (sampled.size >= 2) {
            prestartCount++
            if (firstHalfTeams.size === 0) {
              // 首次采样（R1）→ 上半场分配
              for (const [uid, team] of sampled) firstHalfTeams.set(uid, team)
            }
            // 本回合分配：前 12 回合用上半场分配；R13+ 翻转。
            // ★回合号 = rounds.length + 1（startRound 即将赋的 roundNum，含隐式首回合
            //   时自动 +1）：换边以真实回合号为准，prestartCount 在无 begin_new_match 的
            //   demo 里会差一（首个 prestart 是 R2 而非 R1）
            const isSecondHalf = rounds.length + 1 > 12
            roundTeamByUid.clear()
            roundTeamByName.clear()
            for (const [uid, team] of firstHalfTeams) {
              const t: TeamSide = isSecondHalf ? (team === 'T' ? 'CT' : 'T') : team
              roundTeamByUid.set(uid, t)
            }
            // 名字映射（R1 采样）
            if (firstHalfNames.size === 0) {
              for (const c of controllers) {
                const name = str(c.getField('m_iszPlayerName'))
                if (!name) continue
                firstHalfNames.set(c._index, name)
              }
            }
            // 开局阵营（按名字）：供选手数据表显示「开局阵营」（黄=开局匪，蓝=开局警）
            if (firstHalfTeamByName.size === 0) {
              for (const [uid, name] of firstHalfNames) {
                const t = firstHalfTeams.get(uid)
                if (t) firstHalfTeamByName.set(name, t)
              }
            }
            for (const [uid, name] of firstHalfNames) {
              const t = roundTeamByUid.get(uid)
              if (t) roundTeamByName.set(name, t)
            }
            void sampled
          }
        } catch {
          /* 实体读取失败时沿用上一回合分配 */
        }
        startRound(tick)
        break
      }
      case 'begin_new_match': {
        lastBeginNewMatchTick = tick
        break
      }
      case 'round_announce_match_start': {
        lastMatchStartTick = tick
        break
      }
      case 'round_officially_ended': {
        if (currentRound.endTick === undefined) currentRound.endTick = tick
        break
      }
      case 'player_team': {
        const uid = int(ev.userid)
        const teamN = int(ev.team)
        const slot = playersByUserid.get(uid)
        if (slot && (teamN === 2 || teamN === 3)) {
          slot.team = teamN === 2 ? 'T' : 'CT'
        }
        break
      }
      case 'player_death': {
        const attacker = int(ev.attacker)
        const victim = int(ev.userid)
        // ★★超级简单解法：击杀事件的 userid 直接对应 USER_INFO 表的 userid（CS2 官方协议）！
        //   USER_INFO: userid=3→我也要打残局么、4→多喝热水啊. ...（与实体 _index 有 -1 偏移，
        //   实体 idx 映射是错位根源）。名字/steamId 一律查 USER_INFO（playersByUserid）；
        //   阵营用 pawn 句柄（低 12 位 = pawn 实体索引 → 击杀时刻权威 team）。
        const aInfo = attacker !== 65535 ? playersByUserid.get(attacker) : undefined
        const vInfo = victim !== 65535 ? playersByUserid.get(victim) : undefined
        const aName = aInfo?.name
        const vName = vInfo?.name
        const aPawnTeam = pawnIdxTeam.get(int(ev.attacker_pawn) & 0xfff)
        const vPawnTeam = pawnIdxTeam.get(int(ev.userid_pawn) & 0xfff)
        const kill: KillEvent = {
          tick,
          timeSec: tick / TICK_RATE,
          attackerUid: attacker,
          attackerSteamId: aInfo?.steamId,
          attackerName: aName,
          // ★击杀时刻阵营：用「名字 → 回合分配」（R1 采样 + R13 换边翻转，100% 一致率验证），
          //   pawn 句柄低 12 位在换边后可能映射到错误 pawn 实体（索引复用），仅作兜底
          attackerTeam:
            (aName ? roundTeamByName.get(aName) : undefined) ??
            aPawnTeam ??
            'NONE',
          victimUid: victim,
          victimSteamId: vInfo?.steamId,
          victimName: vName,
          victimTeam:
            (vName ? roundTeamByName.get(vName) : undefined) ??
            vPawnTeam ??
            'NONE',
          assisterUid: int(ev.assister) !== 65535 ? int(ev.assister) : undefined,
          weapon: weaponName(ev.weapon),
          headshot: Boolean(ev.headshot),
          throughSmoke: Boolean(ev.thrusmoke),
          penetrated: int(ev.penetrated) > 0,
          noScope: Boolean(ev.noscope),
          flashAssist: Boolean(ev.assistedflash),
          attackerBlind: Boolean(ev.attackerblind),
          roundNum: currentRound.roundNum
        }
        // 隐式首回合（首个 prestart 到来前）只保留比赛开始后的击杀：
        // 热身击杀不属于任何真实回合，进 R1 会污染手枪局数据
        if (!roundsStarted) {
          const matchStartForImplicit =
            lastBeginNewMatchTick >= 0 ? lastBeginNewMatchTick : lastMatchStartTick
          if (matchStartForImplicit >= 0 && tick < matchStartForImplicit) break
        }

        // ★首杀/首死追踪（排除热身阶段与自杀/阵营未知的非正常击杀）
        if (
          !currentRound.firstKill &&
          kill.attackerTeam !== 'NONE' &&
          kill.victimTeam !== 'NONE' &&
          kill.attackerTeam !== kill.victimTeam
        ) {
          currentRound.firstKill = kill
          if (kill.attackerName) {
            firstKillsByName.set(kill.attackerName, (firstKillsByName.get(kill.attackerName) ?? 0) + 1)
          }
          if (kill.victimName) {
            firstDeathsByName.set(kill.victimName, (firstDeathsByName.get(kill.victimName) ?? 0) + 1)
          }
        }

        // 中途不做统计（5E 的 USER_INFO/实体编号可能错位，统计在解析完成后统一按最终玩家表计算）
        currentRound.kills.push(kill)
        break
      }
      case 'player_hurt': {
        const attacker = int(ev.attacker)
        const victim = int(ev.userid)
        if (attacker === 65535 || attacker === victim) break

        const aInfo = playersByUserid.get(attacker)
        const vInfo = playersByUserid.get(victim)
        const aName = aInfo?.name
        const vName = vInfo?.name
        const aPawnTeam = pawnIdxTeam.get(int(ev.attacker_pawn) & 0xfff)
        const vPawnTeam = pawnIdxTeam.get(int(ev.userid_pawn) & 0xfff)
        const aTeam = (aName ? roundTeamByName.get(aName) : undefined) ?? aPawnTeam ?? 'NONE'
        const vTeam = (vName ? roundTeamByName.get(vName) : undefined) ?? vPawnTeam ?? 'NONE'

        // 过滤友军伤害
        if (aTeam !== 'NONE' && vTeam !== 'NONE' && aTeam === vTeam) break

        const rawDmg = int(ev.dmg_health)
        const postHealth = int(ev.health)
        const preHealth = postHealth + rawDmg
        const effectiveDmg = Math.max(0, Math.min(preHealth, rawDmg))
        if (effectiveDmg <= 0) break

        const aKey = aInfo?.steamId || aName
        if (aKey) {
          playerDamage.set(aKey, (playerDamage.get(aKey) ?? 0) + effectiveDmg)
          if (aName) {
            damageByName.set(aName, (damageByName.get(aName) ?? 0) + effectiveDmg)
          }

          // ★ 投掷物伤害判定（高爆手雷、燃烧弹、火）
          const weaponStr = String(ev.weapon ?? '').toLowerCase()
          const isUtility = ['hegrenade', 'inferno', 'molotov', 'incgrenade', 'decoy'].some((u) =>
            weaponStr.includes(u)
          )
          if (isUtility) {
            playerUtilityDamage.set(aKey, (playerUtilityDamage.get(aKey) ?? 0) + effectiveDmg)
            if (aName) {
              utilityDamageByName.set(aName, (utilityDamageByName.get(aName) ?? 0) + effectiveDmg)
            }
          }
        }

        if (aKey && (vInfo?.steamId || vName)) {
          const vKey = vInfo?.steamId || vName!
          const assistKey = `${currentRound.roundNum}:${vKey}`
          let aMap = roundVictimDamage.get(assistKey)
          if (!aMap) {
            aMap = new Map()
            roundVictimDamage.set(assistKey, aMap)
          }
          aMap.set(aKey, (aMap.get(aKey) ?? 0) + effectiveDmg)
        }
        break
      }
      case 'player_blind': {
        if (!roundsStarted) {
          const matchStartForImplicit =
            lastBeginNewMatchTick >= 0 ? lastBeginNewMatchTick : lastMatchStartTick
          if (matchStartForImplicit >= 0 && tick < matchStartForImplicit) break
        }
        const attacker = int(ev.attacker)
        const victim = int(ev.userid)
        if (attacker === 65535 || attacker === 0) break
        const blindDur =
          typeof ev.blind_duration === 'number'
            ? ev.blind_duration
            : Number(ev.blind_duration) || 0
        if (blindDur <= 0.05) break

        const aInfo = playersByUserid.get(attacker)
        const vInfo = playersByUserid.get(victim)
        const aName = aInfo?.name
        const vName = vInfo?.name
        const aPawnTeam = pawnIdxTeam.get(attacker & 0xfff)
        const vPawnTeam = pawnIdxTeam.get(victim & 0xfff)
        const aTeam = (aName ? roundTeamByName.get(aName) : undefined) ?? aPawnTeam ?? 'NONE'
        const vTeam = (vName ? roundTeamByName.get(vName) : undefined) ?? vPawnTeam ?? 'NONE'

        if (aName && aTeam !== 'NONE' && vTeam !== 'NONE') {
          if (aTeam !== vTeam) {
            // 敌方致盲
            enemyBlindCountByName.set(aName, (enemyBlindCountByName.get(aName) ?? 0) + 1)
            enemyBlindDurationByName.set(
              aName,
              (enemyBlindDurationByName.get(aName) ?? 0) + blindDur
            )
          } else if (attacker !== victim) {
            // 友军误闪
            teamBlindCountByName.set(aName, (teamBlindCountByName.get(aName) ?? 0) + 1)
            teamBlindDurationByName.set(
              aName,
              (teamBlindDurationByName.get(aName) ?? 0) + blindDur
            )
          }
        }
        break
      }
      case 'round_freeze_end': {
        sampleEconomy(currentRound)
        break
      }
      case 'bomb_planted': {
        currentRound.bombPlantedTick = tick
        break
      }
      case 'bomb_defused': {
        currentRound.bombDefusedTick = tick
        break
      }
      case 'bomb_exploded': {
        currentRound.bombExplodedTick = tick
        break
      }
      default:
        break
    }
  }

  parser.registerPostInterceptor(InterceptorStage.DEMO_PACKET, async (demoPacket) => {
    if (demoPacket.getIsInitial()) return
    const tick = demoPacket.tick
    if (tick < firstTick) firstTick = tick
    if (tick > lastTick) lastTick = tick
    if (!roundsStarted && firstTick !== Infinity) {
      currentRound.startTick = firstTick
    }

    if (!userInfoLoaded) {
      userInfoLoaded = true
      const table = parser.getDemo().stringTableContainer.getByName(StringTableType.USER_INFO.name)
      if (table) {
        for (const entry of table.getEntries()) {
          const value = entry.value as { userid?: number; name?: string; steamid?: unknown }
          if (value && Number.isInteger(value.userid)) {
            const uid = value.userid as number
            const name = typeof value.name === 'string' ? value.name : `player${uid}`
            if (name === 'SourceTV' || name === 'GOTV') continue
            playersByUserid.set(uid, {
              userid: uid,
              name,
              steamId: value.steamid ? String(value.steamid) : undefined,
              team: 'NONE',
              kills: 0,
              deaths: 0,
              assists: 0,
              headshots: 0,
              mvp: 0,
              flashAssists: 0
            })
          }
        }
      }
      // 注：Steam 头像匹配移到「完成后补全玩家」之后（玩家表最终确定后再挂）
      // 注：5E 等平台的完整玩家列表在 parse 结束后才可从实体读取（解析中途实体不全），
      // 完成后补全逻辑见「完成后补全玩家」段落。
    }

    // ★USER_INFO 持续刷新（CS2 协议：击杀事件 userid 直接对应 USER_INFO 表 userid；
    //   表是渐进填充的，首个包可能不完整——每次字符串表更新时同步 name/steamId）
    try {
      const table = parser.getDemo().stringTableContainer.getByName(StringTableType.USER_INFO.name)
      if (table) {
        for (const entry of table.getEntries()) {
          const value = entry.value as { userid?: number; name?: string; steamid?: unknown }
          if (!value || !Number.isInteger(value.userid)) continue
          const uid = value.userid as number
          const name = typeof value.name === 'string' ? value.name : `player${uid}`
          if (name === 'SourceTV' || name === 'GOTV' || name === '5EGOTV' || name === '完美世界竞技平台CSTV') continue
          const slot = playersByUserid.get(uid)
          if (slot) {
            // 已有条目（首个包创建）：名字/steamId 以最新 USER_INFO 为准
            if (name !== slot.name) slot.name = name
            if (!slot.steamId && value.steamid) slot.steamId = String(value.steamid)
          } else {
            playersByUserid.set(uid, {
              userid: uid,
              name,
              steamId: value.steamid ? String(value.steamid) : undefined,
              team: 'NONE',
              kills: 0,
              deaths: 0,
              assists: 0,
              headshots: 0,
              mvp: 0,
              flashAssists: 0
            })
          }
        }
      }
    } catch {
      /* USER_INFO 可选 */
    }

    // ★实时阵营 + 玩家表采样（每 32 tick）：
    //   CS2 demo 不触发 player_team 事件；CCSPlayerController.m_iTeamNum 是唯一可靠且
    //   实时（换边 tick 全体翻转）的阵营来源。同时用实体补全名字/steamID（USER_INFO 在
    //   5E 平台编号错位，实体 _index 与击杀事件 userid 一一对应）。
    //   ★pawn 实体（CCSPlayerPawn）m_iTeamNum 亦实时——击杀事件的 userid_pawn/
    //   attacker_pawn 句柄低 12 位 = pawn 实体索引 → 击杀时刻的权威阵营
    //   （5E demo 的击杀 userid 与 controller _index 存在漂移，pawn 句柄最可靠）
    if (tick % 32 === 0) {
      try {
        const demo = parser.getDemo()
        const controllers = demo.getEntitiesByClassName('CCSPlayerController') as unknown as {
          _index: number
          getField(name: string): unknown
        }[]
        // pawn 实体阵营快照（句柄低 12 位 = pawn 索引）
        try {
          const pawns = demo.getEntitiesByClassName('CCSPlayerPawn') as unknown as {
            _index: number
            getField(name: string): unknown
          }[]
          for (const p of pawns) {
            const teamN = int(p.getField('m_iTeamNum'))
            if (teamN === 2 || teamN === 3) pawnIdxTeam.set(p._index, teamN === 2 ? 'T' : 'CT')
          }
        } catch {
          /* pawn 实体可选 */
        }
        for (const c of controllers) {
          const name = str(c.getField('m_iszPlayerName'))
          if (!name || name === 'SourceTV' || name === 'GOTV' || name === '5EGOTV' || name === '完美世界竞技平台CSTV') continue
          const entIdx = c._index
          const teamN = int(c.getField('m_iTeamNum'))
          const team: TeamSide = teamN === 2 ? 'T' : teamN === 3 ? 'CT' : 'NONE'
          idxNameNow.set(entIdx, name)
          if (team !== 'NONE') {
            teamNowByUid.set(entIdx, team)
            teamNowByName.set(name, team)
            idxTeamNow.set(entIdx, team)
          }
          const rawSteamId = c.getField('m_steamID')
          const steamId = rawSteamId && rawSteamId !== 0n && rawSteamId !== '0' ? String(rawSteamId) : undefined
          const entitySlot = entIdx >= 1 && entIdx <= 64 ? entIdx - 1 : undefined
          if (entitySlot !== undefined) {
            if (steamId && !slotBySteamId.has(steamId)) slotBySteamId.set(steamId, entitySlot)
            if (name && !slotByName.has(name)) slotByName.set(name, entitySlot)
          }

          // 匹配 playersByUserid：切勿用实体索引 c._index 作为 USER_INFO 的 userid 查询！
          // 实体 _index 与 USER_INFO userid 存在偏移（如实体 4~13 对应 USER_INFO 3~12）。
          // 正确匹配方式：优先按 steamId 匹配，其次按玩家名字（去首尾空格）匹配。
          let slot: PlayerSlot | undefined
          if (steamId && steamId.startsWith('7656119')) {
            for (const s of playersByUserid.values()) {
              if (s.steamId === steamId) {
                slot = s
                break
              }
            }
          }
          if (!slot && name) {
            const trimmed = name.trim()
            for (const s of playersByUserid.values()) {
              if (s.name === name || s.name.trim() === trimmed) {
                slot = s
                break
              }
            }
          }

          if (slot) {
            // 已有条目：不覆盖名字（USER_INFO/击杀名优先；实体名可能中途变化），只补 team/steamId/slot
            if (!slot.steamId && steamId) slot.steamId = steamId
            if (slot.team === 'NONE' && team !== 'NONE') slot.team = team
            if (entitySlot !== undefined) slot.slot = entitySlot
          } else if (steamId && steamId.startsWith('7656119')) {
            // USER_INFO 中可能遗漏人类选手，赋予安全键存入
            const safeKey = playersByUserid.has(entIdx) ? 1000 + entIdx : entIdx
            playersByUserid.set(safeKey, {
              userid: safeKey,
              name,
              steamId,
              slot: entitySlot,
              team,
              kills: 0,
              deaths: 0,
              assists: 0,
              headshots: 0,
              mvp: 0,
              flashAssists: 0
            })
          }
        }
      } catch {
        /* 实体读取失败时忽略（USER_INFO 兜底） */
      }
    }
  })

  parser.registerPostInterceptor(
    InterceptorStage.MESSAGE_PACKET,
    async (demoPacket, messagePacket) => {
      if (!messagePacket) return
      const tick = demoPacket.tick

      switch (messagePacket.type) {
        case MessagePacketType.SVC_SERVER_INFO: {
          const data = messagePacket.data as { mapName?: string }
          mapName = data.mapName
          break
        }
        case MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT_LIST: {
          const data = messagePacket.data as {
            descriptors: { eventid: number; name?: string; keys: { name: string }[] }[]
          }
          for (const d of data.descriptors) descriptors.set(d.eventid, d)
          break
        }
        case MessagePacketType.GE_SOURCE1_LEGACY_GAME_EVENT: {
          const data = messagePacket.data as { eventid: number; keys: (EventKey | null)[] }
          handleGameEvent(data.eventid, data.keys, tick)
          break
        }
        case MessagePacketType.USER_MESSAGE_SAY_TEXT_2: {
          const data = messagePacket.data as { messagename?: string; param1?: string; param2?: string }
          chat.push({
            tick,
            timeSec: tick / TICK_RATE,
            channel: CHAT_CHANNELS[str(data.messagename)] ?? 'ALLCHAT',
            playerName: str(data.param1),
            text: str(data.param2),
            roundNum: currentRound.roundNum
          })
          break
        }
        case MessagePacketType.SVC_VOICE_DATA: {
          voiceCount++
          voiceTicks.add(tick)
          const d = messagePacket.data as { entity?: number; clientDeprecated?: number; xuid?: unknown } | null
          if (d) {
            const ent = Number.isInteger(d.entity) && (d.entity as number) >= 1 && (d.entity as number) <= 64
              ? (d.entity as number)
              : Number.isInteger(d.clientDeprecated) && (d.clientDeprecated as number) >= 0 && (d.clientDeprecated as number) < 64
                ? (d.clientDeprecated as number) + 1
                : 0
            if (ent > 0) {
              const voiceSlot = ent - 1
              const xuidStr = d.xuid != null ? String(d.xuid) : ''
              if (xuidStr && !slotBySteamId.has(xuidStr)) {
                slotBySteamId.set(xuidStr, voiceSlot)
              }
            }
          }
          break
        }
        default:
          break
      }
    }
  )

  try {
    await parser.parse(counter as unknown as Readable)
  } catch (err) {
    stream.destroy()
    counter.destroy()
    await parser.dispose().catch(() => {})
    throw err
  }

  // 闭合末回合
  closeRound(lastTick)

  // 过滤预热/伪回合
  const minStartTick =
    lastBeginNewMatchTick >= 0
      ? lastBeginNewMatchTick - 64 * 3
      : lastMatchStartTick >= 0
        ? lastMatchStartTick - 64 * 30
        : -1
  const realRounds = rounds.filter(
    (r) =>
      (minStartTick < 0 || r.startTick >= minStartTick) &&
      (r.endTick ?? lastTick) - r.startTick >= 64 * 5
  )
  realRounds.forEach((r, i) => {
    r.roundNum = i + 1
  })

  // 完成后补全玩家：★USER_INFO 表是玩家身份权威（击杀 userid 直接对应），
  // 实体 _index 与 USER_INFO userid 存在偏移（5E: 实体 4-13 ↔ USER_INFO 3-12），
  // 因此不再用实体 idx 重建/覆盖玩家表（那是错位根源）。实体仅用于：
  //   ① 击杀阵营（pawn 句柄，击杀时刻已取）
  //   ② 玩家表 team 兜底（按名字匹配，见后）
  try {
    const demo = parser.getDemo()
    const controllers = demo.getEntitiesByClassName('CCSPlayerController') as unknown as {
      _index: number
      getField(name: string): unknown
    }[]
    for (const c of controllers) {
      const name = str(c.getField('m_iszPlayerName') ?? c.getField('m_szPlayerName'))
      if (!name || name === 'SourceTV' || name === 'GOTV' || name === '5EGOTV' || name === '完美世界竞技平台CSTV') continue
      const teamN = int(c.getField('m_iTeamNum'))
      const team: TeamSide = teamN === 2 ? 'T' : teamN === 3 ? 'CT' : 'NONE'
      const rawSteamId = c.getField('m_steamID')
      const steamId = rawSteamId && rawSteamId !== 0n && rawSteamId !== '0' ? String(rawSteamId) : undefined
      const entIdx = c._index
      const entitySlot = entIdx >= 1 && entIdx <= 64 ? entIdx - 1 : undefined

      // 按 steamId 或名字匹配补 team 与 slot（USER_INFO 表有该玩家时）
      const trimmed = name.trim()
      let slot = steamId && steamId.startsWith('7656119')
        ? [...playersByUserid.values()].find((s) => s.steamId === steamId)
        : undefined
      if (!slot) {
        slot = [...playersByUserid.values()].find((s) => s.name === name || s.name.trim() === trimmed)
      }
      if (slot) {
        if (slot.team === 'NONE' && team !== 'NONE') slot.team = team
        if (slot.slot === undefined && entitySlot !== undefined) slot.slot = entitySlot
        if (!slot.steamId && steamId) slot.steamId = steamId
      }
    }
  } catch {
    /* 实体缺失时跳过（官方 demo 走 USER_INFO 已足够） */
  }

  // ★按名字与 steamId 合并玩家表（解决 5E 平台 uid 漂移/幽灵条目）：
  //   同一玩家在实体采样与 USER_INFO 里可能 uid 不同，导致幽灵条目重复。
  //   合并规则：优先按 Steam64 ID 或名字（去空格）匹配并合并，保留最完整信息并重定向映射。
  const scoreSlot = (s: PlayerSlot): number =>
    (s.steamId && s.steamId.startsWith('7656119') ? 4 : s.steamId ? 2 : 0) +
    (s.team !== 'NONE' ? 2 : 0) +
    (s.slot !== undefined ? 1 : 0)
  const steamToSlot = new Map<string, PlayerSlot>()
  const nameToSlot = new Map<string, PlayerSlot>()
  for (const [, slot] of [...playersByUserid.entries()]) {
    const existing =
      (slot.steamId && slot.steamId.startsWith('7656119') ? steamToSlot.get(slot.steamId) : undefined) ??
      nameToSlot.get(slot.name) ??
      nameToSlot.get(slot.name.trim())
    if (!existing) {
      if (slot.steamId) steamToSlot.set(slot.steamId, slot)
      nameToSlot.set(slot.name, slot)
      nameToSlot.set(slot.name.trim(), slot)
      continue
    }
    // 合并：保留信息更全的（有 steamId + 有 team + 有 slot），删除另一个
    const keep = scoreSlot(existing) >= scoreSlot(slot) ? existing : slot
    const discard = keep === existing ? slot : existing
    if (keep.slot === undefined && discard.slot !== undefined) keep.slot = discard.slot
    if ((!keep.steamId || !keep.steamId.startsWith('7656119')) && discard.steamId) keep.steamId = discard.steamId
    if (keep.team === 'NONE' && discard.team !== 'NONE') keep.team = discard.team

    // 将指向 discard 的所有 uid 统一重定向到 keep
    for (const [uid2, s2] of playersByUserid) {
      if (s2 === discard) playersByUserid.set(uid2, keep)
    }
    if (keep.steamId) steamToSlot.set(keep.steamId, keep)
    nameToSlot.set(keep.name, keep)
    nameToSlot.set(keep.name.trim(), keep)
  }

  // 回填击杀 steamId（名字已在击杀时用实体快照 idxNameNow 填好，勿覆盖——USER_INFO
  // 编号错位会污染；仅补缺失 steamId 与 NONE 阵营兜底）
  const slotForName = (uid: number | undefined, name?: string): PlayerSlot | undefined => {
    if (uid !== undefined) {
      const s = playersByUserid.get(uid)
      if (s) return s
    }
    return name ? nameToSlot.get(name) : undefined
  }
  for (const r of realRounds) {
    for (const k of r.kills) {
      if (k.attackerUid !== undefined || k.attackerName) {
        const a = slotForName(k.attackerUid, k.attackerName)
        if (a) {
          if (!k.attackerSteamId) k.attackerSteamId = a.steamId
          // uid 漂移兜底：实时快照缺失（如 5E 个别玩家击杀 uid 与实体 idx 错位）时
          // 用最终玩家阵营着色（正常玩家保留击杀时刻快照，不受影响）
          if (k.attackerTeam === 'NONE' && a.team !== 'NONE') k.attackerTeam = a.team
        }
      }
      if (k.victimUid !== undefined || k.victimName) {
        const v = slotForName(k.victimUid, k.victimName)
        if (v) {
          if (!k.victimSteamId) k.victimSteamId = v.steamId
          if (k.victimTeam === 'NONE' && v.team !== 'NONE') k.victimTeam = v.team
        }
      }
    }
  }

  // 统一统计（对最终玩家表）：kills / deaths / assists / headshots / flashAssists
  for (const s of playersByUserid.values()) {
    s.kills = 0
    s.deaths = 0
    s.assists = 0
    s.headshots = 0
    s.flashAssists = 0
  }
  for (const r of realRounds) {
    for (const k of r.kills) {
      const a = slotForName(k.attackerUid, k.attackerName)
      if (a && k.attackerUid !== k.victimUid) {
        a.kills++
        if (k.headshot) a.headshots++
      }
      const v = slotForName(k.victimUid, k.victimName)
      if (v) v.deaths++
      if (k.assisterUid !== undefined) {
        const as = slotForName(k.assisterUid)
        if (as && k.assisterUid !== k.attackerUid) {
          as.assists++
          if (k.flashAssist) as.flashAssists++
        }
      }
    }
  }

  // Steam 头像（SERVER_AVATAR_OVERRIDES 表：key=steamid, value=PNG；玩家表最终确定后匹配）
  try {
    const avatarTable = parser
      .getDemo()
      .stringTableContainer.getByName(StringTableType.SERVER_AVATAR_OVERRIDES.name)
    if (avatarTable) {
      for (const entry of avatarTable.getEntries()) {
        const raw = entry.value as Uint8Array | string | null | undefined
        if (!raw) continue
        const b64 = typeof raw === 'string' ? raw : Buffer.from(raw).toString('base64')
        const uri = b64.startsWith('data:image') ? b64 : `data:image/png;base64,${b64}`
        const slot = [...playersByUserid.values()].find((p) => p.steamId === String(entry.key))
        if (slot) slot.avatar = uri
      }
    }
  } catch {
    /* 头像可选 */
  }

  // 阵营/队名/权威比分（实体，尽力而为）
  let teamT: string | undefined
  let teamCT: string | undefined
  let scoreT = 0
  let scoreCT = 0
  try {
    const demo = parser.getDemo()
    const teams = demo.getEntitiesByClassName('CCSTeam')
    for (const team of teams) {
      const num = team.getField('m_iTeamNum') as number
      const name = normalizeTeamName(str(team.getField('m_szTeamname')))
      const score = Number(team.getField('m_iScore')) || 0
      if (num === 2) {
        teamT = name
        scoreT = score
      }
      if (num === 3) {
        teamCT = name
        scoreCT = score
      }
    }
  } catch {
    /* 实体缺失时回退 */
  }
  if (!scoreT && !scoreCT) {
    for (const r of realRounds) {
      if (r.winner === 'T') scoreT++
      else if (r.winner === 'CT') scoreCT++
    }
  }

  // 伪 MVP: 每回合胜方击杀最多的选手
  const mvpBySteamId = new Map<string, number>()
  for (const r of realRounds) {
    if (r.winner === 'none') continue
    const counts = new Map<string, number>()
    for (const k of r.kills) {
      if (k.attackerSteamId && k.attackerTeam === r.winner) {
        counts.set(k.attackerSteamId, (counts.get(k.attackerSteamId) ?? 0) + 1)
      }
    }
    let best: { id: string; n: number } | null = null
    for (const [id, n] of counts) {
      if (!best || n > best.n) best = { id, n }
    }
    if (best && best.n > 0) {
      mvpBySteamId.set(best.id, (mvpBySteamId.get(best.id) ?? 0) + 1)
    }
  }

  await parser.dispose().catch(() => {})

  const rawList = [...new Set(playersByUserid.values())]
  const humanCount = rawList.filter((s) => s.steamId && s.steamId.startsWith('7656119')).length

  const players: PlayerInfo[] = rawList
    .filter((s) => !['GOTV', '5EGOTV', 'SourceTV'].includes(s.name) && !s.name.includes('CSTV'))
    .filter((s) => {
      // 若比赛中已识别到人类选手（>=5人），严格过滤假 SteamID（9007199...）或非 7656119 开头的机器人/占位符
      if (humanCount >= 5 && (!s.steamId || !s.steamId.startsWith('7656119'))) {
        return false
      }
      return s.kills > 0 || s.deaths > 0 || s.assists > 0 || (s.steamId && s.team !== 'NONE')
    })
    .map((s, idx) => {
      const slot =
        (s.steamId ? slotBySteamId.get(s.steamId) : undefined) ??
        slotByName.get(s.name) ??
        s.slot ??
        (typeof s.userid === 'number' && s.userid >= 1 && s.userid <= 64 ? s.userid - 1 : idx)
      return {
        steamId: s.steamId ?? '',
        name: s.name,
        slot,
        // ★开局阵营（黄=开局匪 T，蓝=开局警 CT）——与击杀记录上半场颜色一致；
        //   不用最终阵营（换边后相反，导致选手数据与击杀记录颜色反了）
        team: firstHalfTeamByName.get(s.name) ?? s.team,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        headshots: s.headshots,
        score: s.kills * 3 + s.assists,
        mvp: mvpBySteamId.get(s.steamId ?? '') ?? s.mvp,
        hsp: s.kills ? Math.round((s.headshots / s.kills) * 100) : 0,
        avatar: s.avatar,
        flashAssists: s.flashAssists
      }
    })
  // ★按 steamId 去重（实体名中途变化/uid 漂移会产生同名或同 steamId 重复条目）：
  //   同 steamId 保留 team 非 NONE 且击杀最多的；无 steamId 的同名条目也合并。
  {
    const byKey = new Map<string, PlayerInfo>()
    for (const p of players) {
      const key = p.steamId || `name:${p.name}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, p)
      } else if (existing.team === 'NONE' && p.team !== 'NONE') {
        // 优先保留有阵营的（实体采样版本；幽灵条目 team=NONE 但有击杀统计）
        byKey.set(key, {
          ...p,
          slot: p.slot ?? existing.slot,
          kills: Math.max(p.kills, existing.kills),
          deaths: Math.max(p.deaths, existing.deaths),
          assists: Math.max(p.assists, existing.assists),
          headshots: Math.max(p.headshots, existing.headshots),
          mvp: Math.max(p.mvp, existing.mvp),
          score: Math.max(p.score, existing.score),
          hsp: p.hsp || existing.hsp,
          flashAssists: Math.max(p.flashAssists ?? 0, existing.flashAssists ?? 0)
        })
      } else if (p.team !== 'NONE' && existing.team === p.team && p.kills > existing.kills) {
        byKey.set(key, { ...p, slot: p.slot ?? existing.slot })
      }
    }
    const deduped = [...byKey.values()]
    // 无 steamId 的同名条目：若与某有 steamId 玩家同名且该玩家 team=NONE，用击杀阵营推断
    const byName = new Map<string, PlayerInfo[]>()
    for (const p of deduped) {
      if (!byName.has(p.name)) byName.set(p.name, [])
      byName.get(p.name)!.push(p)
    }
    const finalPlayers: PlayerInfo[] = []
    for (const list of byName.values()) {
      if (list.length === 1) {
        finalPlayers.push(list[0])
        continue
      }
      // 同名多条：优先有 team 的；若都有 team 取击杀多的
      const withTeam = list.filter((p) => p.team !== 'NONE')
      const pick = withTeam.length ? [...withTeam].sort((a, b) => b.kills - a.kills)[0] : [...list].sort((a, b) => b.kills - a.kills)[0]
      finalPlayers.push(pick)
    }
    // ★team=NONE 兜底：按该玩家击杀中出现的阵营推断最终阵营（uid 漂移玩家的实体
    //   条目可能丢失，但其击杀时刻阵营快照可靠；下半场击杀多 → 最终阵营）
    const killTeamByName = new Map<string, { T: number; CT: number }>()
    for (const r of realRounds) {
      for (const k of r.kills) {
        if (!k.attackerName || k.attackerTeam === 'NONE') continue
        const m = killTeamByName.get(k.attackerName) ?? { T: 0, CT: 0 }
        if (k.attackerTeam === 'T') m.T++
        else if (k.attackerTeam === 'CT') m.CT++
        killTeamByName.set(k.attackerName, m)
      }
    }
    for (const p of finalPlayers) {
      if (p.team !== 'NONE') continue
      const m = killTeamByName.get(p.name)
      if (m) p.team = m.CT >= m.T ? 'CT' : 'T'
    }

    // ─── 计算 KAST、Rating 2.0、首杀/首死 与 ADR ─────────────────────────
    const totalRoundsCount = Math.max(1, realRounds.length)
    const kastRoundsByName = new Map<string, number>()

    for (const r of realRounds) {
      const roundVictimNames = new Set<string>()
      const roundKillerNames = new Set<string>()

      for (const k of r.kills) {
        if (k.victimName) roundVictimNames.add(k.victimName)
        if (k.attackerName) roundKillerNames.add(k.attackerName)
      }

      // 换人头判定：受害者死亡后 192 ticks（3.0 秒）内，其队友击杀了凶手
      const tradedVictimNames = new Set<string>()
      for (let i = 0; i < r.kills.length; i++) {
        const k1 = r.kills[i]
        if (!k1.victimName || k1.victimTeam === 'NONE') continue
        const killerName = k1.attackerName
        for (let j = i + 1; j < r.kills.length; j++) {
          const k2 = r.kills[j]
          if (k2.tick - k1.tick > 192) break
          if (
            k2.attackerTeam === k1.victimTeam &&
            killerName &&
            k2.victimName === killerName
          ) {
            tradedVictimNames.add(k1.victimName)
            break
          }
        }
      }

      // 助攻伤害：受害者在回合内被杀，且攻击者对其造成 >= 41 伤害（且不是终结者）
      const assistContributors = new Set<string>()
      for (const victimName of roundVictimNames) {
        const assistMap = roundVictimDamage.get(`${r.roundNum}:${victimName}`)
        if (assistMap) {
          for (const [attackerKey, dmg] of assistMap) {
            if (dmg >= 41) {
              assistContributors.add(attackerKey)
            }
          }
        }
      }

      for (const p of finalPlayers) {
        const name = p.name
        const steamId = p.steamId
        const hadKill = roundKillerNames.has(name)
        const survived = !roundVictimNames.has(name)
        const wasTraded = tradedVictimNames.has(name)
        const hadAssist = assistContributors.has(name) || (steamId ? assistContributors.has(steamId) : false)

        if (hadKill || hadAssist || survived || wasTraded) {
          kastRoundsByName.set(name, (kastRoundsByName.get(name) ?? 0) + 1)
        }
      }
    }

    for (const p of finalPlayers) {
      const totalDmg = damageByName.get(p.name) ?? (p.steamId ? playerDamage.get(p.steamId) : 0) ?? 0
      const adr = Math.round((totalDmg / totalRoundsCount) * 10) / 10
      const kastRounds = kastRoundsByName.get(p.name) ?? 0
      const kast = Math.round((kastRounds / totalRoundsCount) * 1000) / 10
      const fk = firstKillsByName.get(p.name) ?? 0
      const fd = firstDeathsByName.get(p.name) ?? 0

      // HLTV Rating 2.0 拟合公式
      const kpr = p.kills / totalRoundsCount
      const dpr = p.deaths / totalRoundsCount
      const apr = p.assists / totalRoundsCount
      const impact = 2.13 * kpr + 0.42 * apr - 0.41 + (fk / totalRoundsCount) * 0.25
      const rawRating = 0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587
      const rating = Math.max(0.05, Math.min(3.5, Math.round(rawRating * 100) / 100))

      const utDmg =
        utilityDamageByName.get(p.name) ?? (p.steamId ? playerUtilityDamage.get(p.steamId) : 0) ?? 0
      const utDmgPerRound = Math.round((utDmg / totalRoundsCount) * 10) / 10
      const enBlinded = enemyBlindCountByName.get(p.name) ?? 0
      const enBlindDur = Math.round((enemyBlindDurationByName.get(p.name) ?? 0) * 10) / 10
      const tmBlinded = teamBlindCountByName.get(p.name) ?? 0
      const tmBlindDur = Math.round((teamBlindDurationByName.get(p.name) ?? 0) * 10) / 10

      p.adr = adr
      p.totalDamage = totalDmg
      p.kast = kast
      p.rating = rating
      p.firstKills = fk
      p.firstDeaths = fd
      p.utilityDamage = utDmg
      p.utilityDamagePerRound = utDmgPerRound
      p.enemiesBlinded = enBlinded
      p.enemyBlindDuration = enBlindDur
      p.teammatesBlinded = tmBlinded
      p.teamBlindDuration = tmBlindDur
    }

    players.length = 0
    players.push(...finalPlayers)
  }

  return {
    mapName,
    tickRate: TICK_RATE,
    firstTick: firstTick === Infinity ? 0 : firstTick,
    lastTick,
    players: players.sort((a, b) => b.kills - a.kills),
    rounds: realRounds.map((r) => ({
      roundNum: r.roundNum,
      startTick: r.startTick,
      endTick: r.endTick ?? lastTick,
      winner: r.winner,
      endType: r.endType,
      kills: r.kills.sort((a, b) => a.tick - b.tick),
      bombPlantedTick: r.bombPlantedTick,
      bombDefusedTick: r.bombDefusedTick,
      bombExplodedTick: r.bombExplodedTick,
      economy: r.economy,
      firstKill: r.firstKill
    })),
    chat: chat.sort((a, b) => a.tick - b.tick),
    hasVoice: voiceCount > 0,
    // 真实累计语音秒数：去重语音 tick / tickrate（每 tick 至多 ~20ms 语音帧）
    voiceSec: Math.round(voiceTicks.size / TICK_RATE),
    teamT,
    teamCT,
    scoreT,
    scoreCT
  }
}

interface RawChat {
  tick: number
  timeSec: number
  channel: ChatChannel
  playerName: string
  text: string
  roundNum: number
}
