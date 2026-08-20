/**
 * Web 版预览/验证工具：用 Electron 壳加载 Web 版并截图或执行测试脚本
 * 用法:
 *   npx electron scripts/web-preview-main.js --shot <path> [--delay ms] [--url http://127.0.0.1:8787]
 *   npx electron scripts/web-preview-main.js --eval "<js>" [--url ...]
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const shotIdx = process.argv.indexOf('--shot')
const shotPath = shotIdx >= 0 ? process.argv[shotIdx + 1] : path.join(__dirname, '..', 'shot-web.png')
const delayIdx = process.argv.indexOf('--delay')
const delay = delayIdx >= 0 ? Number(process.argv[delayIdx + 1]) : 1500
const urlIdx = process.argv.indexOf('--url')
const url = urlIdx >= 0 ? process.argv[urlIdx + 1] : null
const evalIdx = process.argv.indexOf('--eval')
let evalCode = evalIdx >= 0 ? process.argv[evalIdx + 1] : null
const evalFileIdx = process.argv.indexOf('--eval-file')
if (evalFileIdx >= 0) {
  evalCode = fs.readFileSync(process.argv[evalFileIdx + 1], 'utf-8')
}

console.log('[argv-top]', JSON.stringify(process.argv.slice(2)))

app.whenReady().then(() => {
  console.log('[argv-ready]', JSON.stringify(process.argv))
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0A0C0F',
    webPreferences: { sandbox: false }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url2) => {
    console.error('[load-fail]', code, desc, url2)
    app.exit(2)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-gone]', JSON.stringify(details))
    app.exit(3)
  })
  win.webContents.on('console-message', (_e, _level, message, _line, sourceId) => {
    console.log(`[render] ${message}`.slice(0, 500))
  })
  win.webContents.on('did-finish-load', () => {
    if (evalCode) {
      win.webContents
        .executeJavaScript(evalCode, true)
        .then((result) => {
          console.log('[eval]', JSON.stringify(result, null, 2).slice(0, 4000))
          if (shotIdx >= 0) {
            setTimeout(capture, delay)
          } else {
            app.exit(0)
          }
        })
        .catch((e) => {
          console.error('[eval] failed', e)
          app.exit(1)
        })
      return
    }
    setTimeout(capture, delay)
  })
  function capture() {
    win.webContents.capturePage().then((img) => {
      fs.writeFileSync(shotPath, img.toPNG())
      console.log(`[web-shot] saved ${shotPath}`)
      app.exit(0)
    })
  }
  if (url) win.loadURL(url)
  else win.loadFile(path.join(__dirname, '..', 'web-dist', 'index.html'))
})
