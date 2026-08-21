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
const APP_VERSION = '2.2.5'; // 与 index.html、version.json 保持一致。发布新版时三处同步修改即可。
const CACHE = `life-workbench-${APP_VERSION}`; // 每发布一版 = 一个全新 Cache 名；activate 时会删除旧的 life-workbench-* Cache

// 仅允许缓存的跨域静态 CDN（版本已 pin，新版本 = 新 URL）。其余跨域（Supabase 等）透传不缓存。
const STATIC_CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];

// 离线兜底页：离线且本地无缓存时展示（替代原先的 503 纯文本）。
const OFFLINE_URL = './offline.html';
// 极端兜底（install 时连 offline.html 都没能缓存）：用内联 HTML，保证离线也不出现 503 纯文本。
const OFFLINE_FALLBACK_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>离线</title><style>html,body{height:100%;margin:0}body{font-family:-apple-system,sans-serif;' +
  'background:#0d0d0e;color:#f5f5f7;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}' +
  'h1{font-size:19px;font-weight:600;margin:0 0 8px}p{color:#98989d;font-size:14px;line-height:1.5}' +
  'button{margin-top:18px;border:0;background:#0A84FF;color:#fff;font-size:15px;font-weight:600;' +
  'padding:12px 22px;border-radius:12px;min-height:44px;cursor:pointer}</style>' +
  '<div><h1>你已离线</h1><p>当前没有网络连接，且本地没有可用的缓存版本。<br>恢复网络后重试即可继续使用。</p>' +
  '<button onclick="location.reload()">重试</button></div>';

self.addEventListener('install', (event) => {
  // 预缓存应用首页（单文件 index.html）+ 离线兜底页，保证首次安装后离线可启动。
  // 不预缓存用户数据 / Supabase 请求。
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(['./', OFFLINE_URL]);
    } catch (e) {}
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
// isHTML=true 时：离线且本地无缓存 → 返回离线兜底页（而非 503 纯文本）。
function networkFirst(req, cache, isHTML) {
  const networkRequest = new Request(req, { cache: 'no-store' });
  return fetch(networkRequest).then((res) => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(async () => {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (isHTML) {
      const off = await cache.match(OFFLINE_URL);
      if (off) return off;
      return new Response(OFFLINE_FALLBACK_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('离线且本地无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  });
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
    event.respondWith(caches.open(CACHE).then((c) => networkFirst(req, c, false)));
    return;
  }

  // 同源：HTML / 页面导航 → Network-First（有网络取最新，失败回退缓存）
  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHTML) {
    event.respondWith(caches.open(CACHE).then((c) => networkFirst(req, c, true)));
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
