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
    /* 默认只监听本机：此前是 host: true（0.0.0.0），局域网内任何设备都能打开
       这个开发服务器。虽然应用本身没有服务端密钥，dev server 仍会暴露源码与
       /@fs 文件读取面，没必要默认敞开。
       需要用手机连局域网调试时：npm run dev -- --host（或临时改成 host: true）。 */
    host: '127.0.0.1',
    /* ⚠️ 不要用 vite 的 --open 打开浏览器：
       Vite 按监听地址推算要打开的 URL，绑定 127.0.0.1 时它会打开
       http://127.0.0.1:5173/ —— 而浏览器按 origin 隔离 IndexedDB，
       localhost 与 127.0.0.1 是两个不同站点，用户会「看起来数据全没了」
       （旧数据其实还在另一个 origin 下）。
       统一由 启动墨历.bat 打开固定的 http://localhost:5173/。 */
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
