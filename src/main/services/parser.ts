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
  ChatChannel,
  ChatMessage,
  KillEvent,
  PlayerInfo,
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
  m4a1_silencer: 'M4A1-S',
  awp: 'AWP',
  ssg08: 'SSG 08',
  deagle: 'Desert Eagle',
  glock: 'Glock-18',
  usp_silencer: 'USP-S',
  p250: 'P250',
  fiveseven: 'Five-SeveN',
  tec9: 'Tec-9',
  cz75a: 'CZ75-A',
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
  knife: 'Knife',
  knife_t: 'Knife',
  bayonet: 'Knife',
  karambit: 'Knife',
  zeus: 'Zeus x27',
  hegrenade: 'HE Grenade',
  molotov: 'Molotov',
  incgrenade: 'Incendiary',
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

// ─── 内部累积结构 ────────────────────────────────────────────────────────────

interface PlayerSlot {
  userid: number
  name: string
  steamId?: string
  team: TeamSide
  kills: number
  deaths: number
  assists: number
  headshots: number
  mvp: number
  avatar?: string
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
      entityClasses: ['CCSPlayerController', 'CCSTeam', 'CCSGameRulesProxy']
    })
  )

  const playersByUserid = new Map<number, PlayerSlot>()
  const descriptors = new Map<number, { keys: { name: string }[]; name?: string }>()
  const chat: RawChat[] = []
  let voiceCount = 0
  let voiceMinTick = Infinity
  let voiceMaxTick = -Infinity
  let firstTick = Infinity
  let lastTick = 0
  let mapName: string | undefined
  let userInfoLoaded = false

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
    rounds.push(r)
  }

  const startRound = (tick: number) => {
    if (roundsStarted) {
      closeRound(tick) // 上一回合已由 round_officially_ended 记录 endTick 时此处直接收尾
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
        const a = playersByUserid.get(attacker)
        const v = playersByUserid.get(victim)
        const kill: KillEvent = {
          tick,
          timeSec: tick / TICK_RATE,
          attackerSteamId: a?.steamId,
          attackerName: a?.name,
          attackerTeam: a?.team ?? 'NONE',
          victimSteamId: v?.steamId,
          victimName: v?.name,
          victimTeam: v?.team ?? 'NONE',
          weapon: (WEAPON_NAMES[str(ev.weapon).toLowerCase()] ?? str(ev.weapon)) || '—',
          headshot: Boolean(ev.headshot),
          throughSmoke: Boolean(ev.thrusmoke),
          roundNum: currentRound.roundNum
        }
        if (a && attacker !== victim) {
          a.kills++
          if (kill.headshot) a.headshots++
        }
        if (v) v.deaths++
        const assister = int(ev.assister)
        if (assister !== 65535) {
          const as = playersByUserid.get(assister)
          if (as) as.assists++
        }
        currentRound.kills.push(kill)
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
              mvp: 0
            })
          }
        }
      }
      // Steam 头像（SERVER_AVATAR_OVERRIDES 表：key=steamid, value=PNG）
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
          if (tick < voiceMinTick) voiceMinTick = tick
          if (tick > voiceMaxTick) voiceMaxTick = tick
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

  const players: PlayerInfo[] = [...playersByUserid.values()].map((s) => ({
    steamId: s.steamId ?? '',
    name: s.name,
    team: s.team,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    headshots: s.headshots,
    score: s.kills * 3 + s.assists,
    mvp: mvpBySteamId.get(s.steamId ?? '') ?? s.mvp,
    hsp: s.kills ? Math.round((s.headshots / s.kills) * 100) : 0,
    avatar: s.avatar
  }))

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
      bombExplodedTick: r.bombExplodedTick
    })),
    chat: chat.sort((a, b) => a.tick - b.tick),
    hasVoice: voiceCount > 0,
    voiceSec: voiceMaxTick >= voiceMinTick ? Math.round((voiceMaxTick - voiceMinTick) / TICK_RATE) : 0,
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
