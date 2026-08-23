/**
 * 构建 Panorama 静态 VPK（构建时运行，产物入库）
 *
 * 流程（与 SwiftDemoUIPro 的官方 addon 编译管线一致，工具为 CS2 自带）:
 *  1. 源文件(.xml/.css/.js) 复制到 <cs2>/content/csgo_addons/dsh_voice_hud/ 并改名 .vxml/.vcss/.vjs
 *  2. resourcecompiler.exe -game <cs2>/game/csgo -i <inputs...> -f -nop4 -v
 *     → 输出 <cs2>/game/csgo_addons/dsh_voice_hud/ 下同名 .vxml_c/.vcss_c/.vjs_c
 *  3. 用本项目 vpk.ts 的 buildVpk 打包 → assets/panorama/dsh_voice_override.vpk
 *  4. 清理临时 addon 目录
 *
 * 用法: node scripts/build-panorama.mjs [--cs2 <CS2安装根>]
 */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import os from 'node:os'

const ROOT = process.cwd()
const ADDON = 'dsh_voice_hud'
const cli = process.argv.slice(2)
const getArg = (n) => {
  const i = cli.indexOf(n)
  return i >= 0 ? cli[i + 1] : undefined
}

async function locateCs2() {
  const cliPath = getArg('--cs2')
  if (cliPath) return cliPath
  try {
    const raw = await fs.readFile(join(os.homedir(), 'AppData', 'Roaming', 'CS2 Demo Analyst', 'settings.json'), 'utf-8')
    const s = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (s.cs2?.installPath) return s.cs2.installPath
  } catch { /* noop */ }
  return 'D:\\11-Steam\\steamapps\\common\\Counter-Strike Global Offensive'
}

const SOURCES = [
  ['panorama/layout/hud/huddemocontroller.xml', 'panorama/layout/hud/huddemocontroller.vxml', 'vxml'],
  ['panorama/styles/hud/dsh_voice.css', 'panorama/styles/hud/dsh_voice.vcss', 'vcss'],
  ['panorama/scripts/hud/dsh_voice.js', 'panorama/scripts/hud/dsh_voice.vjs', 'vjs'],
  ['panorama/scripts/hud/dsh_voice_data.js', 'panorama/scripts/hud/dsh_voice_data.vjs', 'vjs']
]

async function main() {
  const cs2 = await locateCs2()
  const gameDir = join(cs2, 'game', 'csgo')
  const compiler = join(cs2, 'game', 'bin', 'win64', 'resourcecompiler.exe')
  const contentAddon = join(cs2, 'content', 'csgo_addons', ADDON)
  const gameAddon = join(cs2, 'game', 'csgo_addons', ADDON)

  try {
    await fs.access(compiler)
  } catch {
    console.error(`✗ resourcecompiler 不存在: ${compiler}`)
    process.exit(1)
  }

  // ① 准备输入
  await fs.rm(contentAddon, { recursive: true, force: true })
  await fs.rm(gameAddon, { recursive: true, force: true })
  const inputs = []
  for (const [srcRel, inRel] of SOURCES) {
    const src = join(ROOT, 'assets', 'panorama', srcRel.replace('panorama/', ''))
    const dest = join(contentAddon, inRel)
    await fs.mkdir(join(dest, '..'), { recursive: true })
    await fs.copyFile(src, dest)
    inputs.push(dest)
  }
  // preprocessor_config.txt（Panorama 预处理器配置，空块）
  await fs.mkdir(join(contentAddon, 'panorama'), { recursive: true })
  await fs.writeFile(join(contentAddon, 'panorama', 'preprocessor_config.txt'), '"PanzipCfg"\n{\n    "BlockDefs"\n    {\n    }\n}\n', 'ascii')
  console.log(`✓ 输入就绪: ${contentAddon}`)

  // ② 编译
  const args = ['-game', gameDir]
  for (const i of inputs) args.push('-i', i)
  args.push('-f', '-nop4', '-v')
  console.log(`→ resourcecompiler ${args.join(' ')}`)
  const r = spawnSync(compiler, args, { stdio: 'inherit', timeout: 120000 })
  if (r.status !== 0) {
    console.error(`✗ resourcecompiler 失败 (exit ${r.status})`)
    process.exit(1)
  }

  // ③ 收集产物并打包（编译输出 = 输入名 + "_c"，如 huddemocontroller.vxml_c）
  const outputs = SOURCES.map(([, inRel]) => {
    return { inRel, compiled: join(gameAddon, inRel + '_c') }
  })
  const entries = []
  for (const o of outputs) {
    const data = await fs.readFile(o.compiled)
    // 条目路径以编译产物文件名（xxx.vxml_c）为准，目录同源文件
    const parts = o.compiled.split(/[\\/]/)
    const file = parts.pop()
    const extIdx = file.lastIndexOf('.')
    const name = file.slice(0, extIdx)
    const ext = file.slice(extIdx + 1)
    const dirParts = o.inRel.split('/')
    dirParts.pop()
    entries.push({ ext, path: dirParts.join('/'), name, data })
    console.log(`  ✓ ${file} (${data.length}B)`)
  }
  const vpk = inlineBuildVpk(entries)
  const outPath = join(ROOT, 'assets', 'panorama', 'dsh_voice_override.vpk')
  await fs.writeFile(outPath, vpk)
  console.log(`✓ 静态 VPK: ${outPath} (${vpk.length}B, ${entries.length} 文件)`)

  // ④ 清理
  await fs.rm(contentAddon, { recursive: true, force: true })
  await fs.rm(gameAddon, { recursive: true, force: true })
  console.log('✓ 临时 addon 目录已清理')
}

// ─── VPK v2 打包（CS2 overrides 需 v2；与 src/main/services/vpk.ts 同逻辑） ───
// 树布局（逐字节逆向 SwiftDemoUIPro 生产 VPK）:
//   [ext\0] [dir\0] (name\0 + crc u32 + preload u16 + archive u16 + offset u32 + size u32 + 0xffff u16)*
//   [\0 空name = dir 结束] [\0 空dir = ext 结束] ... [\0 空ext = 树结束]
// 同 ext 同 dir 共享组头；无 4 字节对齐；数据区紧跟树后；otherMD5(48B) 在文件末尾。

function inlineBuildVpk(entries) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i]
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunks = []
  const offsetInfos = []
  let dataStart = 0
  const pushStr = (s) => {
    const b = Buffer.alloc(s.length + 1)
    b.write(s, 0, 'latin1')
    chunks.push(b)
    return b.length
  }
  const extMap = new Map()
  for (const e of entries) {
    if (!extMap.has(e.ext)) extMap.set(e.ext, new Map())
    const dirMap = extMap.get(e.ext)
    if (!dirMap.has(e.path)) dirMap.set(e.path, [])
    dirMap.get(e.path).push(e)
  }
  let treeLen = 0
  for (const [ext, dirMap] of extMap) {
    treeLen += pushStr(ext)
    for (const [dir, files] of dirMap) {
      treeLen += pushStr(dir)
      for (const f of files) {
        const entryStart = treeLen
        const header = Buffer.alloc(f.name.length + 1 + 16 + 2)
        let p = 0
        header.write(f.name + '\0', p, 'latin1'); p += f.name.length + 1
        header.writeUInt32LE(crc32(f.data), p); p += 4
        header.writeUInt16LE(0, p); p += 2
        header.writeUInt16LE(0x7fff, p); p += 2
        offsetInfos.push({ offsetPos: entryStart + p, dataStart })
        header.writeUInt32LE(0, p); p += 4
        header.writeUInt32LE(f.data.length, p); p += 4
        header.writeUInt16LE(0xffff, p); p += 2
        chunks.push(header)
        treeLen += header.length
        dataStart += f.data.length
      }
      treeLen += pushStr('') // 空 name
    }
    treeLen += pushStr('') // 空 dir
  }
  treeLen += pushStr('') // 空 ext
  // 回填偏移
  const flat = []
  let acc = 0
  for (const c of chunks) {
    flat.push({ c, s: acc })
    acc += c.length
  }
  for (const info of offsetInfos) {
    for (const { c, s } of flat) {
      if (s <= info.offsetPos && info.offsetPos < s + c.length) {
        c.writeUInt32LE(info.dataStart, info.offsetPos - s)
        break
      }
    }
  }
  const totalData = entries.reduce((a, e) => a + e.data.length, 0)
  // v2 头: 28B；布局 = header + tree + data + otherMD5(48B)@末尾
  const out = Buffer.alloc(28 + treeLen + totalData + 48)
  out.writeUInt32LE(0x55aa1234, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(treeLen, 8)
  out.writeUInt32LE(totalData, 12)
  out.writeUInt32LE(0, 16)
  out.writeUInt32LE(48, 20)
  out.writeUInt32LE(0, 24)
  let off = 28
  const treeBuf = Buffer.alloc(treeLen)
  let tp = 0
  for (const c of chunks) {
    c.copy(treeBuf, tp)
    tp += c.length
  }
  for (const c of chunks) {
    c.copy(out, off)
    off += c.length
  }
  for (const e of entries) {
    Buffer.from(e.data).copy(out, off)
    off += e.data.length
  }
  out.write(createHash('md5').update(treeBuf).digest('hex'), off, 'hex')
  out.write(createHash('md5').update(Buffer.alloc(0)).digest('hex'), off + 16, 'hex')
  return out
}

main().catch((e) => {
  console.error('构建失败:', e)
  process.exit(1)
})
