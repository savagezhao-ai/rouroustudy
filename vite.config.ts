import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// 发布版本号：commit 短哈希 + 构建时间（用于页脚展示与 SW 版本化，彻底解决「网站不更新」）
function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}
const BUILD_VERSION = getGitHash()
const BUILD_TIME = new Date()
  .toISOString()
  .slice(0, 16)
  .replace('T', ' ')
  .replace(/[-:]/g, '')

/** 把发布版本写进 HTML 注释与 <meta>，方便用户「查看源代码」一眼确认线上版本 */
function injectBuildInfo() {
  return {
    name: 'inject-build-info',
    transformIndexHtml(html: string) {
      const comment = `<!-- 记词星 发布版本: ${BUILD_VERSION} | 构建时间: ${BUILD_TIME} -->\n`
      const meta = `<meta name="build-version" content="${BUILD_VERSION}">`
      return html
        .replace(/^<!DOCTYPE html>/i, `${comment}<!DOCTYPE html>`)
        .replace(/<head>/i, `<head>\n    ${meta}`)
    },
  }
}

export default defineConfig({
  // GitHub Pages 部署在 /rouroustudy/ 子路径下
  base: '/rouroustudy/',
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(BUILD_VERSION),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // 在 main.tsx 手动注册（带版本化 URL + controllerchange 自动刷新）
      includeAssets: ['pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: '记词星 · 单词记忆助手',
        short_name: '记词星',
        description: '基于 FSRS 间隔重复算法的背单词工具',
        lang: 'zh-CN',
        theme_color: '#4b3fe3',
        background_color: '#f6f5fb',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,wasm}'],
        clientsClaim: true, // 新 SW 立即接管已有页面
        skipWaiting: true, // 新 SW 安装后立即激活
        cleanupOutdatedCaches: true, // 激活时清理旧版本 precache，避免缓存堆积
        runtimeCaching: [
          {
            // 词典数据约 2MB，不做预缓存：只在用户第一次查词时按需下载，
            // 缓存下来后即使清了 IndexedDB 也不用重新下载。
            // 关键：缓存名带上「构建版本号」，每次发版都换新缓存 → 旧词典数据自动失效，
            // 否则 SW 会一直用 CacheFirst 把旧 gz 喂给 App，导致「明明换了词典却还在读甲壳」。
            urlPattern: ({ url }) => url.pathname.includes('/dict/'),
            handler: 'CacheFirst',
            options: {
              cacheName: `dict-data-${BUILD_VERSION}`,
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    injectBuildInfo(),
  ],
})
