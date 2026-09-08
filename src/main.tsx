import React from 'react'
import ReactDOM from 'react-dom/client'
/* 思源黑体/宋体（unicode-range 分片，浏览器按需加载；本地打包离线可用）
   简历排版主字体，与 Magic Resume 同源。兜底系统字体见各模板 --rs-font */
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/700.css'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/700.css'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

/* PWA：仅生产注册 Service Worker（dev 下注册会干扰 HMR 缓存）；
   相对路径注册，适配子路径部署 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
