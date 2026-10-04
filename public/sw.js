// KERJAIN service worker: aset statis dari cache, halaman & data selalu dari server.
const CACHE = 'kerjain-v2';
const ASSETS = ['/app.css', '/app.js', '/icon-192.png', '/apple-touch-icon.png'];
// CSS/JS dimuat dengan ?v=<versi>, sehingga setiap deploy baru otomatis memakai file baru.
const OFFLINE = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KERJAIN</title><body style="margin:0;font-family:system-ui,sans-serif;background:#F8FAFC;color:#0F172A;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:16px">
<div><div style="font-size:24px;font-weight:700;color:#2563EB">KERJAIN</div><p style="color:#475569">Tidak ada koneksi internet.<br>Periksa koneksi Anda lalu coba kembali.</p>
<button onclick="location.reload()" style="min-height:44px;padding:0 20px;border:0;border-radius:6px;background:#2563EB;color:#fff;font-size:15px">Coba Lagi</button></div></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.filter((a) => a.endsWith('.png')))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Aset statis & library: tampilkan dari cache, perbarui di belakang layar.
  if (ASSETS.includes(url.pathname) || url.pathname.startsWith('/vendor/')) {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }

  // Halaman: selalu dari jaringan (data pekerjaan tidak disimpan di perangkat).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});
