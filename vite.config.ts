/**
 * Web 版 Vite 配置（纯浏览器形态，与 electron-vite 的 renderer 共享同一套源码）
 * - 开发: npm run web:dev  → http://localhost:5173（HMR 秒级）
 * - 构建: npm run web:build → web-dist/（可部署 GitHub Pages 或绿色 zip）
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src'),
      // deadem 使用 UMD 浏览器 bundle（依赖内联），此 alias 让值导入走全局适配层，
      // 避免 Vite 打包 deadem 源码时的 `?worker&inline` / CJS interop 问题
      '@deademx/cs2': resolve(__dirname, 'src/web/lib/deadem-wrapper.ts'),
      '@deademx/engine': resolve(__dirname, 'src/web/lib/deadem-wrapper.ts')
    }
  },
  build: {
    outDir: resolve(__dirname, 'web-dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  },
  server: {
    port: 5173,
    open: true // 一键运行：自动打开浏览器
  }
})
