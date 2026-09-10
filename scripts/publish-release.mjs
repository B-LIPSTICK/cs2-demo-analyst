import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

console.log('>>> 正在从 Git 凭据管理器提取 GitHub 访问令牌...')
const credInput = 'protocol=https\nhost=github.com\n\n'
const credOutput = execSync('git credential fill', { input: credInput, encoding: 'utf-8' })
const match = credOutput.match(/password=(.+)/)
if (!match) {
  throw new Error('未能从 Git 凭据管理器获取密码/Token')
}
const token = match[1].trim()

const repo = 'B-LIPSTICK/cs2-demo-analyst'
const tag = 'v1.0.0'
const releaseName = 'CS2 Demo Analyst v1.0.0 正式版发布'
const releaseNotesPath = path.join(__dirname, 'release-notes.md')
const bodyText = fs.readFileSync(releaseNotesPath, 'utf-8')

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'CS2-Demo-Analyst-Publisher',
  Accept: 'application/vnd.github.v3+json',
  'Content-Type': 'application/json'
}

console.log(`>>> 正在检查 GitHub Release (${tag}) 是否已存在...`)
let releaseId = null
let htmlUrl = null

const checkRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
  headers: {
    Authorization: `token ${token}`,
    'User-Agent': 'CS2-Demo-Analyst-Publisher',
    Accept: 'application/vnd.github.v3+json'
  }
})

if (checkRes.status === 200) {
  const existing = await checkRes.json()
  releaseId = existing.id
  htmlUrl = existing.html_url
  console.log(`>>> Release 已存在: ID ${releaseId}, ${htmlUrl}`)
} else {
  console.log(`>>> 正在创建 GitHub Release (${tag})...`)
  const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
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
const zipPath = path.join(rootDir, 'dist', 'CS2-Demo-Analyst-1.0.0-win64-portable.zip')
if (!fs.existsSync(zipPath)) {
  throw new Error(`未找到便携压缩包: ${zipPath}`)
}

const stats = fs.statSync(zipPath)
const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
const fileName = path.basename(zipPath)

console.log(`>>> 正在上传 Release 资产: ${fileName} (${sizeMB} MB)...`)

// 检查是否已有同名资产，若有则先删除
const assetsRes = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}/assets`, {
  headers: {
    Authorization: `token ${token}`,
    'User-Agent': 'CS2-Demo-Analyst-Publisher',
    Accept: 'application/vnd.github.v3+json'
  }
})

if (assetsRes.ok) {
  const assets = await assetsRes.json()
  const existingAsset = assets.find((a) => a.name === fileName)
  if (existingAsset) {
    console.log(`>>> 发现同名旧资产 (ID: ${existingAsset.id})，正在删除...`)
    await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existingAsset.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'CS2-Demo-Analyst-Publisher',
        Accept: 'application/vnd.github.v3+json'
      }
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
console.log(`>>> 🎉 发布成功! 访问链接: ${htmlUrl}`)
