import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 相对路径，便于部署到任意静态目录 / 对象存储 / GitHub Pages 子路径
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: true,
    // 生产部署优化：按功能域分包，缓存友好。
    // 注意：pdf（html2canvas/jspdf）不做手动分包——已在 EditorPage 中动态 import，
    // Rollup 会自动切出异步 chunk；手动指定反而会把共享的 preload 辅助函数
    // 挤进 pdf chunk，导致主包产生静态依赖边、560KB 提前进首屏。
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/core'],
          storage: ['dexie'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
})
