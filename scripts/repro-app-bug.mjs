// 复刻 app normalizeWav 的低16位提取（模拟 asr.ts 的 bug）
import { readFile, writeFile } from 'node:fs/promises'
const src = process.argv[2]
const outFile = process.argv[3] ?? 'test-data/app-bug-repro.wav'
const buf = await readFile(src)
const channels = buf.readUInt16LE(22), rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34)
let dataStart = -1, dataSize = 0, pos = 12
while (pos + 8 <= buf.length) {
  const id = buf.toString('ascii', pos, pos + 4)
  const size = buf.readUInt32LE(pos + 4)
  if (id === 'data') { dataStart = pos + 8; dataSize = Math.min(size, buf.length - dataStart); break }
  pos += 8 + size + (size % 2)
}
const newDataSize = (dataSize / 4) * 2
const out = Buffer.alloc(44 + newDataSize)
out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(36 + newDataSize, 4); out.write('WAVE', 8, 'ascii')
out.write('fmt ', 12, 'ascii'); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20)
out.writeUInt16LE(channels, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * channels * 2, 28)
out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(newDataSize, 40)
for (let i = 0; i < newDataSize; i += 2) {
  out.writeInt16LE(buf.readInt16LE(dataStart + i * 2), 44 + i)
}
await writeFile(outFile, out)
console.log('wrote', outFile)
