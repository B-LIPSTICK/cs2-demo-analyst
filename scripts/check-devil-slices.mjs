import { readFileSync } from 'node:fs'
for (const n of [170, 365, 520, 695]) {
  const f = `test-data/devil-${n}.wav`
  const b = readFileSync(f)
  const sr = b.readUInt32LE(24), bits = b.readUInt16LE(34)
  const dataSz = b.readUInt32LE(40)
  const nS = Math.floor(dataSz / (bits / 8))
  const win = Math.floor(sr * 0.5)
  const profile = []
  for (let w = 0; w < nS; w += win) {
    let sum = 0
    const end = Math.min(w + win, nS)
    for (let i = w; i < end; i++) {
      const v = b.readInt16LE(44 + i * (bits / 8))
      sum += v * v
    }
    profile.push(Math.sqrt(sum / (end - w)).toFixed(0))
  }
  console.log(`${f} (10s, 0.5s windows): ${profile.join(' ')}`)
}
