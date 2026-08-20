/**
 * Web 模式 Mock 适配层：当应用运行在纯浏览器（无 Electron preload）时，
 * 用内存 mock 数据实现 window.api，使 UI 可在浏览器中直接开发调试（HMR 秒级）。
 * 生产 Web 版由真实服务（本地桥 + 云端）替换各实现。
 */
import type {
  ApiWithEvents,
  DemoDetail,
  DemoMeta,
  LiveStatus,
  MainEvent,
  OverlayState,
  Settings,
  VoiceSegment
} from '@shared/types'
import { parseDemoWeb } from '../../web/parseDemo'

const LANGS = ['zh', 'en'] as const

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MAPS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_ancient', 'de_nuke', 'de_train', 'de_anubis'] as const

const DEMOS: DemoMeta[] = MAPS.map((m, i) => {
  const r = rng(1000 + i)
  const rounds = 13 + Math.floor(r() * 11)
  const t = Math.floor(r() * 13)
  const ct = 13 + Math.floor(r() * 3) - t
  const players = ['Vexed', 'k1ng', 'Neo', 'shadow', 'blitz', 'Raven', 'Mako', 'frost', 'juno', 'pixel'].map(
    (name, j) => ({
      steamId: `7656119${100000000 + i * 100 + j}`,
      name,
      team: (j < 5 ? 'T' : 'CT') as 'T' | 'CT',
      kills: 5 + Math.floor(r() * 20),
      deaths: 5 + Math.floor(r() * 20),
      assists: Math.floor(r() * 8),
      headshots: Math.floor(r() * 15),
      score: Math.floor(r() * 60),
      mvp: Math.floor(r() * 4),
      hsp: Math.floor(r() * 100)
    })
  )
  return {
    id: `web-${m.replace('de_', '')}`,
    path: `/demos/${m}_${Date.now()}.dem`,
    fileName: `${m}_match_${100 + i}.dem`,
    sizeBytes: (100 + i * 40) * 1024 * 1024,
    mtimeMs: Date.now() - i * 86400000,
    addedAt: Date.now() - i * 43200000,
    status: 'ready',
    mapName: m,
    tickRate: 64,
    tickCount: 64 * 60 * 40,
    durationSec: 60 * 40,
    teamT: 'T',
    teamCT: 'CT',
    scoreT: t,
    scoreCT: ct,
    roundCount: rounds,
    players,
    hasVoice: i % 2 === 0,
    voiceSec: 1200 + i * 300
  }
})

function buildDetail(meta: DemoMeta): DemoDetail {
  const rounds = Array.from({ length: meta.roundCount ?? 16 }, (_, i) => {
    const start = (i + 1) * 64 * 105
    const kills = Array.from({ length: Math.floor(rng(i + 1)() * 5) }, (_, k) => {
      const attacker = meta.players![Math.floor(rng(i * 7 + k)() * 5)]
      const victim = meta.players![5 + Math.floor(rng(i * 13 + k)() * 5)]
      return {
        tick: start + 64 * (5 + Math.floor(rng(k + i)() * 90)),
        timeSec: 0,
        attackerSteamId: attacker.steamId,
        attackerName: attacker.name,
        attackerTeam: attacker.team,
        victimSteamId: victim.steamId,
        victimName: victim.name,
        victimTeam: victim.team,
        weapon: ['AK-47', 'M4A4', 'AWP', 'Desert Eagle', 'USP-S', 'MP9'][Math.floor(rng(i + k)() * 6)],
        headshot: rng(k)() > 0.5,
        throughSmoke: rng(i)() > 0.93,
        roundNum: i + 1
      }
    })
    return {
      roundNum: i + 1,
      startTick: start,
      endTick: start + 64 * 105,
      winner: (i % 2 === 0 ? 'T' : 'CT') as 'T' | 'CT',
      endType: 'elimination' as const,
      kills,
      bombPlantedTick: i % 3 === 0 ? start + 64 * 40 : undefined
    }
  })
  const voice: VoiceSegment[] = meta.hasVoice
    ? Array.from({ length: 60 }, (_, i) => {
        const tick = 64 * (30 + i * 40)
        const p = meta.players![Math.floor(rng(i)() * 10)]
        return {
          tick,
          endTick: tick + 64 * 3,
          timeSec: tick / 64,
          endSec: tick / 64 + 3,
          playerName: p.name,
          steamId: p.steamId,
          team: p.team,
          text: ['他一人在 A 大，可以打', '给颗闪，我拉出去', '转 B 了转 B 了', '残局 1v2 稳住', 'nice nice', '保枪保枪'][
            Math.floor(rng(i + 3)() * 6)
          ],
          roundNum: Math.floor(tick / 64 / 105) + 1,
          engine: 'local'
        }
      })
    : []
  return {
    meta,
    rounds,
    chat: [],
    voice,
    firstTick: rounds[0]?.startTick ?? 0,
    lastTick: (rounds.at(-1)?.endTick ?? 0) + 64
  }
}

export function createWebApi(): ApiWithEvents {
  const listeners = new Map<string, Set<(e: never) => void>>()
  const emit = <T extends MainEvent['type']>(event: Extract<MainEvent, { type: T }>) => {
    for (const cb of listeners.get(event.type) ?? []) cb(event as never)
  }

  const state: {
    settings: Settings
    demos: DemoMeta[]
    live: LiveStatus
    details: Map<string, DemoDetail>
  } = {
    settings: {
      language: 'zh',
      libraryRoots: [],
      asr: { engine: 'local', localModel: 'small', cloudBaseUrl: 'https://api.groq.com/openai/v1', cloudApiKey: '', cloudModel: 'whisper-large-v3-turbo' },
      cs2: { vconsolePort: 29000, gsiPort: 30070, useToolsMode: true },
      overlay: { enabled: false, position: 'bottom-left', clickThrough: false, scale: 1 }
    },
    // Web 版默认空库：小白不会看到假数据；「试试示例」才加载 mock
    demos: [],
    live: { state: 'idle', cs2Running: false, vconsoleConnected: false, gsiActive: false },
    details: new Map()
  }

  /** 加载示例数据（新手引导用） */
  const loadDemoDemos = () => {
    state.demos = DEMOS
    state.details.clear()
    emit({ type: 'library:updated', demos: state.demos })
  }

  /** 示例 demo 缺省自动加载（URL 直达 / 详情跳转时） */
  const ensureDemos = () => {
    if (state.demos.length === 0) loadDemoDemos()
  }

  /** 添加单个文件（拖放/选择共用） */
  const addFile = async (file: File): Promise<string | null> => {
    const id = `file-${file.name}-${file.size}-${file.lastModified}`
    if (state.details.has(id)) return id
    if (!file.name.toLowerCase().endsWith('.dem')) {
      console.warn('[web] skip non-dem file', file.name)
      return null
    }
    try {
      const result = await parseDemoWeb(file.stream(), file.size, (p) => {
        emit({ type: 'library:progress', id, stage: 'parse', progress: p.bytes / Math.max(1, p.total) })
      })
      const meta: DemoMeta = {
        id,
        path: file.name,
        fileName: file.name,
        sizeBytes: file.size,
        mtimeMs: file.lastModified,
        addedAt: Date.now(),
        status: 'ready',
        mapName: result.mapName,
        tickRate: result.tickRate,
        tickCount: result.lastTick,
        durationSec: Math.round(result.lastTick / result.tickRate),
        teamT: result.teamT,
        teamCT: result.teamCT,
        scoreT: result.scoreT,
        scoreCT: result.scoreCT,
        roundCount: result.rounds.length,
        players: result.players,
        hasVoice: result.hasVoice,
        voiceSec: result.voiceSec
      }
      state.demos = [meta, ...state.demos.filter((d) => d.id !== id)]
      state.details.set(id, { meta, rounds: result.rounds, chat: result.chat, voice: [], firstTick: result.firstTick, lastTick: result.lastTick })
      emit({ type: 'library:updated', demos: state.demos })
      return id
    } catch (err) {
      console.error('[web] parse failed', file.name, err)
      return null
    }
  }

  /** 打开文件选择器并解析真实 .dem（Web 版的核心能力） */
  const pickAndParse = async (): Promise<string[]> => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.dem'
    input.multiple = true
    const picked = await new Promise<FileList | null>((resolve) => {
      input.onchange = () => resolve(input.files)
      input.click()
    })
    if (!picked || picked.length === 0) return []
    const ids: string[] = []
    for (const file of Array.from(picked)) {
      const id = await addFile(file)
      if (id) ids.push(id)
    }
    return ids
  }

  const base = {
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false
    },
    settings: {
      get: async () => state.settings,
      set: async (patch) => {
        state.settings = { ...state.settings, ...patch } as Settings
        emit({ type: 'settings:changed', settings: state.settings })
        return state.settings
      }
    },
    library: {
      list: async () => state.demos,
      detail: async (id) => {
        // 直达示例 demo（URL/跳转）时自动加载示例数据
        if (id.startsWith('web-')) ensureDemos()
        return state.details.get(id) ?? (() => {
          const meta = state.demos.find((d) => d.id === id)
          return meta ? buildDetail(meta) : null
        })()
      },
      addRoot: async () => pickAndParse(),
      removeRoot: async () => {},
      rescan: async () => {}
    },
    voice: {
      detect: async (id) => ({ hasVoice: Boolean(state.demos.find((d) => d.id === id)?.hasVoice), voiceSec: 0 }),
      extract: async () => 0
    },
    asr: {
      transcribe: async (id, _opts) => {
        const detail = buildDetail(state.demos.find((d) => d.id === id)!)
        for (let i = 0; i < detail.voice.length; i++) {
          await new Promise((r) => setTimeout(r, 60))
          emit({ type: 'asr:segment', demoId: id, segment: detail.voice[i] })
          if (i % 5 === 0) emit({ type: 'asr:progress', demoId: id, stage: 'asr-local', done: i, total: detail.voice.length })
        }
        emit({ type: 'asr:progress', demoId: id, stage: 'asr-local', done: detail.voice.length, total: detail.voice.length })
      },
      cancel: async () => {}
    },
    live: {
      getStatus: async () => state.live,
      connect: async () => state.live,
      sendCommand: async () => false,
      jumpTick: async () => false,
      pause: async () => false,
      resume: async () => false,
      setTimescale: async () => false,
      specNext: async () => false,
      specPrev: async () => false,
      specGoto: async () => false,
      launch: async () => ({ ok: false, url: '', error: 'Web 版不支持启动 CS2：请使用桌面版' }),
      installGsi: async () => null,
      locateInstall: async () => null
    },
    overlay: {
      setEnabled: async (enabled, demoId) => {
        const detail = demoId ? buildDetail(state.demos.find((d) => d.id === demoId)!) : null
        const s: OverlayState = enabled && detail
          ? { mode: 'demo', tick: detail.firstTick, tickRate: 64, map: detail.meta.mapName, scoreT: detail.meta.scoreT, scoreCT: detail.meta.scoreCT, round: 1, speakers: [], lines: [] }
          : { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] }
        emit({ type: 'overlay:state', state: s })
      },
      setPosition: async () => {},
      setClickThrough: async () => {},
      getState: async () => null,
      setFullPanel: async (enabled, demoId) => {
        if (!enabled) {
          emit({ type: 'overlay:state', state: { mode: 'idle', tick: 0, tickRate: 64, speakers: [], lines: [] } })
          return
        }
        const detail = demoId ? buildDetail(state.demos.find((d) => d.id === demoId)!) : null
        if (!detail) return
        // 全屏面板演示：定时推进 tick 并广播状态
        let tick = detail.firstTick
        const rate = 64
        emit({
          type: 'overlay:state',
          state: {
            mode: 'demo',
            tick,
            tickRate: rate,
            map: detail.meta.mapName,
            scoreT: detail.meta.scoreT,
            scoreCT: detail.meta.scoreCT,
            round: 1,
            speakers: [],
            lines: [],
            full: true,
            events: [],
            players: detail.meta.players?.slice(0, 10).map((p) => ({ name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, hs: p.hsp })),
            rounds: detail.rounds.map((r) => ({ num: r.roundNum, startTick: r.startTick, endTick: r.endTick, winner: r.winner }))
          }
        })
        const timer = setInterval(() => {
          tick += 64
          if (tick > detail.lastTick) {
            clearInterval(timer)
            return
          }
          const round = detail.rounds.find((r) => tick >= r.startTick && tick < r.endTick)
          const speakers = detail.voice.filter((v) => v.tick <= tick && v.endTick >= tick).map((v) => ({ name: v.playerName, team: v.team }))
          const lines = detail.voice
            .filter((v) => tick - v.tick < 30 * rate)
            .slice(-3)
            .map((v) => ({ text: v.text, playerName: v.playerName, team: v.team, tick: v.tick }))
          const events = detail.voice
            .filter((v) => v.tick <= tick && tick - v.tick < 45 * rate)
            .map((v) => ({ type: 'voice' as const, tick: v.tick, text: v.text, sub: v.playerName, team: v.team }))
          emit({
            type: 'overlay:state',
            state: {
              mode: 'demo',
              tick,
              tickRate: rate,
              map: detail.meta.mapName,
              scoreT: detail.meta.scoreT,
              scoreCT: detail.meta.scoreCT,
              round: round?.roundNum,
              speakers: [...new Map(speakers.map((s) => [s.name, s])).values()],
              lines,
              full: true,
              events: events.slice(-24),
              players: detail.meta.players?.slice(0, 10).map((p) => ({ name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, hs: p.hsp })),
              rounds: detail.rounds.map((r) => ({ num: r.roundNum, startTick: r.startTick, endTick: r.endTick, winner: r.winner }))
            }
          })
        }, 1000 / 30)
      },
      command: async () => {}
    },
    engines: {
      status: async () => ({ csgove: false, whisper: true, 'model-base': true, 'model-small': true, 'model-medium': false }),
      ensure: async () => {}
    },
    app: {
      version: async () => '0.2.0-web',
      revealInFolder: async () => {}
    },
    onEvent: <T extends MainEvent['type']>(
      type: T,
      cb: (e: Extract<MainEvent, { type: T }>) => void
    ) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(cb as never)
      return () => {
        listeners.get(type)?.delete(cb as never)
      }
    }
  } as ApiWithEvents & {
    __web?: { addFile: (f: File) => Promise<string | null>; loadDemoDemos: () => void }
  }

  // 挂 Web 专用钩子
  const api = {
    ...base,
    __web: { addFile, loadDemoDemos }
  } as ApiWithEvents & {
    __web?: { addFile: (f: File) => Promise<string | null>; loadDemoDemos: () => void }
  }
  return api
}

export function installWebApiIfNeeded(): void {
  if (!window.api) {
    const api = createWebApi()
    window.api = api
    console.info('[web] mock api installed')
  }
  // Web 模式专用钩子：拖放导入 / 示例数据
  const w = window as unknown as {
    __demoAnalystWeb?: { addFile: (f: File) => Promise<string | null>; loadDemoDemos: () => void }
  }
  if (!w.__demoAnalystWeb) {
    const api = window.api as ApiWithEvents & {
      __web?: { addFile: (f: File) => Promise<string | null>; loadDemoDemos: () => void }
    }
    w.__demoAnalystWeb = api.__web ?? {
      addFile: async () => null,
      loadDemoDemos: () => {}
    }
  }
}

export { LANGS }
