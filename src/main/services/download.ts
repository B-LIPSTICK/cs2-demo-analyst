/**
 * 下载服务：https 下载（跟随重定向、进度回调、镜像回退）
 */
import https from 'node:https'
import http from 'node:http'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export interface DownloadProgress {
  received: number
  total: number
  url: string
}

function get(url: string): Promise<http.IncomingMessage> {
  const mod = url.startsWith('https:') ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { 'User-Agent': 'CS2DemoAnalyst/0.1' } }, (res) => {
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(20000, () => {
      req.destroy(new Error(`timeout: ${url}`))
    })
  })
}

/**
 * 下载单个文件。返回最终 URL（跟随重定向）。
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  await fs.mkdir(dirname(dest), { recursive: true })

  let current = url
  for (let hop = 0; hop < 6; hop++) {
    const res = await get(current)
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume()
      current = new URL(res.headers.location, current).toString()
      continue
    }
    if (res.statusCode !== 200) {
      res.resume()
      throw new Error(`HTTP ${res.statusCode} ${current}`)
    }
    const total = Number(res.headers['content-length']) || 0
    let received = 0
    const out = createWriteStream(dest)
    await new Promise<void>((resolve, reject) => {
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received % (512 * 1024) < 64 * 1024) {
          onProgress?.({ received, total, url: current })
        }
      })
      res.pipe(out)
      out.on('finish', () => {
        onProgress?.({ received, total, url: current })
        resolve()
      })
      out.on('error', reject)
      res.on('error', reject)
    })
    return
  }
  throw new Error(`too many redirects: ${url}`)
}

/**
 * 依次尝试多个 URL（主源 + 镜像），全部失败才抛错。
 */
export async function downloadWithMirrors(
  urls: string[],
  dest: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  let lastErr: unknown = null
  for (const url of urls) {
    try {
      await downloadFile(url, dest, onProgress)
      return
    } catch (err) {
      lastErr = err
      console.warn(`[download] mirror failed ${url}: ${err instanceof Error ? err.message : err}`)
    }
  }
  throw lastErr ?? new Error('download failed')
}
