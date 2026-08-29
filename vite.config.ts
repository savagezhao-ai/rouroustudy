import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages 部署在 /rouroustudy/ 子路径下
  base: '/rouroustudy/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // 在 main.tsx 手动注册（带 controllerchange 自动刷新）
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
      },
    }),
  ],
})
