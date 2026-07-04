/* =========================================================
 * sw.js — Service Worker（オフライン対応）
 * 戦略：stale-while-revalidate
 *   まずキャッシュを返して高速表示しつつ、裏で最新を取得して
 *   キャッシュを更新 → 次回起動時には新しい版が反映されます。
 *   （cache-first と違い、ファイル更新が確実に取り込まれます）
 * データ（予定・タスク・議事録）は localStorage 側に保存されます。
 * ======================================================= */
const CACHE = "mycal-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/store.js",
  "./js/calendar.js",
  "./js/tasks.js",
  "./js/notes.js",
  "./js/sync.js",
  "./js/gcal.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // 同一オリジンのみ扱う
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && (res.type === "basic" || res.type === "default")) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached); // オフライン時はキャッシュへフォールバック
        // キャッシュがあれば即返す（裏で network が更新）。無ければ network を待つ。
        return cached || network;
      })
    )
  );
});
