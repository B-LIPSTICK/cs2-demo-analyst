import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// ─── 版本号：唯一来源是 package.json，tag / Release 名 / zip 名都由它推导 ───
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'))
const version = String(pkg.version ?? '').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json 里的 version 不合法：${JSON.stringify(pkg.version)}`)
}
const tag = `v${version}`
const releaseName = `CS2 Demo Analyst v${version}`
const zipPath = path.join(rootDir, 'dist', `CS2-Demo-Analyst-${version}-win64-portable.zip`)
const releaseNotesPath = path.join(__dirname, 'release-notes.md')

if (!fs.existsSync(zipPath)) {
  throw new Error(
    `未找到便携压缩包: ${zipPath}\n先运行 npm run dist:zip（它会按 package.json 的 ${version} 生成同名 zip）`
  )
}

// 新 tag 必须指向已经在远端存在的提交，否则 GitHub 会因为找不到 commit 而拒绝建 tag
const headSha = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim()
let onRemote = false
try {
  const contains = execSync(`git branch -r --contains ${headSha}`, {
    cwd: rootDir,
    encoding: 'utf-8'
  })
  onRemote = contains.trim().length > 0
} catch {
  onRemote = false
}
if (!onRemote) {
  console.warn(
    `>>> 警告：当前 HEAD (${headSha.slice(0, 7)}) 还没有推送到远端。\n` +
      `>>> 新 tag ${tag} 需要远端存在该提交；请先 git push，再重跑本脚本。`
  )
}

console.log('>>> 正在从 Git 凭据管理器提取 GitHub 访问令牌...')
const credInput = 'protocol=https\nhost=github.com\n\n'
const credOutput = execSync('git credential fill', { input: credInput, encoding: 'utf-8' })
const match = credOutput.match(/password=(.+)/)
if (!match) {
  throw new Error('未能从 Git 凭据管理器获取密码/Token')
}
const token = match[1].trim()

const repo = 'B-LIPSTICK/cs2-demo-analyst'
const bodyText = fs.readFileSync(releaseNotesPath, 'utf-8')

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'CS2-Demo-Analyst-Publisher',
  Accept: 'application/vnd.github.v3+json',
  'Content-Type': 'application/json'
}
const readHeaders = {
  Authorization: `token ${token}`,
  'User-Agent': 'CS2-Demo-Analyst-Publisher',
  Accept: 'application/vnd.github.v3+json'
}

console.log(`>>> 目标版本 ${version}（tag ${tag}）`)
console.log(`>>> 正在检查 GitHub Release (${tag}) 是否已存在...`)
let releaseId = null
let htmlUrl = null

const checkRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
  headers: readHeaders
})

if (checkRes.status === 200) {
  const existing = await checkRes.json()
  releaseId = existing.id
  htmlUrl = existing.html_url
  console.log(`>>> Release 已存在: ID ${releaseId}, ${htmlUrl}`)
  const bodyChanged = (existing.body || '').trim() !== bodyText.trim()
  const nameChanged = existing.name !== releaseName
  if (bodyChanged || nameChanged) {
    console.log(
      `>>> 正在更新 Release 说明${bodyChanged ? ' (body)' : ''}${nameChanged ? ' (name)' : ''}...`
    )
    const patchRes = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: releaseName, body: bodyText })
    })
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      throw new Error(`更新 Release 说明失败 (${patchRes.status}): ${errText}`)
    }
    console.log('>>> Release 说明已更新')
  } else {
    console.log('>>> Release 说明无变化，跳过更新')
  }
} else {
  console.log(`>>> 正在创建 GitHub Release (${tag})...`)
  const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: tag,
      // 旧脚本写死 'main'，但本仓库的发布分支是 frontend-apple；
      // 直接用当前 HEAD 的 sha，保证 tag 落在真正被打包的那次提交上。
      target_commitish: headSha,
      name: releaseName,
      body: bodyText,
      draft: false,
      prerelease: false
    })
  })

  if (!createRes.ok) {
    const errText = await createRes.text()
    throw new Error(`创建 Release 失败 (${createRes.status}): ${errText}`)
  }

  const created = await createRes.json()
  releaseId = created.id
  htmlUrl = created.html_url
  console.log(`>>> Release 创建成功! ID: ${releaseId}, URL: ${htmlUrl}`)
}

// 检查资产
const stats = fs.statSync(zipPath)
const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
const fileName = path.basename(zipPath)

console.log(`>>> 正在上传 Release 资产: ${fileName} (${sizeMB} MB)...`)

// 检查是否已有同名资产，若有则先删除
const assetsRes = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}/assets`, {
  headers: readHeaders
})

if (assetsRes.ok) {
  const assets = await assetsRes.json()
  const existingAsset = assets.find((a) => a.name === fileName)
  if (existingAsset) {
    console.log(`>>> 发现同名旧资产 (ID: ${existingAsset.id})，正在删除...`)
    await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existingAsset.id}`, {
      method: 'DELETE',
      headers: readHeaders
    })
  }
}

const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`

console.log('>>> 开始通过 curl 流式上传...')
const curl = spawnSync(
  'curl.exe',
  [
    '-X', 'POST',
    '-H', `Authorization: token ${token}`,
    '-H', 'Content-Type: application/zip',
    '--data-binary', `@${zipPath}`,
    '--fail',
    '--show-error',
    uploadUrl
  ],
  { stdio: 'inherit' }
)

if (curl.status !== 0) {
  throw new Error(`curl 上传失败，退出码: ${curl.status}`)
}

console.log('>>> 资产上传成功!')
console.log(`>>> 🎉 发布成功! ${tag} → ${htmlUrl}`)
