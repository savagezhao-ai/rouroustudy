import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ===== Service Worker 更新（彻底解决「网站一直停在旧版」）=====
// 关键修复：注册时给 sw.js 挂上「发布版本」查询参数（sw.js?v=版本号）。
// 每次发版版本号都不同 → 浏览器认为这是一个全新的 SW 脚本 URL →
// 必定绕过 HTTP/SW 缓存重新下载，从机制上杜绝「改了代码线上却不变」。
// 配合：发现新 SW 自动接管 + controllerchange 自动刷新 + 每分钟轮询 + 手动「强制刷新」。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const base = import.meta.env.BASE_URL // e.g. /rouroustudy/
  const version = import.meta.env.VITE_BUILD_VERSION ?? 'dev'
  const swUrl = `${base}sw.js?v=${version}`

  let refreshing = false
  let applied = false

  // 强制清空所有 Service Worker + 本地词典库并硬刷新——用户最后的「救命」按钮
  // 关键：除了注销 SW，还直接删除 IndexedDB 里的词典库（rouroustudy_dict），
  // 否则重载后 App 仍可能从旧库读数据。删除后必定重新联网下载干净词典。
  const forceReload = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    } catch {
      /* 忽略 */
    }
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('rouroustudy_dict')
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    } catch {
      /* 忽略 */
    }
    window.location.reload()
  }

  const applyUpdate = () => {
    if (applied) return
    applied = true
    try {
      navigator.serviceWorker.getRegistration(base).then((reg) => {
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
      })
    } catch {
      /* 忽略 */
    }
    // 兜底：部分 Safari 不触发 controllerchange，1 秒后直接刷新
    setTimeout(() => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    }, 1000)
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })

  const promptIfWaiting = (reg: ServiceWorkerRegistration) => {
    if (reg.waiting && !document.getElementById('pwa-update-banner')) {
      showUpdateBanner(applyUpdate)
    }
  }

  navigator.serviceWorker
    .register(swUrl, { scope: base })
    .then((reg) => {
      promptIfWaiting(reg)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
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

  // 暴露给页脚「强制刷新」按钮
  ;(window as unknown as { __forcePwaReload?: () => void }).__forcePwaReload = forceReload
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
