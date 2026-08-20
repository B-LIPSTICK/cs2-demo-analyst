import React from 'react'
import ReactDOM from 'react-dom/client'
// 苹果风：使用系统 SF 系字体栈（不再打包网络字体）
import './theme/hud.css'
import App from './App'
import { installWebApiIfNeeded } from './webmock'
import { parseDemoWeb } from '../../web/parseDemo'
import { decodeDemoVoice } from '../../web/decodeVoice'

installWebApiIfNeeded()

// 浏览器端验证/调试钩子（Web 模式）
declare global {
  interface Window {
    __demoAnalystTest?: { parseDemoWeb: typeof parseDemoWeb; decodeDemoVoice: typeof decodeDemoVoice }
  }
}
window.__demoAnalystTest = { parseDemoWeb, decodeDemoVoice }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
