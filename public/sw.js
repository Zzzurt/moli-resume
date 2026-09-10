/* 墨历 · Service Worker
   策略：应用壳离线可开（数据存 IndexedDB，天然离线可用）
   - HTML 导航请求：Network First，失败回退缓存的入口页
   - 静态资源（带 hash 的 js/css/woff2 等）：Stale While Revalidate（缓存友好、可离线）
   注册 ./sw.js，作用域 ./（相对 base，适配子路径部署）
*/
const CACHE_NAME = 'ink-resume-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['./favicon.svg', './icon.svg'])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 导航（HTML）：网络优先，离线回退到缓存的入口
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {})
          return res
        })
        .catch(async () => {
          const hit = (await caches.match('./index.html')) || (await caches.match(request))
          // respondWith(undefined) 会直接报错：这里必须给出一个真实响应兜底
          return hit || new Response('离线且无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        })
    )
    return
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(request).then((hit) => {
      const fetched = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => hit)
      return hit || fetched
    })
  )
})