/**
 * CS2 demo「封口」修复。
 *
 * 背景：部分第三方平台（实测 5E）写盘被打断时，会在「spawn groups 帧」中途截断，
 * 于是文件末尾的 DEM_FileInfo 整块丢失、头部记的 fileinfo 偏移指向文件外。
 * 这种文件我们的解析器能读（容忍截断），但 CS2 引擎读完帧后会去找 fileinfo，
 * 找不到就永远停在加载条上——用户看到的现象是「卡在加载条」。
 *
 * 修法：丢掉残缺的尾帧，补一条空的 spawn groups 帧，再补一条合成的 fileinfo，
 * 并把头部两个偏移改回真实位置。文件本身（缓存）不动，只在播放用的暂存副本上做。
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
 * 只处理「截断点落在 spawn groups 帧内」这一种情况，其余不算修改。
 */
export function sealTruncatedDemo(buf: Buffer): Buffer | null {
  if (!isTruncatedDemo(buf)) return null
  const size = buf.length
  const declaredSpawnGroups = buf.readInt32LE(SPAWNGROUPS_OFFSET_POS)

  let spawnGroups = readFrameAt(buf, declaredSpawnGroups, size)
  if (
    !spawnGroups ||
    spawnGroups.cmd !== DEM_SPAWNGROUPS ||
    spawnGroups.end <= size
  ) {
    // 头部记的位置不可用：退化成从头扫一遍，找最后一个完整帧。
    spawnGroups = null
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
    // 最后一个完整帧必须是 DEM_Stop，否则截断发生在播放数据里，修不了。
    if (last.cmd !== DEM_STOP) return null
    return buildSealed(buf, last.end, last.tick)
  }

  // 截断点就在 spawn groups 帧里：它前面一帧应当是 DEM_Stop。
  return buildSealed(buf, spawnGroups.start, spawnGroups.tick)
}

function buildSealed(buf: Buffer, keepEnd: number, tick: number): Buffer | null {
  // keepEnd 之前必须正好停在 DEM_Stop 之后；抽查它前面那个帧头是不是 Stop。
  let cursor = HEADER_SIZE
  let prev: FrameRef | null = null
  while (cursor < keepEnd) {
    const frame = readFrameAt(buf, cursor, buf.length)
    if (!frame || frame.end > keepEnd) return null
    prev = frame
    cursor = frame.end
  }
  if (!prev || prev.cmd !== DEM_STOP) return null

  const chunks: Buffer[] = [buf.subarray(0, keepEnd)]

  // 空的 spawn groups：proto 全默认值，Snappy 压缩后就是 1 字节 0x00。
  const spawnGroupsStart = keepEnd
  const sgFrame: number[] = []
  writeVarU32(sgFrame, DEM_SPAWNGROUPS)
  writeVarU32(sgFrame, tick)
  writeVarU32(sgFrame, 1)
  chunks.push(Buffer.from([...sgFrame, 0x00]))

  // 合成 fileinfo：field1=playback_time(float) / field2=playback_ticks / field3=playback_frames
  const fileInfoStart = keepEnd + sgFrame.length + 1
  const payload: number[] = [0x0d]
  const timeBytes = Buffer.alloc(4)
  timeBytes.writeFloatLE(tick / 64, 0)
  payload.push(...timeBytes)
  payload.push(0x10)
  writeVarU32(payload, tick)
  payload.push(0x18)
  writeVarU32(payload, tick)

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
