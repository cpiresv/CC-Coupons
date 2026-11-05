const CACHE = "cc-coupons-shell-__VERSION__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))),
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("cc-coupons-shell-") && key !== CACHE)
        await caches.delete(key);
    }
    await self.clients.claim();
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
