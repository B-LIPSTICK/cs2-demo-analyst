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

export interface DetectedPlatformRoot {
  platform: 'wmpvp' | '5eplay' | 'steam' | 'other'
  name: string
  path: string
  demoCount: number
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
  /** 场均伤害 (Average Damage per Round) */
  adr?: number
  /** 总有效伤害 (Total Damage Dealt) */
  totalDamage?: number
  /** KAST 达成百分比 (0 - 100) */
  kast?: number
  /** HLTV Rating 2.0 近似评分 */
  rating?: number
  /** 首杀次数 (First Kills / Opening Kills) */
  firstKills?: number
  /** 首死次数 (First Deaths / Opening Deaths) */
  firstDeaths?: number
  /** 投掷物总伤害 (Utility Damage) */
  utilityDamage?: number
  /** 场均投掷物伤害 (Utility Damage per Round) */
  utilityDamagePerRound?: number
  /** 闪光助攻 (Flash Assists) */
  flashAssists?: number
  /** 致盲敌方次数 (Enemies Blinded) */
  enemiesBlinded?: number
  /** 致盲敌方总时长 (秒) */
  enemyBlindDuration?: number
  /** 误闪队友次数 (Teammates Blinded) */
  teammatesBlinded?: number
  /** 误闪队友总时长 (秒) */
  teamBlindDuration?: number
}

export interface KillEvent {
  tick: number
  timeSec: number
  /** 原始 userid（5E 等平台实体补全时用于回填名字） */
  attackerUid?: number
  attackerSteamId?: string
  attackerName?: string
  attackerTeam: TeamSide
  victimUid?: number
  victimSteamId?: string
  victimName?: string
  victimTeam: TeamSide
  assisterUid?: number
  weapon: string
  headshot: boolean
  throughSmoke: boolean
  /** 穿透 / 穿墙击杀 (Wallbang) */
  penetrated?: boolean
  /** 盲狙击杀 (No-Scope) */
  noScope?: boolean
  /** 闪光助攻 (Flash Assist) */
  flashAssist?: boolean
  /** 击杀者致盲中 (Attacker Blind) */
  attackerBlind?: boolean
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

export type BuyType = 'full' | 'semi' | 'force' | 'eco'

export interface TeamRoundEconomy {
  /** 装备总价值 (Equipment Value) */
  equipValue: number
  /** 回合开始总剩余现金 (Start Cash) */
  startCash: number
  /** 本回合消费 (Cash Spent) */
  spentCash: number
  /** 买枪类型判定 */
  buyType: BuyType
  /** 连败补偿等级 (0 - 4，对应 $1400~$3400) */
  lossBonusLevel: number
  /** 本回合连败补偿金额 ($1400, $1900, $2400, $2900, $3400) */
  lossBonusAmount: number
}

export interface RoundEconomy {
  t: TeamRoundEconomy
  ct: TeamRoundEconomy
}

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
  economy?: RoundEconomy
  firstKill?: KillEvent
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
  /** 解析器版本（library 写缓存时记录；读取时版本不匹配 → 强制重新解析） */
  parserVersion?: number
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
  vconsoleConnected?: boolean
  gsiActive?: boolean
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
  /** 复制到 CS2 目录后的 demo 文件名（playdemo 注入用） */
  demoFile?: string
  /** CS2 启动中，demo 将在 VConsole 就绪后自动播放 */
  starting?: boolean
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
    /** 转写语言（whisper ISO-639-1 代码；'auto'=自动检测）。中文语音建议 'zh'（简体输出） */
    language: string
  }
  ai: {
    baseUrl: string
    apiKey: string
    model: string
  }
  cs2: {
    installPath?: string
    vconsolePort?: number
    gsiPort?: number
    useToolsMode?: boolean
    /** 用户自定义启动项（空格分隔，如 "-novid"），软件启动 CS2 时自动带上 */
    launchArgs?: string
    playMode?: 'tools' | 'native'
    playResolution?: string
    /** 游戏内语音 HUD：VPK 注入 Panorama，普通模式播放时在 CS2 画面内显示说话者 */
    voiceHud?: boolean
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
    cloudModel: 'whisper-large-v3-turbo',
    language: 'auto'
  },
  ai: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'Qwen/Qwen2.5-7B-Instruct'
  },
  cs2: {
    launchArgs: '',
    playMode: 'tools',
    voiceHud: false
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
    parse: (id: string, force?: boolean) => Promise<void>
    parseAll: () => Promise<void>
    detectPlatformRoots: () => Promise<DetectedPlatformRoot[]>
    autoAddPlatformRoots: () => Promise<{ added: DetectedPlatformRoot[]; roots: string[] }>
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
    split: (id: string) => Promise<number>
    play: (
      demoId: string,
      seg: { steamId?: string; playerName: string; startSec: number; endSec: number }
    ) => Promise<string | null>
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
    launch: (opts?: {
      toolsMode?: boolean
      playDemoPath?: string
      voiceHud?: boolean
      startTick?: number
    }) => Promise<LaunchResult>
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
    cancel: (kind: string) => Promise<boolean>
    openFolder: () => Promise<string>
  }
  app: {
    version: () => Promise<string>
    revealInFolder: (path: string) => Promise<void>
    pickDirectory: () => Promise<string | null>
    /** 用系统浏览器打开外部链接（更新下载页等） */
    openUrl: (url: string) => Promise<void>
  }
}

export type EngineKind = 'csgove' | 'whisper' | 'model-base' | 'model-small' | 'model-medium'

/** main -> renderer 事件 */
export type MainEvent =
  | { type: 'window:maximized'; maximized: boolean }
  | { type: 'library:updated'; demos: DemoMeta[] }
  | { type: 'library:item'; id: string; meta: DemoMeta }
  | { type: 'library:progress'; id: string; stage: string; progress: number }
  | { type: 'library:detail'; id: string; detail: DemoDetail | null }
  | { type: 'library:detail'; id: string; detail: DemoDetail | null }
  | { type: 'live:status'; status: LiveStatus }
  | { type: 'live:console'; channel: string; text: string }
  | { type: 'gsi:state'; state: GsiGameState }
  | { type: 'asr:progress'; demoId: string; stage: string; done: number; total: number; message?: string }
  | { type: 'asr:segment'; demoId: string; segment: VoiceSegment }
  | { type: 'ai:delta'; demoId: string; chunk: string }
  | { type: 'ai:done'; demoId: string; answer: string }
  | { type: 'ai:error'; demoId: string; error: string }
  | { type: 'engine:progress'; what: string; received: number; total: number }
  | { type: 'overlay:state'; state: OverlayState }
  | { type: 'voice:detected'; id: string; hasVoice: boolean; voiceSec: number }
  | { type: 'settings:changed'; settings: Settings }
  | { type: 'update:available'; version: string; url: string }

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
