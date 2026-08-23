/**
 * 抓取 CS2 进程的完整命令行（排查完美/5E 平台播放参数差异）
 *
 * 用法：
 *   node scripts/capture-cs2-cmdline.mjs [--wait <秒>]
 * 1) 先运行本脚本（默认等待 180 秒）；
 * 2) 在完美平台/5E 客户端里点「观看录像」；
 * 3) CS2 启动后脚本会自动抓到 cs2.exe 的命令行并写入
 *    scripts/capture-cs2-cmdline-result.txt；
 * 4) 把该文件内容发给 agent。
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const waitSec = Number(args[args.indexOf('--wait') + 1] ?? 180)
const out = []
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
  out.push(line)
  console.log(line)
}

function ps() {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'cs2|steam|perfectworld|5E' } | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine | ConvertTo-Json -Compress -Depth 3"
      ],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        try {
          const data = JSON.parse(stdout)
          resolve(Array.isArray(data) ? data : data ? [data] : [])
        } catch {
          resolve([])
        }
      }
    )
  })
}

const seen = new Set()
const t0 = Date.now()
log(`监听 ${waitSec}s：请现在去完美平台/5E 点「观看录像」…`)

while (Date.now() - t0 < waitSec * 1000) {
  const procs = await ps()
  for (const p of procs) {
    if (p.Name === 'cs2.exe' && !seen.has(p.ProcessId)) {
      seen.add(p.ProcessId)
      log('')
      log('★ 捕获新 cs2.exe 进程 PID=' + p.ProcessId + ' 父PID=' + p.ParentProcessId)
      log('  CommandLine: ' + (p.CommandLine ?? '(null)'))
      // 找父进程
      const parent = procs.find((x) => x.ProcessId === p.ParentProcessId)
      if (parent) {
        log('  父进程 ' + parent.Name + ' (PID=' + parent.ProcessId + ')')
        log('  父进程 CommandLine: ' + (parent.CommandLine ?? '(null)'))
      }
      const f = join(process.cwd(), 'scripts', 'capture-cs2-cmdline-result.txt')
      await fs.writeFile(f, out.join('\n') + '\n', 'utf-8')
      log(`  结果已写入 ${f}`)
    }
  }
  await new Promise((r) => setTimeout(r, 500))
}

log('监听结束（未捕获到新 cs2.exe 进程则重试：先关掉 CS2 再跑）')
