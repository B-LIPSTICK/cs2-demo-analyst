/**
 * 会话 VPK 生成 + 自解析验证（确保 buildVpk 产物可被 CS2 读取）
 * v2 布局: 28B 头 + 树（ext→dir→name 分组，空 name/空 dir/空 ext 分隔）+ 数据 + otherMD5(48B)@末尾
 * 用法: node --experimental-strip-types scripts/test-session-vpk.mjs
 */
import { buildVpk, buildVjsResource, buildVoiceDataJs, crc32 } from '../src/main/services/vpk.ts'

// 模拟语音索引数据
const index = {
  voicePacketCount: 3,
  pulsesBySlot: { '0': [100, 200], '4': [150, 160, 170], '12': [300] }
}
const js = buildVoiceDataJs(index)
const resource = buildVjsResource(js)
const vpk = buildVpk([
  { ext: 'vjs_c', path: 'panorama/scripts/hud', name: 'dsh_voice_data', data: resource }
])

console.log(`js: ${js.length}B, resource: ${resource.length}B, vpk: ${vpk.length}B`)

// ─── 自解析验证 ───
const sig = vpk.readUInt32LE(0)
const ver = vpk.readUInt32LE(4)
const treeSize = vpk.readUInt32LE(8)
const fileDataSize = vpk.readUInt32LE(12)
const otherMd5Size = vpk.readUInt32LE(20)
console.log(`sig=0x${sig.toString(16)} ver=${ver} treeSize=${treeSize} fileData=${fileDataSize} otherMD5=${otherMd5Size}`)
if (sig !== 0x55aa1234 || ver !== 2) throw new Error('VPK 头错误（需 v2）')
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
for (;;) {
  const ext = readCStr()
  if (ext === '') break
  for (;;) {
    const path = readCStr()
    if (path === '') break
    for (;;) {
      const name = readCStr()
      if (name === '') break
      const crc = vpk.readUInt32LE(pos); pos += 4
      const preload = vpk.readUInt16LE(pos); pos += 2
      const archiveIndex = vpk.readUInt16LE(pos); pos += 2
      const offset = vpk.readUInt32LE(pos); pos += 4
      const length = vpk.readUInt32LE(pos); pos += 4
      const term = vpk.readUInt16LE(pos); pos += 2
      if (term !== 0xffff) throw new Error(`条目终止符错误: 0x${term.toString(16)}`)
      entries.push({ ext, path, name, crc, preload, archiveIndex, offset, length, term })
    }
  }
}
if (pos !== treeEnd) throw new Error(`树解析结束位置 ${pos} != 声称 ${treeEnd}`)
console.log('解析条目:', entries.map((e) => `${e.path}/${e.name}.${e.ext} off=${e.offset} len=${e.length} term=0x${e.term.toString(16)}`).join('\n  '))
if (entries.length !== 1) throw new Error('条目数错误')
const e = entries[0]
const dataStart = treeEnd
const dataEnd = dataStart + fileDataSize
if (dataEnd + otherMd5Size !== vpk.length) throw new Error(`otherMD5 位置错误: ${dataEnd}+${otherMd5Size} != ${vpk.length}`)
const data = vpk.subarray(dataStart + e.offset, dataStart + e.offset + e.length)
console.log(`数据区: ${data.length}B, crc 校验: ${crc32(data) === e.crc ? 'OK' : 'FAIL'}`)
console.log(`数据内容前 60B: ${data.subarray(0, 60).toString('latin1')}`)
console.log('✓ 会话 VPK 格式验证通过（v2 布局: otherMD5 在文件末尾）')
