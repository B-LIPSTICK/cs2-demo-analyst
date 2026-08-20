/**
 * 开发静态服务：web-dist/ + test-data/demos 映射为 /demos/
 * 用法: node scripts/serve.mjs [port]
 */
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, extname, normalize } from 'node:path'

const port = Number(process.argv[2] ?? 8787)
const root = process.cwd()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.dem': 'application/octet-stream'
}

createServer(async (req, res) => {
  try {
    let url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let filePath
    if (url.startsWith('/demos/')) {
      filePath = join(root, 'test-data', 'demos', url.slice('/demos/'.length))
    } else {
      url = url === '/' ? '/index.html' : url
      filePath = join(root, 'web-dist', url)
    }
    const safe = normalize(filePath)
    if (!safe.startsWith(normalize(join(root, 'test-data'))) && !safe.startsWith(normalize(join(root, 'web-dist')))) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const data = await fs.readFile(safe)
    res.writeHead(200, { 'Content-Type': MIME[extname(safe)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[serve] http://127.0.0.1:${port}`)
})
