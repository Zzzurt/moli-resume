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
    // 生产部署优化：按功能域分包，缓存友好
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/core'],
          pdf: ['html2canvas', 'jspdf'],
          storage: ['dexie'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
})
