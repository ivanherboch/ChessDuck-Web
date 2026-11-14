const CACHE_NAME = 'chessduck-web-v1.6.0-7';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './src/app.js',
  './src/board.js',
  './src/chess.js',
  './src/db.js',
  './src/engine.js',
  './src/feedback.js',
  './src/review-comments.js',
  './src/share-card.js',
  './src/themes.js',
  './src/ui.js',
  './src/features/academy.js',
  './src/features/kid.js',
  './src/features/notation.js',
  './src/features/play.js',
  './src/features/puzzles.js',
  './assets/favicon.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-192-maskable.png',
  './assets/icon-512-maskable.png',
  './assets/mascot.png',
  './assets/wood_move.wav',
  './assets/fonts/fredoka.ttf',
  './assets/data/lessons.json',
  './assets/data/puzzles_hot.tsv',
  './assets/engine/stockfish-19-lite-single.js',
  './assets/engine/stockfish-19-lite-single.wasm',
  './assets/pieces/p_wk.png',
  './assets/pieces/p_wq.png',
  './assets/pieces/p_wr.png',
  './assets/pieces/p_wb.png',
  './assets/pieces/p_wn.png',
  './assets/pieces/p_wp.png',
  './assets/pieces/p_wg.png',
  './assets/pieces/p_bk.png',
  './assets/pieces/p_bq.png',
  './assets/pieces/p_br.png',
  './assets/pieces/p_bb.png',
  './assets/pieces/p_bn.png',
  './assets/pieces/p_bp.png',
  './assets/pieces/p_bg.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      });
    }),
  );
});
