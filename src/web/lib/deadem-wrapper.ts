/**
 * deadem UMD 浏览器 bundle 的运行时适配层。
 * 值从全局 `window.deademCs2` 获取（由 index.html 的 /deadem-cs2.min.js 提供，依赖全内联），
 * 类型来自 npm 包 @deademx/cs2。绕开 Vite 对 deadem 的 ESM/worker/CJS 依赖处理问题。
 */
import type {
  InterceptorStage as IInterceptorStage,
  MessagePacketType as IMessagePacketType,
  Parser as IParser,
  ParserConfiguration as IParserConfiguration,
  StringTableType as IStringTableType
} from '@deademx/cs2'

const g = globalThis as unknown as {
  deademCs2?: {
    Parser: typeof IParser
    ParserConfiguration: typeof IParserConfiguration
    MessagePacketType: typeof IMessagePacketType
    InterceptorStage: typeof IInterceptorStage
    StringTableType: typeof IStringTableType
  }
}

const d = g.deademCs2
if (!d) {
  throw new Error('deadem-cs2.min.js 未加载（index.html 需引入 /deadem-cs2.min.js）')
}

export const Parser = d.Parser
export const ParserConfiguration = d.ParserConfiguration
export const MessagePacketType = d.MessagePacketType
export const InterceptorStage = d.InterceptorStage
export const StringTableType = d.StringTableType
