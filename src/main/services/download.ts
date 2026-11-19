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

function get(url: string, signal?: AbortSignal): Promise<http.IncomingMessage> {
  const mod = url.startsWith('https:') ? https : http
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('下载已取消'))
    }
    const req = mod.get(url, { headers: { 'User-Agent': 'CS2DemoAnalyst/1.0' } }, (res) => {
      // 成功收到响应头后，清除连接超时，避免大文件传输被强制杀死
      req.setTimeout(0)
      // 设置传输空闲超时（30 秒无任何新数据到达才断开）
      res.socket?.setTimeout(30000, () => {
        res.destroy(new Error(`网络传输空闲超时: ${url}`))
      })
      resolve(res)
    })
    req.on('error', reject)
    req.setTimeout(30000, () => {
      req.destroy(new Error(`连接超时: ${url}`))
    })

    if (signal) {
      const onAbort = () => {
        req.destroy(new Error('下载已取消'))
        reject(new Error('下载已取消'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * 下载单个文件（原子写入 .tmp，成功后重命名为 dest，杜绝残留半拉文件导致模型损坏）。
 */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new Error('下载已取消')
  }
  await fs.mkdir(dirname(dest), { recursive: true })
  const tmpDest = `${dest}.tmp`
  await fs.unlink(tmpDest).catch(() => {})

  let current = url
  for (let hop = 0; hop < 6; hop++) {
    if (signal?.aborted) {
      throw new Error('下载已取消')
    }
    const res = await get(current, signal)
    if (signal?.aborted) {
      res.destroy()
      throw new Error('下载已取消')
    }

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
    const out = createWriteStream(tmpDest)
    let lastProgressTime = 0

    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          res.destroy()
          out.destroy()
          reject(new Error('下载已取消'))
        }

        if (signal?.aborted) {
          onAbort()
          return
        }
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true })
        }

        res.on('data', (chunk: Buffer) => {
          if (signal?.aborted) {
            onAbort()
            return
          }
          received += chunk.length
          const now = Date.now()
          if (now - lastProgressTime >= 100 || (total > 0 && received >= total)) {
            lastProgressTime = now
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

      // 下载成功完成，原子覆盖为最终目标
      await fs.rename(tmpDest, dest).catch(async () => {
        await fs.unlink(dest).catch(() => {})
        await fs.rename(tmpDest, dest)
      })
      return
    } catch (err) {
      out.destroy()
      await fs.unlink(tmpDest).catch(() => {})
      throw err
    }
  }
  throw new Error(`重定向次数过多: ${url}`)
}

/**
 * 依次尝试多个 URL（主源 + 镜像），全部失败才抛错。
 *
 * 会额外重试：hf-mirror 之类的镜像在短时间内请求密集会返回 429（限流窗口 300 秒），
 * 而国内用户只有它能连（huggingface.co 直连基本必然超时）。实测同样的 URL
 * 隔几秒再请求就恢复 200，所以失败后等一会儿再整体重来一轮，比直接报错好得多。
 */
export async function downloadWithMirrors(
  urls: string[],
  dest: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let lastErr: unknown = null
  const delays = [0, 3000, 8000] // 第 1 轮立即，之后各等 3s / 8s
  for (let pass = 0; pass < delays.length; pass++) {
    if (delays[pass] > 0) {
      await new Promise((r) => setTimeout(r, delays[pass]))
    }
    for (const url of urls) {
      if (signal?.aborted) {
        throw new Error('下载已取消')
      }
      try {
        await downloadFile(url, dest, onProgress, signal)
        return
      } catch (err) {
        lastErr = err
        if (signal?.aborted || (err instanceof Error && err.message.includes('下载已取消'))) {
          throw err
        }
        console.warn(`[download] mirror failed ${url}: ${err instanceof Error ? err.message : err}`)
      }
    }
    if (pass < delays.length - 1) {
      console.warn(`[download] all mirrors failed, retry pass ${pass + 2}/${delays.length} in ${delays[pass + 1]}ms`)
    }
  }
  throw lastErr ?? new Error('download failed')
}
