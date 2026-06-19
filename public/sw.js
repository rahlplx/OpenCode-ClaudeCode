const CACHE = "opencode-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { pathname } = new URL(event.request.url);

  // Never intercept API, auth, health, or WebSocket upgrade requests
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/health" ||
    pathname.startsWith("/health/") ||
    pathname.startsWith("/ws")
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    // Navigation: network-first, cached shell as offline fallback
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Static assets: stale-while-revalidate so non-hashed files (manifest, icons) update in background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((res) => {
        if (res.ok && event.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      });

      if (cached) {
        networkFetch.catch(() => {});
        return cached;
      }

      return networkFetch;
    }),
  );
});
