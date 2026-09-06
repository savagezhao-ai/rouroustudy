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
            // 词典数据：SW 只做「透传」(NetworkOnly)，绝不在 SW 层缓存 gz。
            // 原因：App 自己把解析后的词典存进 IndexedDB 作为离线存储，SW 再缓存一份 gz
            // 纯属多余且危险——一旦 SW 吐回旧 gz，即使版本号变了、IndexedDB 清空了，
            // 重新下载那一下仍会拿到旧词典（甲壳就是这样反复出现的）。
            // NetworkOnly + 请求端 cache:'no-store' + URL 带版本号，保证每次取词都拿到最新数据。
            urlPattern: ({ url }) => url.pathname.includes('/dict/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
    injectBuildInfo(),
  ],
})
