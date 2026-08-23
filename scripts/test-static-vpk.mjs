/**
 * 静态 VPK 解析验证（assets/panorama/dsh_voice_override.vpk）
 * v2 布局: 28B 头 + 树（ext→dir→name 分组，空 name/空 dir/空 ext 分隔）+ 数据 + otherMD5(48B)@末尾
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from '../src/main/services/vpk.ts'

const vpk = await fs.readFile(join(process.cwd(), 'assets', 'panorama', 'dsh_voice_override.vpk'))
console.log(`VPK: ${vpk.length}B`)

const sig = vpk.readUInt32LE(0)
const ver = vpk.readUInt32LE(4)
const treeSize = vpk.readUInt32LE(8)
const fileDataSize = vpk.readUInt32LE(12)
const otherMd5Size = vpk.readUInt32LE(20)
console.log(`sig=0x${sig.toString(16)} ver=${ver} treeSize=${treeSize} fileData=${fileDataSize} otherMD5=${otherMd5Size}`)
if (sig !== 0x55aa1234 || ver !== 2) throw new Error('头错误（需 v2）')
if (otherMd5Size !== 48) throw new Error('otherMD5 区大小错误')

const treeEnd = 28 + treeSize
let pos = 28
const readCStr = () => {
  const start = pos
  while (pos < treeEnd && vpk[pos] !== 0) pos++
  const s = vpk.toString('latin1', start, pos)
  pos++ // \0
  return s
}
const entries = []
// v2 树: [ext\0] [dir\0] (name\0 crc u32 preload u16 archive u16 offset u32 size u32 0xffff u16)* [\0] [\0] ... [\0]
for (;;) {
  const ext = readCStr()
  if (ext === '') break // 空 ext = 树结束
  for (;;) {
    const path = readCStr()
    if (path === '') break // 空 dir = ext 结束
    for (;;) {
      const name = readCStr()
      if (name === '') break // 空 name = dir 结束
      const crc = vpk.readUInt32LE(pos); pos += 4
      const preload = vpk.readUInt16LE(pos); pos += 2
      const archiveIndex = vpk.readUInt16LE(pos); pos += 2
      const offset = vpk.readUInt32LE(pos); pos += 4
      const length = vpk.readUInt32LE(pos); pos += 4
      const term = vpk.readUInt16LE(pos); pos += 2
      if (term !== 0xffff) throw new Error(`条目终止符错误: 0x${term.toString(16)}`)
      entries.push({ path, name, ext, crc, preload, archiveIndex, offset, length, term })
    }
  }
}
if (pos !== treeEnd) throw new Error(`树解析结束位置 ${pos} != 声称 ${treeEnd}`)

console.log(`条目数: ${entries.length}（应为 4）`)
// v2 布局: 数据区紧跟树后；otherMD5(48B) 在文件末尾
const dataStart = treeEnd
const dataEnd = dataStart + fileDataSize
const omStart = dataEnd
if (omStart + otherMd5Size !== vpk.length) throw new Error(`otherMD5 位置错误: ${omStart}+${otherMd5Size} != ${vpk.length}`)
let ok = true
for (const e of entries) {
  const data = vpk.subarray(dataStart + e.offset, dataStart + e.offset + e.length)
  const crcOk = crc32(data) === e.crc
  if (!crcOk) ok = false
  const head = data.subarray(0, 8).toString('latin1').replace(/[^\x20-\x7e]/g, '.')
  console.log(`  ${e.path}/${e.name}.${e.ext} off=${e.offset} len=${e.length} crc=${crcOk ? 'OK' : 'FAIL'} 头="${head}"`)
}
if (entries.length !== 4 || !ok) throw new Error('静态 VPK 校验失败')
console.log('✓ 静态 VPK 结构验证通过（v2 布局: 4 条目 CRC 全 OK + otherMD5 在末尾）')
