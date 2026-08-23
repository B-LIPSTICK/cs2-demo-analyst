/**
 * Steam 验证完成后的现场准备：确认 gameinfo.gi 恢复、删除过时 .bak、清残留。
 * 用法: node --experimental-strip-types scripts/diag-postverify-prep.mjs
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const INSTALL = 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const CSGO = join(INSTALL, 'game', 'csgo')
const BIN = join(INSTALL, 'game', 'bin', 'win64')
const BAK = join(CSGO, 'gameinfo.gi.dsh_inject.bak')

let bad = false

// 1. gameinfo.gi 必须存在
const gi = join(CSGO, 'gameinfo.gi')
try {
  const st = await fs.stat(gi)
  console.log(`✓ gameinfo.gi 存在 (${st.size}B, ${st.mtime.toLocaleString()})`)
} catch {
  console.log('✗ gameinfo.gi 仍缺失！Steam 验证未完成，等待后再跑')
  process.exit(1)
}

// 2. 删除过时 .bak（7/9 旧版，与当前版本不匹配）
try {
  const st = await fs.stat(BAK)
  console.log(`  .bak 存在 (${st.size}B, ${st.mtime.toLocaleString()}) —— 过时备份，删除`)
  await fs.unlink(BAK)
  console.log('✓ 已删除过时 .bak（下次注入会重新备份当前版本）')
} catch {
  console.log('✓ 无 .bak，无需处理')
}

// 3. overrides 残留
const ov = join(CSGO, 'overrides')
const names = await fs.readdir(ov).catch(() => [])
const dirty = names.filter((n) => n.includes('dsh'))
for (const n of dirty) {
  await fs.unlink(join(ov, n))
  console.log(`  removed overrides/${n}`)
}
if (!dirty.length) console.log('✓ overrides 目录干净')

// 4. 残留 cfg / 日志
for (const f of ['dsh-play.cfg', 'dsh_hud.log']) {
  await fs.unlink(join(CSGO, 'cfg', f)).catch(() => {})
  await fs.unlink(join(BIN, f)).catch(() => {})
}
console.log('✓ 残留 cfg/日志已清')

// 5. gameinfo.gi 确认无注入行
const text = await fs.readFile(gi, 'utf8')
if (/dsh_voice/.test(text)) {
  console.log('✗ gameinfo.gi 仍含 dsh 注入行（Steam 验证后不应有）—— 需手动检查')
  bad = true
} else {
  console.log('✓ gameinfo.gi 为官方版本（无注入行）')
}

// 6. CS2 未运行
const { execFile } = await import('node:child_process')
const running = await new Promise((r) => execFile('tasklist', ['/FI', 'IMAGENAME eq cs2.exe', '/FO', 'CSV', '/NH'], (_e, out) => r(out.toLowerCase().includes('cs2.exe'))))
if (running) {
  console.log('✗ CS2 正在运行！请关闭')
  bad = true
} else {
  console.log('✓ CS2 未运行')
}

// 7. minidump 计数（仅报告，不清理——先保留证据）
const dumps = (await fs.readdir(BIN).catch(() => [])).filter((f) => f.endsWith('.mdmp'))
console.log(`  bin/win64 现有 ${dumps.length} 个 minidump（证据保留）`)

console.log(bad ? '\n== 有异常，见上 ==' : '\n== 现场干净，可以跑 diag-inject-matrix.mjs ==')
process.exit(bad ? 2 : 0)
