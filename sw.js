// Service Worker for 生活工作台 PWA
// 更新策略（彻底解决 iOS 主屏 PWA 不更新问题）：
//   - HTML / 页面导航 / version.json：Network-First，且请求带 cache:'no-store' 真正绕过 HTTP 缓存；
//     有网络必取服务器最新，仅网络失败时回退缓存（仍可离线启动）。
//   - 同源静态资源：Cache-First（离线可用）。
//   - 跨域资源：CDN 静态库（pdf.js / tesseract）Cache-First 以支持离线；
//     Supabase / API / 用户数据等动态请求一律「透传、不缓存」。
//   - install 用 skipWaiting()，activate 用 clients.claim()+仅清理本应用前缀旧 Cache，
//     新版本尽快生效，旧 Cache 不残留，且不影响同域名下其他应用。
const CACHE_PREFIX = 'life-workbench-';
const CACHE = 'life-workbench-app-v1'; // 仅当 SW 缓存结构 / 静态资源策略变化时才升 v2 / v3 …

// 仅允许缓存的跨域静态 CDN（版本已 pin，新版本 = 新 URL）。其余跨域（Supabase 等）透传不缓存。
const STATIC_CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (event) => {
  // 预缓存应用首页（单文件 index.html），保证首次安装后离线可启动。
  // 不预缓存用户数据 / Supabase 请求。
  event.waitUntil((async () => {
    try { const cache = await caches.open(CACHE); await cache.addAll(['./']); } catch (e) {}
    await self.skipWaiting(); // 缓存完成后立即激活，不等旧页面关闭
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // 仅删除「本应用前缀」且「非当前 Cache」的旧缓存，不影响同域名下其他应用
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // 立即接管已打开的页面
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    self.registration.showNotification(data.title || '提醒', { body: data.body || '', icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
  }
});

// Network-First：优先网络（带 no-store 绕过 HTTP 缓存）；网络失败时回退缓存。
// 绝不因缓存而停留旧版。
function networkFirst(req, cache) {
  const networkRequest = new Request(req, { cache: 'no-store' });
  return fetch(networkRequest).then((res) => {
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

  // 同源：version.json 始终 Network-First（用于客户端探测新版本，no-store 绕过 HTTP 缓存）
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
