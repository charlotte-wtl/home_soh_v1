// App-shell cache so the list opens with no signal (e.g. in the shop).
// Data lives in IndexedDB, never in this cache. Network-first, so a new
// deploy takes effect on the next open — same approach as TCM Tracker.
const CACHE = "soh-shell-v2";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.json",
  "./js/app.js",
  "./js/browse.js",
  "./js/connect.js",
  "./js/dates.js",
  "./js/db.js",
  "./js/forms.js",
  "./js/home.js",
  "./js/ids.js",
  "./js/import.js",
  "./js/item.js",
  "./js/merge.js",
  "./js/model.js",
  "./js/more.js",
  "./js/rows.js",
  "./js/store.js",
  "./js/shop.js",
  "./js/sync.js",
  "./js/ui.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // never intercept the GitHub API
  const request = event.request.mode === "navigate" ? event.request : new Request(event.request, { cache: "no-cache" });
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
