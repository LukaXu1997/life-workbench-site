// Service Worker for 生活工作台 PWA
// 更新策略（彻底解决 iOS 主屏 PWA 不更新问题）：
//   - HTML / 页面导航 / version.json：Network-First。有网络必取服务器最新，
//     仅当网络真正失败时回退到缓存（仍可离线启动）。
//   - 同源静态资源：Cache-First（离线可用）。
//   - 跨域资源：CDN 静态库（pdf.js / tesseract）Cache-First 以支持离线；
//     Supabase / API / 用户数据等动态请求一律「透传、不缓存」。
//   - install 用 skipWaiting()，activate 用 clients.claim()+删除旧 Cache，
//     新版本尽快生效，旧 Cache 不残留。
const CACHE = 'life-workbench-app'; // 稳定名称：内容更新由 Network-First 保证，无需随发布手动改版本号

// 仅允许缓存的跨域静态 CDN（版本已 pin，新版本=新 URL）。其余跨域（Supabase 等）透传不缓存。
const STATIC_CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // 新 SW 安装后立即激活，不等旧页面关闭
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))) // 删除所有旧版本 Cache
      .then(() => self.clients.claim()) // 立即接管已打开的页面
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || '提醒', { body: data.body || '', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
  }
});

// Network-First：优先网络；网络失败时回退缓存。绝不因缓存而停留旧版。
function networkFirst(req, cache) {
  return fetch(req).then((res) => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => cache.match(req).then((c) => {
    if (c) return c;
    return new Response('离线且本地无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/DELETE（含 Supabase 写入）绝不缓存，直接走网络
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 跨域：仅 CDN 静态库缓存；Supabase / API / 用户数据 透传、不缓存
  if (!sameOrigin) {
    if (STATIC_CDN.includes(url.hostname)) {
      event.respondWith(
        caches.match(req).then((cached) =>
          cached || fetch(req).then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
        )
      );
    }
    return; // 其他跨域（Supabase 等动态内容）交给浏览器正常请求，SW 不干预
  }

  // 同源：version.json 始终 Network-First（用于客户端探测新版本）
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(caches.open(CACHE).then((c) => networkFirst(req, c)));
    return;
  }

  // 同源：HTML / 页面导航 → Network-First（有网络取最新，失败回退缓存）
  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHTML) {
    event.respondWith(caches.open(CACHE).then((c) => networkFirst(req, c)));
    return;
  }

  // 同源静态资源：Cache-First（离线可用）
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
