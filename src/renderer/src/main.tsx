import React from 'react'
import ReactDOM from 'react-dom/client'
// 苹果风：使用系统 SF 系字体栈（不再打包网络字体）
import './theme/hud.css'
import './theme/apple.css'
import './theme/apple-library.css'
import './theme/apple-detail.css'
import './theme/apple-settings.css'
import './theme/apple-transcript.css'
import './theme/apple-ai.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
