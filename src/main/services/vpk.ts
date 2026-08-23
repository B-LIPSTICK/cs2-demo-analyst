/**
 * VPK v1/v2 打包 + vjs_c（Panorama 编译 JS）资源生成（纯字节，零依赖）
 *
 * 格式事实（CS2 游戏文件格式 + SwiftDemoUIPro 生产 VPK 逆向验证）:
 *  - VPK v2（CS2 overrides 必需）: 28B 头(signature/version/treeSize/fileDataSize/
 *    archiveMD5Size/otherMD5Size/signatureSize) + 目录树 + 数据 + otherMD5 区
 *  - otherMD5 区 = 48B: tree 的 MD5(16B) + MD5("")(16B) + 16B 零（参考生产 VPK 逆向）
 *  - 目录树条目: ext\0 path\0 name\0 + u32 crc32 + u16 preload(0) + u16 0x7fff(内嵌)
 *               + u32 offset(相对数据区) + u32 length + u16 0xffff(结束)；条目 4 字节对齐
 *  - vjs_c: Source2 资源头(u32 fileSize / u32 0x0004000c / u32 8 / u32 2)
 *           + "RED2" 空块 + "DATA" 块 + JS UTF-8，填充到 48 字节后接 JS
 */
import { createHash } from 'node:crypto'

export const VPK_SIGNATURE = 0x55aa1234
export const VPK_VERSION = 1
export const VPK_EMBEDDED_ARCHIVE_INDEX = 0x7fff
export const VPK_ENTRY_TERMINATOR = 0xffff

/** 标准 CRC32（IEEE 802.3） */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit++) {
      const mask = (crc & 1) !== 0 ? 0xedb88320 : 0
      crc = (crc >>> 1) ^ mask
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * 把 Panorama JS 编译成 vjs_c 资源（vjs [Version 4] 最小形态:
 * Source2 资源头 + 空 RED2 块 + DATA 块 + JS）
 */
export function buildVjsResource(source: string | Uint8Array): Uint8Array {
  const src = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source)
  const resource = Buffer.alloc(48 + src.length)
  resource.writeUInt32LE(0, 0) // fileSize，最后回填
  resource.writeUInt32LE(0x0004000c, 4) // vjs Version 4
  resource.writeUInt32LE(8, 8) // Source2 resource version
  resource.writeUInt32LE(2, 12) // block 数
  resource.write('RED2', 16, 'latin1')
  resource.writeUInt32LE(28, 20)
  resource.writeUInt32LE(0, 24)
  resource.write('DATA', 28, 'latin1')
  resource.writeUInt32LE(16, 32)
  resource.writeUInt32LE(src.length, 36)
  // 40..48 留零（对齐填充）
  src.copy(resource, 48)
  resource.writeUInt32LE(resource.length, 0)
  return resource
}

export interface VpkEntry {
  /** 文件扩展名（不含点），如 "vjs_c" / "txt" */
  ext: string
  /** 目录路径，如 "panorama/scripts/hud" */
  path: string
  /** 文件名（不含扩展名），如 "dsh_voice_data" */
  name: string
  data: Uint8Array
}

/** 打包 VPK（version 1 或 2；CS2 overrides 需 v2——参考 SwiftDemoUIPro 生产 VPK 为 v2）。
 *  v2 = 28B 头（含 fileDataSize + 三个 MD5 区大小）+ 树 + 数据；MD5 区留空（-insecure 下不校验）。
 *
 *  树布局（逐字节逆向 VPKEdit 产物 swift-ref.vpk 确认）:
 *    [ext\0] [dir\0] (name\0 + crc u32 + preload u16 + archive u16 + offset u32 + size u32 + 0xffff u16)*
 *    [\0 空name = dir 结束] [\0 空dir = ext 结束] ... [\0 空ext = 树结束]
 *  同 ext 同 dir 的文件共享组头；无 4 字节对齐；数据区按树条目顺序排列。 */
export function buildVpk(entries: VpkEntry[], version: 1 | 2 = 2): Uint8Array {
  // ① 目录树（按 ext → dir → 文件 分组，保持出现顺序）
  const chunks: Buffer[] = []
  const offsetInfos: { offsetPos: number; dataStart: number }[] = []
  let dataStart = 0

  const pushStr = (chunks: Buffer[], s: string): number => {
    const b = Buffer.alloc(s.length + 1)
    b.write(s, 0, 'latin1')
    chunks.push(b)
    return b.length
  }

  // 分组: Map<ext, Map<dir, {name, data}[]>>
  const extMap = new Map<string, Map<string, { name: string; data: Uint8Array }[]>>()
  for (const e of entries) {
    let dirMap = extMap.get(e.ext)
    if (!dirMap) {
      dirMap = new Map()
      extMap.set(e.ext, dirMap)
    }
    let files = dirMap.get(e.path)
    if (!files) {
      files = []
      dirMap.set(e.path, files)
    }
    files.push({ name: e.name, data: e.data })
  }

  let treeLen = 0
  for (const [ext, dirMap] of extMap) {
    treeLen += pushStr(chunks, ext)
    for (const [dir, files] of dirMap) {
      treeLen += pushStr(chunks, dir)
      for (const f of files) {
        const entryStart = treeLen
        const header = Buffer.alloc(f.name.length + 1 + 16 + 2)
        let p = 0
        header.write(f.name + '\0', p, 'latin1'); p += f.name.length + 1
        header.writeUInt32LE(crc32(f.data), p); p += 4
        header.writeUInt16LE(0, p); p += 2 // preloadBytes
        header.writeUInt16LE(VPK_EMBEDDED_ARCHIVE_INDEX, p); p += 2
        offsetInfos.push({ offsetPos: entryStart + p, dataStart })
        header.writeUInt32LE(0, p); p += 4 // offset 占位（后回填）
        header.writeUInt32LE(f.data.length, p); p += 4 // size
        header.writeUInt16LE(VPK_ENTRY_TERMINATOR, p); p += 2
        chunks.push(header)
        treeLen += header.length
        dataStart += f.data.length
      }
      treeLen += pushStr(chunks, '') // 空 name = dir 文件列表结束
    }
    treeLen += pushStr(chunks, '') // 空 dir = ext 结束
  }
  treeLen += pushStr(chunks, '') // 空 ext = 树结束

  // ② 回填数据偏移
  const flat: { chunk: Buffer; start: number }[] = []
  let acc = 0
  for (const c of chunks) {
    flat.push({ chunk: c, start: acc })
    acc += c.length
  }
  for (const info of offsetInfos) {
    for (const { chunk, start } of flat) {
      if (start <= info.offsetPos && info.offsetPos < start + chunk.length) {
        chunk.writeUInt32LE(info.dataStart, info.offsetPos - start)
        break
      }
    }
  }

  // ③ 组装（布局 = header + tree + archiveMD5(0) + data + otherMD5(48B)@末尾）
  //    参考 SwiftDemoUIPro 生产 VPK 逐字节验证: 数据区紧跟树之后，otherMD5 区在文件末尾。
  const headerSize = version === 2 ? 28 : 12
  const otherMd5Size = version === 2 ? 48 : 0
  const out = Buffer.alloc(headerSize + treeLen + totalData(entries) + otherMd5Size)
  out.writeUInt32LE(VPK_SIGNATURE, 0)
  out.writeUInt32LE(version, 4)
  out.writeUInt32LE(treeLen, 8)
  if (version === 2) {
    out.writeUInt32LE(totalData(entries), 12) // fileDataSectionSize
    out.writeUInt32LE(0, 16) // archiveMD5SectionSize
    out.writeUInt32LE(48, 20) // otherMD5SectionSize
    out.writeUInt32LE(0, 24) // signatureSectionSize
  }
  let off = headerSize
  for (const c of chunks) {
    c.copy(out, off)
    off += c.length
  }
  for (const e of entries) {
    Buffer.from(e.data).copy(out, off)
    off += e.data.length
  }
  if (version === 2) {
    // otherMD5 区（文件末尾）: tree MD5 + MD5("") + 16B 零（参考 SwiftDemoUIPro 生产 VPK）
    const treeBuf = Buffer.concat(chunks)
    out.write(createHash('md5').update(treeBuf).digest('hex'), off, 'hex')
    out.write(createHash('md5').update(Buffer.alloc(0)).digest('hex'), off + 16, 'hex')
  }
  return out
}

function totalData(entries: VpkEntry[]): number {
  let n = 0
  for (const e of entries) n += e.data.length
  return n
}

/** 生成会话语音数据 JS 源（注入 vjs_c 的内容） */
export function buildVoiceDataJs(payload: {
  holdTicks?: number
  voicePacketCount: number
  pulsesBySlot: Record<string, number[]>
  players?: Record<string, { name?: string; team?: string }>
}): string {
  const p = {
    schemaVersion: 1,
    generated: true,
    holdTicks: payload.holdTicks ?? 30,
    voicePacketCount: payload.voicePacketCount,
    pulsesBySlot: payload.pulsesBySlot,
    players: payload.players ?? {}
  }
  return '"use strict";var DshVoiceData=' + JSON.stringify(p) + ';'
}
