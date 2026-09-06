import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ===== Service Worker 更新（彻底解决「Safari 一直停在旧版」）=====
// 思路：
//  1) 发现新 SW 在等待时，弹出「发现新版本 · 立即更新」横幅，用户点一下就更新；
//  2) controllerchange 时自动刷新页面（autoUpdate 模式下 SW 会自行 skipWaiting）；
//  3) Safari 独立 PWA 不会主动检查更新，定时轮询以捕捉新版本。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let refreshing = false
  let applied = false
  let waiting: ServiceWorker | null = null

  const applyUpdate = () => {
    if (applied) return
    applied = true
    waiting?.postMessage({ type: 'SKIP_WAITING' })
    // 兜底：部分 Safari 不触发 controllerchange，1 秒后直接刷新
    setTimeout(() => {
      if (!refreshing) window.location.reload()
    }, 1000)
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  const promptIfWaiting = (reg: ServiceWorkerRegistration) => {
    if (reg.waiting && !document.getElementById('pwa-update-banner')) {
      waiting = reg.waiting
      showUpdateBanner(applyUpdate)
    }
  }

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      promptIfWaiting(reg)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = reg.waiting
            showUpdateBanner(applyUpdate)
          }
        })
      })
      // Safari 独立 PWA 不主动轮询，每分钟检查一次新版本
      setInterval(() => {
        reg.update().then(() => promptIfWaiting(reg)).catch(() => {})
      }, 60_000)
    })
    .catch(() => {
      /* 注册失败不阻塞正常使用 */
    })
}

/** 在页面顶部注入一个更新提示横幅 */
function showUpdateBanner(onUpdate: () => void) {
  if (document.getElementById('pwa-update-banner')) return
  const bar = document.createElement('div')
  bar.id = 'pwa-update-banner'
  bar.className = 'pwa-update-banner'
  bar.innerHTML = `
    <span class="pwa-update-text">🎉 发现新版本</span>
    <button type="button" class="pwa-update-btn">立即更新</button>
  `
  bar.querySelector<HTMLButtonElement>('.pwa-update-btn')!.addEventListener('click', onUpdate)
  document.body.appendChild(bar)
}
