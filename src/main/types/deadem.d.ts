/**
 * @deademx/cs2 最小类型声明（库本身为纯 JS）
 */
declare module '@deademx/cs2' {
  export class MessagePacketType {
    readonly code: string
    static readonly SVC_SERVER_INFO: MessagePacketType
    static readonly SVC_CREATE_STRING_TABLE: MessagePacketType
    static readonly SVC_UPDATE_STRING_TABLE: MessagePacketType
    static readonly SVC_VOICE_DATA: MessagePacketType
    static readonly SVC_PACKET_ENTITIES: MessagePacketType
    static readonly GE_SOURCE1_LEGACY_GAME_EVENT_LIST: MessagePacketType
    static readonly GE_SOURCE1_LEGACY_GAME_EVENT: MessagePacketType
    static readonly USER_MESSAGE_SAY_TEXT_2: MessagePacketType
  }

  export class ParserConfiguration {
    constructor(opts?: {
      messagePacketTypes?: MessagePacketType[]
      entityClasses?: string[]
      breakInterval?: number
    })
  }

  export class Parser {
    constructor(config?: ParserConfiguration)
    registerPostInterceptor(
      stage: unknown,
      fn: (demoPacket: DemoPacketLike, messagePacket?: MessagePacketLike) => void | Promise<void>
    ): void
    parse(stream: unknown): Promise<void>
    getDemo(): DemoLike
    dispose(): Promise<void>
  }

  export const InterceptorStage: {
    DEMO_PACKET: unknown
    MESSAGE_PACKET: unknown
    ENTITY_PACKET: unknown
  }

  export const StringTableType: {
    USER_INFO: { name: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface DemoPacketLike {
    tick: number
    getIsInitial(): boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface MessagePacketLike {
    type: MessagePacketType
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface DemoLike {
    stringTableContainer: {
      getByName(name: string): {
        getEntries(): { key?: string | number; value: unknown }[]
      } | null
      getTables(): { name: string; getEntriesCount(): number }[]
    }
    getEntitiesByClassName(name: string): {
      getField(name: string): unknown
      fieldNames(): Iterable<string>
    }[]
    getClasses(): { name: string }[]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class Printer {
    constructor(parser: Parser)
    printStats(): void
  }
}
