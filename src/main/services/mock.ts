/**
 * Phase 0 模拟数据生成器（确定性、可复现）。
 * 用于在设计/壳阶段预览全部 UI；Phase 1 接入真实 deadem 解析后移除。
 */
import type {
  ChatMessage,
  DemoDetail,
  DemoMeta,
  KillEvent,
  PlayerInfo,
  RoundInfo,
  RoundWinner,
  VoiceSegment
} from '@shared/types'

// ─── 工具 ──────────────────────────────────────────────────────────────────

/** mulberry32 确定性 PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)]
const range = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))

// ─── 数据池 ────────────────────────────────────────────────────────────────

const HANDLES = ['Vexed', 'k1ng', 'Neo', 'shadow', 'blitz', 'Raven', 'Mako', 'frost', 'juno', 'pixel']

const WEAPONS = [
  'AK-47',
  'AK-47',
  'AK-47',
  'M4A4',
  'M4A4',
  'M4A1-S',
  'M4A1-S',
  'AWP',
  'AWP',
  'Desert Eagle',
  'Desert Eagle',
  'Glock-18',
  'USP-S',
  'MAC-10',
  'MP9',
  'MP7',
  'AUG',
  'SG 553',
  'FAMAS',
  'Galil AR',
  'SSG 08',
  'Zeus x27'
]

const CALLS_ZH = [
  '他一人在 A 大，可以打',
  '给颗闪，我拉出去',
  '转 B 了转 B 了，快',
  '残局 1v2，稳住别急',
  '中路烟封好了，走',
  '他在跳台，压着打',
  '保枪保枪，别送了',
  '经济不够，这回合 eco',
  '放包放包，守包打',
  'nice nice，好枪',
  '回防回防，B 点进了',
  '架住拱门，别让他过',
  '我道具不够了，支援一下',
  '双架双架，稳一点',
  '先打掉连接，再打包点'
]

const CALLS_EN = [
  'one on A long, push him',
  'flash me out, ready?',
  'rotating B, rotating B',
  '1v2 clutch, take your time',
  'smoke is up mid, going',
  'he is on cat, hold him',
  'save your guns, dont peek',
  'save round, eco up',
  'planting, plant for back',
  'nice, clean shots',
  'rotate CT, B site push',
  'hold arch, dont let him cross',
  'out of util, need support',
  'double stack, play slow',
  'clear connector first, then site'
]

const CHAT_ZH = ['rush B 我带头', 'eco 局别买', 'drop AWP 求求', '他开了？不像', 'nt nt', 'GG', '残局心态稳住', '下把我 C']
const CHAT_EN = ['rush B lets go', 'eco round', 'drop awp pls', 'he is cheating?', 'nt', 'ggwp', 'clutch or kick', 'i carry']

// ─── 生成 ──────────────────────────────────────────────────────────────────

interface MockSeed {
  id: string
  fileName: string
  mapName: string
  teamT: string
  teamCT: string
  scores: [number, number]
  rounds: number
  lang: 'zh' | 'en'
  hasVoice: boolean | null
  sizeMB: number
}

const SEEDS: MockSeed[] = [
  {
    id: 'mock-mirage-phoenix',
    fileName: 'mirage_phoenix_vs_redline_64tick.dem',
    mapName: 'mirage',
    teamT: 'Phoenix',
    teamCT: 'Redline',
    scores: [13, 9],
    rounds: 22,
    lang: 'zh',
    hasVoice: true,
    sizeMB: 348
  },
  {
    id: 'mock-dust2-vertex',
    fileName: 'dust2_vertex_vs_nightfall_mm.dem',
    mapName: 'dust2',
    teamT: 'Vertex',
    teamCT: 'Nightfall',
    scores: [13, 11],
    rounds: 24,
    lang: 'en',
    hasVoice: true,
    sizeMB: 401
  },
  {
    id: 'mock-inferno-harbor',
    fileName: 'inferno_harbor_vs_ironclad.dem',
    mapName: 'inferno',
    teamT: 'Harbor',
    teamCT: 'Ironclad',
    scores: [7, 13],
    rounds: 20,
    lang: 'zh',
    hasVoice: false,
    sizeMB: 289
  },
  {
    id: 'mock-anubis-storm',
    fileName: 'anubis_storm_vs_cinder_faceit.dem.zst',
    mapName: 'anubis',
    teamT: 'Storm',
    teamCT: 'Cinder',
    scores: [13, 5],
    rounds: 18,
    lang: 'en',
    hasVoice: null,
    sizeMB: 176
  }
]

const TICK_RATE = 64
const TICKS_PER_ROUND = 105 * TICK_RATE // ~105s

function genPlayers(rng: () => number): PlayerInfo[] {
  const handles = [...HANDLES].sort(() => rng() - 0.5)
  const players: PlayerInfo[] = []
  for (let i = 0; i < 10; i++) {
    const team = i < 5 ? 'T' : 'CT'
    players.push({
      steamId: `7656119${String(Math.floor(rng() * 1e9)).padStart(9, '0')}`,
      name: handles[i],
      team,
      kills: 0,
      deaths: range(rng, 8, 20),
      assists: range(rng, 1, 9),
      headshots: 0,
      score: 0,
      mvp: 0,
      hsp: 0
    })
  }
  return players
}

function genKill(rng: () => number, tick: number, roundNum: number, players: PlayerInfo[]): KillEvent {
  const t = players.filter((p) => p.team === 'T')
  const ct = players.filter((p) => p.team === 'CT')
  const fromT = rng() > 0.5
  const attacker = pick(rng, fromT ? t : ct)
  const victim = pick(rng, fromT ? ct : t)
  const weapon = pick(rng, WEAPONS)
  return {
    tick,
    timeSec: tick / TICK_RATE,
    attackerSteamId: attacker.steamId,
    attackerName: attacker.name,
    attackerTeam: attacker.team,
    victimSteamId: victim.steamId,
    victimName: victim.name,
    victimTeam: victim.team,
    weapon,
    headshot: weapon === 'AWP' || weapon === 'SSG 08' ? rng() > 0.3 : rng() > 0.55,
    throughSmoke: rng() > 0.94,
    roundNum
  }
}

function genRounds(rng: () => number, seed: MockSeed, players: PlayerInfo[]): RoundInfo[] {
  const rounds: RoundInfo[] = []
  const total = seed.rounds
  let tick = 64 * 4 // 起始偏移
  for (let r = 1; r <= total; r++) {
    const startTick = tick
    const killCount = range(rng, 0, 5)
    const kills: KillEvent[] = []
    let tScore = 0
    let ctScore = 0
    for (let k = 0; k < killCount; k++) {
      const kt = startTick + range(rng, 5, 88) * TICK_RATE
      const k = genKill(rng, kt, r, players)
      kills.push(k)
      if (k.attackerTeam === 'T') tScore++
      else ctScore++
    }
    const bombRounds = new Set([3, 6, 9, 12, 15, 18])
    let bombPlantedTick: number | undefined
    let bombDefusedTick: number | undefined
    let bombExplodedTick: number | undefined
    if (bombRounds.has(r) && rng() > 0.25) {
      bombPlantedTick = startTick + range(rng, 20, 55) * TICK_RATE
      if (rng() > 0.4) bombExplodedTick = bombPlantedTick + range(rng, 30, 42) * TICK_RATE
      else bombDefusedTick = bombPlantedTick + range(rng, 20, 38) * TICK_RATE
    }
    // 胜者判定
    let winner: RoundWinner = 'none'
    let endType: RoundInfo['endType'] = 'unknown'
    const roll = rng()
    if (bombExplodedTick) {
      winner = 'T'
      endType = 'bomb_exploded'
    } else if (bombDefusedTick) {
      winner = 'CT'
      endType = 'bomb_defused'
    } else if (roll < 0.72) {
      winner = tScore >= ctScore ? 'T' : 'CT'
      endType = 'elimination'
    } else {
      winner = 'CT'
      endType = 'timeout'
    }
    const endTick = startTick + TICKS_PER_ROUND + range(rng, -8, 14) * TICK_RATE
    rounds.push({
      roundNum: r,
      startTick,
      endTick,
      winner,
      endType,
      kills: kills.sort((a, b) => a.tick - b.tick),
      bombPlantedTick,
      bombDefusedTick,
      bombExplodedTick
    })
    tick = endTick
  }
  return rounds
}

function genChat(rng: () => number, rounds: RoundInfo[], players: PlayerInfo[], lang: 'zh' | 'en'): ChatMessage[] {
  const chat: ChatMessage[] = []
  const pool = lang === 'zh' ? CHAT_ZH : CHAT_EN
  for (const round of rounds) {
    const n = range(rng, 0, 3)
    for (let i = 0; i < n; i++) {
      const p = pick(rng, players)
      chat.push({
        tick: round.startTick + range(rng, 2, 90) * TICK_RATE,
        timeSec: (round.startTick + range(rng, 2, 90) * TICK_RATE) / TICK_RATE,
        channel: rng() > 0.75 ? 'ALL' : p.team === 'T' ? 'T' : 'CT',
        playerName: p.name,
        steamId: p.steamId,
        text: pick(rng, pool),
        roundNum: round.roundNum
      })
    }
  }
  return chat.sort((a, b) => a.tick - b.tick)
}

function genVoice(
  rng: () => number,
  rounds: RoundInfo[],
  players: PlayerInfo[],
  lang: 'zh' | 'en'
): VoiceSegment[] {
  const voice: VoiceSegment[] = []
  const pool = lang === 'zh' ? CALLS_ZH : CALLS_EN
  for (const round of rounds) {
    const n = range(rng, 1, 6)
    for (let i = 0; i < n; i++) {
      const p = pick(rng, players)
      const startTick = round.startTick + range(rng, 0, 100) * TICK_RATE
      const dur = 1.2 + rng() * 6.5
      const text = pick(rng, pool)
      voice.push({
        tick: startTick,
        endTick: startTick + Math.round(dur * TICK_RATE),
        timeSec: startTick / TICK_RATE,
        endSec: startTick / TICK_RATE + dur,
        playerName: p.name,
        steamId: p.steamId,
        team: p.team,
        text,
        roundNum: round.roundNum,
        engine: 'local'
      })
    }
  }
  return voice.sort((a, b) => a.tick - b.tick)
}

function genMeta(seed: MockSeed, now: number): DemoMeta {
  const rng = mulberry32(hashStr(seed.id))
  const players = genPlayers(rng)
  const rounds = genRounds(rng, seed, players)
  // 统计选手数据
  for (const r of rounds) {
    for (const k of r.kills) {
      const a = players.find((p) => p.steamId === k.attackerSteamId)
      if (a) {
        a.kills++
        if (k.headshot) a.headshots++
      }
      const v = players.find((p) => p.steamId === k.victimSteamId)
      if (v) v.deaths++
    }
  }
  for (const p of players) {
    p.score = p.kills * 3 + p.assists
    p.hsp = p.kills ? Math.round((p.headshots / p.kills) * 100) : 0
  }
  const lastTick = rounds[rounds.length - 1]?.endTick ?? 0
  const mtime = now - Math.floor(rng() * 30 * 86400_000)
  return {
    id: seed.id,
    path: `D:\\Demos\\${seed.fileName}`,
    fileName: seed.fileName,
    sizeBytes: Math.round(seed.sizeMB * 1024 * 1024),
    mtimeMs: mtime,
    addedAt: mtime + 3600_000,
    status: 'ready',
    mapName: seed.mapName,
    tickRate: TICK_RATE,
    tickCount: lastTick,
    durationSec: lastTick / TICK_RATE,
    teamT: seed.teamT,
    teamCT: seed.teamCT,
    scoreT: seed.scores[0],
    scoreCT: seed.scores[1],
    roundCount: seed.rounds,
    players: players.sort((a, b) => b.kills - a.kills),
    hasVoice: seed.hasVoice,
    voiceSec: seed.hasVoice ? Math.round(lastTick / TICK_RATE * 0.06) : 0
  }
}

let cache: DemoMeta[] | null = null

export function getMockLibrary(): DemoMeta[] {
  if (cache) return cache
  const now = Date.now()
  cache = SEEDS.map((s) => genMeta(s, now))
  return cache
}

export function getMockDetail(id: string): DemoDetail | null {
  const meta = getMockLibrary().find((m) => m.id === id)
  if (!meta) return null
  const seed = SEEDS.find((s) => s.id === id)!
  const rng = mulberry32(hashStr(id) ^ 0x9e3779b9)
  const players = genPlayers(rng)
  const rounds = genRounds(rng, seed, players)
  const chat = genChat(rng, rounds, players, seed.lang)
  const voice = seed.hasVoice ? genVoice(rng, rounds, players, seed.lang) : []
  const firstTick = rounds[0]?.startTick ?? 0
  const lastTick = rounds[rounds.length - 1]?.endTick ?? 0
  return { meta, rounds, chat, voice, firstTick, lastTick }
}
