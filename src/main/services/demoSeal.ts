/**
 * CS2 demo「封口」修复。
 *
 * 背景：部分第三方平台（实测 5E）写盘被打断时，文件尾部会被截断：DEM_FileInfo
 * 整块丢失、头部记的 fileinfo 偏移指向文件外。
 * 这种文件我们的解析器能读（容忍截断），但 CS2 引擎读完帧后会去找 fileinfo，
 * 找不到就永远停在加载条上——用户看到的现象是「卡在加载条」。
 *
 * 实测见过两种截断位置：
 *  a) 截断点落在「spawn groups 帧」中途——帧流里已经有 DEM_Stop；
 *  b) 截断点落在「DEM_Packet 播放数据」中途——DEM_Stop 整块丢失。
 *     （2026-11-21 的 5E demo：zip 声明 csize 比实际多 6,078 字节，
 *      解出的 dem 比声明 usize 少 8,239 字节，最后一帧完整帧是 DEM_Packet。
 *      整场比赛数据都在，只丢了最后几 KB 收尾。）
 *
 * 修法：丢掉残缺的尾帧，必要时补一条合成的 DEM_Stop，再补空的 spawn groups 帧
 * 与合成 fileinfo，并把头部两个偏移改回真实位置。文件本身（缓存）不动，
 * 只在播放用的暂存副本上做。
 *
 * 结构（实测，字节级确认）：
 *   头 16B: "PBDEMS2\0" + int32LE fileinfo 帧偏移 + int32LE spawnGroups 帧偏移 + int32LE -255
 *   帧:     varU32 cmd + varU32 tick + varU32 size + payload
 *   尾部:   DEM_Packet(7) → DEM_Stop(0) → spawnGroups(79) → DEM_FileInfo(2)
 */
import { promises as fs } from 'node:fs'

const HEADER_SIZE = 16
const FILEINFO_OFFSET_POS = 8
const SPAWNGROUPS_OFFSET_POS = 12
const MAGIC = 'PBDEMS2\u0000'

const DEM_STOP = 0
const DEM_FILEINFO = 2
const DEM_SPAWNGROUPS = 79

interface FrameRef {
  cmd: number
  tick: number
  size: number
  start: number
  end: number
}

function readVarU32(buf: Buffer, start: number, limit: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  let pos = start
  while (pos < limit && shift <= 28) {
    const byte = buf[pos++]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos }
    shift += 7
  }
  return null
}

function writeVarU32(out: number[], value: number): void {
  let rest = value >>> 0
  do {
    let byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    if (rest !== 0) byte |= 0x80
    out.push(byte)
  } while (rest !== 0)
}

function readFrameAt(buf: Buffer, start: number, limit: number): FrameRef | null {
  const cmd = readVarU32(buf, start, limit)
  if (!cmd) return null
  const tick = readVarU32(buf, cmd.next, limit)
  if (!tick) return null
  const size = readVarU32(buf, tick.next, limit)
  if (!size) return null
  return {
    cmd: cmd.value,
    tick: tick.value,
    size: size.value,
    start,
    end: size.next + size.value
  }
}

/** 判断一个 demo 是否是「尾部被截断」的坏文件。只看头部，O(1)。 */
export function isTruncatedDemo(buf: Buffer): boolean {
  if (buf.length < HEADER_SIZE + 8) return false
  if (buf.subarray(0, 8).toString('latin1') !== MAGIC) return false
  const fileInfoOffset = buf.readInt32LE(FILEINFO_OFFSET_POS)
  // 正常文件里 fileinfo 帧一定在文件内；指向文件外就是被截断了。
  return fileInfoOffset <= 0 || fileInfoOffset > buf.length
}

/**
 * 尝试封口。成功返回修好的 Buffer，失败返回 null（调用方原样复制即可）。
 * 处理「截断点在 spawn groups 帧内」与「截断点在播放数据里、DEM_Stop 丢失」两种。
 */
export function sealTruncatedDemo(buf: Buffer): Buffer | null {
  if (!isTruncatedDemo(buf)) return null
  const size = buf.length
  const declaredSpawnGroups = buf.readInt32LE(SPAWNGROUPS_OFFSET_POS)

  const spawnGroups = readFrameAt(buf, declaredSpawnGroups, size)
  if (spawnGroups && spawnGroups.cmd === DEM_SPAWNGROUPS && spawnGroups.end <= size) {
    // 截断点就在 spawn groups 帧里：它前面一帧应当是 DEM_Stop。
    return buildSealed(buf, spawnGroups.start, spawnGroups.tick, false)
  }

  // 头部记的位置不可用：退化成从头扫一遍，找最后一个完整帧。
  let pos = HEADER_SIZE
  let last: FrameRef | null = null
  while (pos < size) {
    const frame = readFrameAt(buf, pos, size)
    if (!frame) break
    if (frame.end > size) break
    last = frame
    pos = frame.end
  }
  if (!last) return null
  // 最后一个完整帧可能就是 DEM_Stop（截断发生在 spawn groups 里，但头部偏移也坏了）；
  // 也可能还是 DEM_Packet（截断发生在播放数据里，DEM_Stop 整块丢失）。
  // 后一种情况下整场比赛的帧都完整，只是缺收尾，补一条 DEM_Stop 即可——
  // 实测 CS2 认这种文件，能从加载条进游戏。
  return buildSealed(buf, last.end, last.tick, last.cmd !== DEM_STOP)
}

function buildSealed(
  buf: Buffer,
  keepEnd: number,
  tick: number,
  needStop: boolean
): Buffer | null {
  // keepEnd 之前必须帧帧完整、首尾相接；needStop 为假时还要求它前面那帧是 DEM_Stop。
  let cursor = HEADER_SIZE
  let prev: FrameRef | null = null
  while (cursor < keepEnd) {
    const frame = readFrameAt(buf, cursor, buf.length)
    if (!frame || frame.end > keepEnd) return null
    prev = frame
    cursor = frame.end
  }
  if (cursor !== keepEnd) return null
  if (!needStop && (!prev || prev.cmd !== DEM_STOP)) return null

  const chunks: Buffer[] = [buf.subarray(0, keepEnd)]

  // 补一条合成的 DEM_Stop：正常文件里它紧跟在最后一个 DEM_Packet 之后，
  // tick 与那一包相同（实测 82MB 健康 5E/完美 demo 都是这个形态）。
  let stopLen = 0
  if (needStop) {
    const stopFrame: number[] = []
    writeVarU32(stopFrame, DEM_STOP)
    writeVarU32(stopFrame, tick)
    writeVarU32(stopFrame, 0)
    const stopBuf = Buffer.from(stopFrame)
    stopLen = stopBuf.length
    chunks.push(stopBuf)
  }

  // 空的 spawn groups：proto 全默认值，Snappy 压缩后就是 1 字节 0x00。
  // 注意偏移要算上刚补的 DEM_Stop，否则头部两个偏移会指错位置。
  const spawnGroupsStart = keepEnd + stopLen
  const sgFrame: number[] = []
  writeVarU32(sgFrame, DEM_SPAWNGROUPS)
  writeVarU32(sgFrame, tick)
  writeVarU32(sgFrame, 1)
  chunks.push(Buffer.from([...sgFrame, 0x00]))

  // 合成 fileinfo：field1=playback_time(float 秒) / field2=playback_ticks / field3=playback_frames
  // 实测所有健康 demo 都是 time = stopTick/64、ticks = stopTick、frames = stopTick + 1，
  // 照这个不变式填，别自己发明比例。
  const fileInfoStart = spawnGroupsStart + sgFrame.length + 1
  const payload: number[] = [0x0d]
  const timeBytes = Buffer.alloc(4)
  timeBytes.writeFloatLE(tick / 64, 0)
  payload.push(...timeBytes)
  payload.push(0x10)
  writeVarU32(payload, tick)
  payload.push(0x18)
  writeVarU32(payload, tick + 1)

  const fiFrame: number[] = []
  writeVarU32(fiFrame, DEM_FILEINFO)
  writeVarU32(fiFrame, tick)
  writeVarU32(fiFrame, payload.length)
  fiFrame.push(...payload)
  chunks.push(Buffer.from(fiFrame))

  const out = Buffer.concat(chunks)
  out.writeInt32LE(fileInfoStart, FILEINFO_OFFSET_POS)
  out.writeInt32LE(spawnGroupsStart, SPAWNGROUPS_OFFSET_POS)
  return out
}

/** 只看头部 16 字节，判断是不是坏文件。避免为了判断而把 200MB 读进内存。 */
async function looksTruncated(path: string): Promise<boolean> {
  let fh
  try {
    fh = await fs.open(path, 'r')
    const head = Buffer.alloc(HEADER_SIZE)
    const { bytesRead } = await fh.read(head, 0, HEADER_SIZE, 0)
    if (bytesRead < HEADER_SIZE) return false
    if (head.subarray(0, 8).toString('latin1') !== MAGIC) return false
    const fileInfoOffset = head.readInt32LE(FILEINFO_OFFSET_POS)
    const { size } = await fh.stat()
    return fileInfoOffset <= 0 || fileInfoOffset > size
  } catch {
    return false
  } finally {
    await fh?.close().catch(() => {})
  }
}

/**
 * 复制 demo 到播放暂存位置；源文件尾被截断时写封口后的版本。
 * 返回 true 表示做了修复。
 */
export async function copyDemoForPlay(src: string, dest: string): Promise<boolean> {
  // 正常文件（绝大多数）只读一次头部，然后整文件流式复制，不占内存。
  if (!(await looksTruncated(src))) {
    await fs.copyFile(src, dest)
    return false
  }
  const buf = await fs.readFile(src)
  const sealed = sealTruncatedDemo(buf)
  await fs.writeFile(dest, sealed ?? buf)
  return sealed !== null
}

/**
 * 检查已存在的暂存副本是否本身就是坏文件（上一版程序复制过去的），
 * 是则就地封口。返回 true 表示做了修复。
 */
export async function repairStagedDemo(path: string): Promise<boolean> {
  if (!(await looksTruncated(path))) return false
  const buf = await fs.readFile(path)
  const sealed = sealTruncatedDemo(buf)
  if (!sealed) return false
  await fs.writeFile(path, sealed)
  return true
}
