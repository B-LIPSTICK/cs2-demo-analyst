/**
 * 全应用共享类型（main / preload / renderer 三端共用）
 * IPC 契约与数据模型以本文件为准。
 */

// ─── 资料库 ────────────────────────────────────────────────────────────────

export type DemoStatus = 'pending' | 'scanning' | 'parsing' | 'ready' | 'error'

export interface DemoMeta {
  /** 缓存键: path+size+mtime 的 hash */
  id: string
  path: string
  fileName: string
  sizeBytes: number
  mtimeMs: number
  addedAt: number
  status: DemoStatus
  error?: string
  /** 源压缩包（.zip 容器）路径：zip 内的 demo 由工具内部缓存到 userData，此字段记录容器 */
  containerPath?: string
  /** demo 日期（近似比赛时间）：默认取文件 mtime */
  dateMs?: number
  /** 解析结果 */
  mapName?: string
  tickRate?: number
  tickCount?: number
  durationSec?: number
  teamT?: string
  teamCT?: string
  scoreT?: number
  scoreCT?: number
  roundCount?: number
  players?: PlayerInfo[]
  /** 语音检测: null=未扫描 */
  hasVoice?: boolean | null
  voiceSec?: number
}

export type TeamSide = 'T' | 'CT' | 'SPEC' | 'NONE'

export interface PlayerInfo {
  steamId: string
  name: string
  team: TeamSide
  kills: number
  deaths: number
  assists: number
  headshots: number
  score: number
  mvp: number
  hsp: number
  /** Steam 头像 data URI（demo 内嵌，可能缺失） */
  avatar?: string
}

export interface KillEvent {
  tick: number
  timeSec: number
  attackerSteamId?: string
  attackerName?: string
  attackerTeam: TeamSide
  victimSteamId?: string
  victimName?: string
  victimTeam: TeamSide
  weapon: string
  headshot: boolean
  throughSmoke: boolean
  roundNum: number
}

export type RoundWinner = 'T' | 'CT' | 'none'
export type RoundEndType =
  | 'bomb_exploded'
  | 'bomb_defused'
  | 'elimination'
  | 'timeout'
  | 'surrender'
  | 'unknown'

export interface RoundInfo {
  roundNum: number
  startTick: number
  endTick: number
  winner: RoundWinner
  endType: RoundEndType
  kills: KillEvent[]
  bombPlantedTick?: number
  bombDefusedTick?: number
  bombExplodedTick?: number
}

export type ChatChannel = 'ALL' | 'CT' | 'T' | 'DEAD' | 'SPEC' | 'ALLCHAT'

export interface ChatMessage {
  tick: number
  timeSec: number
  channel: ChatChannel
  playerName: string
  steamId?: string
  text: string
  roundNum: number
}

export type AsrEngine = 'local' | 'cloud'

export interface VoiceSegment {
  tick: number
  endTick: number
  timeSec: number
  endSec: number
  playerName: string
  steamId?: string
  team: TeamSide
  text: string
  roundNum?: number
  engine: AsrEngine
}

export interface DemoDetail {
  meta: DemoMeta
  rounds: RoundInfo[]
  chat: ChatMessage[]
  voice: VoiceSegment[]
  firstTick: number
  lastTick: number
}

// ─── 收藏 ───────────────────────────────────────────────────────────────────

export interface Favorite {
  id: string
  name: string
  sourcePath: string
  copyPath: string
  addedAt: number
}

// ─── demo 压缩包（zip 直接解析，内部缓存） ──────────────────────────────────

// 见 DemoMeta.containerPath；zip 内的 .dem 由工具解出到 userData 缓存目录解析/播放

// ─── AI 对话会话（记忆） ────────────────────────────────────────────────────

export interface AiChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface AiChatSession {
  id: string
  title: string
  demoId: string
  createdAt: number
  updatedAt: number
  messages: AiChatMessage[]
}

// ─── 实况 / 注入 ───────────────────────────────────────────────────────────

export type LiveState =
  | 'idle'          // 未检测到 cs2.exe
  | 'detected'      // cs2.exe 运行中，未连接控制台
  | 'connecting'
  | 'live'          // VConsole 已连接，可注入
  | 'error'

export interface LiveStatus {
  state: LiveState
  cs2Running: boolean
  vconsoleConnected: boolean
  gsiActive: boolean
  lastError?: string
  lastSeenAt?: number
}

export interface GsiGameState {
  map?: string
  phase?: string
  round?: number
  scoreT?: number
  scoreCT?: number
  bomb?: 'planted' | 'defused' | 'exploded' | 'carried' | 'dropped' | 'unknown' | null
  mode?: string
  timeRemaining?: number
  playersAliveT?: number
  playersAliveCT?: number
  moneyT?: number
  moneyCT?: number
}

export interface LaunchResult {
  ok: boolean
  url: string
  error?: string
  /** 已通过 VConsole 直接注入 playdemo 指令（CS2 运行中） */
  injected?: boolean
  /** 直接启动了 cs2.exe（而非 steam:// URL） */
  direct?: boolean
  exe?: string
}

// ─── 设置 ──────────────────────────────────────────────────────────────────

export type LocalWhisperModel = 'base' | 'small' | 'medium'

export interface Settings {
  language: 'zh' | 'en'
  libraryRoots: string[]
  ui: {
    theme: 'dark' | 'light'
  }
  asr: {
    engine: AsrEngine
    localModel: LocalWhisperModel
    cloudBaseUrl: string
    cloudApiKey: string
    cloudModel: string
  }
  ai: {
    baseUrl: string
    apiKey: string
    model: string
  }
  cs2: {
    installPath?: string
    vconsolePort: number
    gsiPort: number
    useToolsMode: boolean
  }
  overlay: {
    enabled: boolean
    position: OverlayPosition
    x?: number
    y?: number
    clickThrough: boolean
    scale: number
  }
}

export type OverlayPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'custom'

export const DEFAULT_SETTINGS: Settings = {
  language: 'zh',
  libraryRoots: [],
  ui: {
    theme: 'dark'
  },
  asr: {
    engine: 'local',
    localModel: 'small',
    cloudBaseUrl: 'https://api.groq.com/openai/v1',
    cloudApiKey: '',
    cloudModel: 'whisper-large-v3-turbo'
  },
  ai: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    model: 'llama-3.3-70b-versatile'
  },
  cs2: {
    vconsolePort: 29000,
    gsiPort: 30070,
    useToolsMode: true
  },
  overlay: {
    enabled: false,
    position: 'bottom-left',
    clickThrough: false,
    scale: 1
  }
}

// ─── IPC 契约 ──────────────────────────────────────────────────────────────

/** renderer -> main 调用 */
export interface Api {
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
  }
  library: {
    list: () => Promise<DemoMeta[]>
    detail: (id: string) => Promise<DemoDetail | null>
    addRoot: () => Promise<string[]>
    removeRoot: (root: string) => Promise<void>
    rescan: () => Promise<void>
    remove: (id: string, opts?: { deleteFile?: boolean }) => Promise<void>
    parse: (id: string) => Promise<void>
    parseAll: () => Promise<void>
  }
  favorites: {
    list: () => Promise<Favorite[]>
    add: (id: string) => Promise<Favorite>
    remove: (id: string) => Promise<void>
    reveal: () => Promise<void>
  }
  voice: {
    detect: (id: string) => Promise<{ hasVoice: boolean; voiceSec: number }>
    extract: (id: string) => Promise<number>
  }
  asr: {
    transcribe: (id: string, opts?: { players?: string[] }) => Promise<void>
    cancel: () => Promise<void>
  }
  ai: {
    ask: (
      id: string,
      question: string,
      history?: AiChatMessage[]
    ) => Promise<{ started: boolean; error?: string }>
    cancel: () => Promise<void>
    listModels: () => Promise<string[]>
    listChats: () => Promise<AiChatSession[]>
    saveChat: (session: AiChatSession) => Promise<void>
    removeChat: (id: string) => Promise<void>
  }
  live: {
    getStatus: () => Promise<LiveStatus>
    connect: () => Promise<LiveStatus>
    sendCommand: (cmd: string) => Promise<boolean>
    jumpTick: (tick: number) => Promise<boolean>
    pause: () => Promise<boolean>
    resume: () => Promise<boolean>
    setTimescale: (x: number) => Promise<boolean>
    specNext: () => Promise<boolean>
    specPrev: () => Promise<boolean>
    specGoto: (userid: number) => Promise<boolean>
    launch: (opts?: { toolsMode?: boolean; playDemoPath?: string }) => Promise<LaunchResult>
    installGsi: () => Promise<string | null>
    locateInstall: () => Promise<string | null>
  }
  overlay: {
    setEnabled: (enabled: boolean, demoId?: string) => Promise<void>
    setPosition: (pos: OverlayPosition) => Promise<void>
    setClickThrough: (on: boolean) => Promise<void>
    getState: () => Promise<OverlayState | null>
    setFullPanel: (enabled: boolean, demoId?: string) => Promise<void>
    command: (cmd: string, arg?: number) => Promise<void>
  }
  engines: {
    status: () => Promise<Record<string, boolean>>
    ensure: (kind: EngineKind) => Promise<void>
  }
  app: {
    version: () => Promise<string>
    revealInFolder: (path: string) => Promise<void>
  }
}

export type EngineKind = 'csgove' | 'whisper' | 'model-base' | 'model-small' | 'model-medium'

/** main -> renderer 事件 */
export type MainEvent =
  | { type: 'window:maximized'; maximized: boolean }
  | { type: 'library:updated'; demos: DemoMeta[] }
  | { type: 'library:progress'; id: string; stage: string; progress: number }
  | { type: 'library:detail'; id: string; detail: DemoDetail | null }
  | { type: 'library:detail'; id: string; detail: DemoDetail | null }
  | { type: 'live:status'; status: LiveStatus }
  | { type: 'live:console'; channel: string; text: string }
  | { type: 'gsi:state'; state: GsiGameState }
  | { type: 'asr:progress'; demoId: string; stage: string; done: number; total: number }
  | { type: 'asr:segment'; demoId: string; segment: VoiceSegment }
  | { type: 'ai:delta'; demoId: string; chunk: string }
  | { type: 'ai:done'; demoId: string; answer: string }
  | { type: 'ai:error'; demoId: string; error: string }
  | { type: 'engine:progress'; what: string; received: number; total: number }
  | { type: 'overlay:state'; state: OverlayState }
  | { type: 'voice:detected'; id: string; hasVoice: boolean; voiceSec: number }
  | { type: 'settings:changed'; settings: Settings }

export type MainEventType = MainEvent['type']

/** preload 暴露给 renderer 的事件订阅 */
export interface EventUnsubscribe {
  (): void
}

export interface ApiWithEvents extends Api {
  onEvent: <T extends MainEventType>(
    type: T,
    cb: (e: Extract<MainEvent, { type: T }>) => void
  ) => EventUnsubscribe
}

// ─── 通用 ──────────────────────────────────────────────────────────────────

export interface OverlaySpeaker {
  name: string
  team: TeamSide
  avatar?: string
}

export interface OverlayLine {
  text: string
  playerName: string
  team: TeamSide
  tick: number
}

export interface OverlayState {
  mode: 'demo' | 'live' | 'idle'
  tick: number
  tickRate: number
  map?: string
  round?: number
  scoreT?: number
  scoreCT?: number
  speakers: OverlaySpeaker[]
  lines: OverlayLine[]
  /** 全屏面板数据 */
  full?: boolean
  events?: {
    type: 'kill' | 'voice' | 'bomb'
    tick: number
    text: string
    sub?: string
    team?: TeamSide
  }[]
  players?: { name: string; team: TeamSide; kills: number; deaths: number; hs: number }[]
  rounds?: { num: number; startTick: number; endTick: number; winner: 'T' | 'CT' | 'none' }[]
}

export interface JobProgress {
  demoId: string
  stage: 'scan' | 'parse' | 'voice-extract' | 'asr-local' | 'asr-cloud'
  done: number
  total: number
  message?: string
}
