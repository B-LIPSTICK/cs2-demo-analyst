import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/rajdhani/400.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
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
