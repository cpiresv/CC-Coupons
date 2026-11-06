const CACHE = "cc-coupons-shell-__VERSION__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter((key) => key.startsWith("cc-coupons-shell-") && key !== CACHE);
    await Promise.all(previous.map((key) => caches.delete(key)));
    await self.clients.claim();
    if (previous.length) {
      for (const client of await self.clients.matchAll({ type: "window" })) {
        // Navigation must not hold activation open; its fetch waits for activation.
        client.navigate(client.url).catch(() => {});
      }
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const pathname = url.pathname === "/index.html" ? "/" : url.pathname;
  // Only the app shell is cached here; API writes must never be replayed.
  if (event.request.method !== "GET" || url.origin !== self.location.origin ||
      !ASSETS.includes(pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(pathname) || fetch(event.request);
  })());
});
