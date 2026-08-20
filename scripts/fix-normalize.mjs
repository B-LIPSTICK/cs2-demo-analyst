// 验证修复后的 normalizeWav（int32 → 取高16位）在 split-full 输出上的效果
import { readFile, writeFile } from 'node:fs/promises'
const src = process.argv[2]
const outFile = process.argv[3]
const buf = await readFile(src)
const channels = buf.readUInt16LE(22), rate = buf.readUInt32LE(24)
let dataStart = -1, dataSize = 0, pos = 12
while (pos + 8 <= buf.length) {
  const id = buf.toString('ascii', pos, pos + 4)
  const size = buf.readUInt32LE(pos + 4)
  if (id === 'data') { dataStart = pos + 8; dataSize = Math.min(size, buf.length - dataStart); break }
  pos += 8 + size + (size % 2)
}
const nSamples = Math.floor(dataSize / 4)
const out = Buffer.alloc(44 + nSamples * 2)
out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(36 + nSamples * 2, 4); out.write('WAVE', 8, 'ascii')
out.write('fmt ', 12, 'ascii'); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20)
out.writeUInt16LE(channels, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * channels * 2, 28)
out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(nSamples * 2, 40)
for (let i = 0; i < nSamples; i++) {
  const v = buf.readInt32LE(dataStart + i * 4)
  out.writeInt16LE(v >> 16, 44 + i * 2) // 修复：取高 16 位（真实音频），而非低 16 位
}
await writeFile(outFile, out)
console.log(`wrote ${outFile} (${nSamples} samples, ${(nSamples / rate).toFixed(1)}s)`)
