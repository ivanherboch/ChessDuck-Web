const CACHE_NAME = 'chessduck-v2.4.8-1';

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './css/styles.css',
    './src/app.js',
    './src/core/chess.js',
    './src/core/lessons.js',
    './src/core/piece-fr.js',
    './src/core/puzzle-themes.js',
    './src/core/spoken-fr.js',
    './src/core/stockfish.js',
    './src/core/text.js',
    './src/data/db.js',
    './src/data/prefs.js',
    './src/ui/board-geometry.js',
    './src/ui/board.js',
    './src/ui/captured.js',
    './src/ui/common.js',
    './src/ui/feedback.js',
    './src/ui/icons.js',
    './src/ui/line-playback.js',
    './src/ui/narrator.js',
    './src/ui/pieces.js',
    './src/ui/theme.js',
    './src/features/academy.js',
    './src/features/export-sheet.js',
    './src/features/game-analysis.js',
    './src/features/game-logic.js',
    './src/features/history-sheet.js',
    './src/features/kid.js',
    './src/features/lesson-catalog.js',
    './src/features/memo-sheet.js',
    './src/features/notation-logic.js',
    './src/features/notation.js',
    './src/features/play.js',
    './src/features/puzzle-catalog.js',
    './src/features/puzzles.js',
    './src/features/review-comments.js',
    './src/features/settings-sheet.js',
    './src/features/share-card.js',
    './assets/mascot.png',
    './assets/mascot.svg',
    './assets/wood_move.wav',
    './assets/lessons.json',
    './assets/fonts/fredoka.ttf',
    './assets/icons/apple-touch-icon.png',
    './assets/icons/favicon.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/pieces/Chess_bdt45.svg',
    './assets/pieces/Chess_blt45.svg',
    './assets/pieces/Chess_kdt45.svg',
    './assets/pieces/Chess_klt45.svg',
    './assets/pieces/Chess_ndt45.svg',
    './assets/pieces/Chess_nlt45.svg',
    './assets/pieces/Chess_pdt45.svg',
    './assets/pieces/Chess_plt45.svg',
    './assets/pieces/Chess_qdt45.svg',
    './assets/pieces/Chess_qlt45.svg',
    './assets/pieces/Chess_rdt45.svg',
    './assets/pieces/Chess_rlt45.svg',
    './assets/pieces/p_bg.png',
    './assets/pieces/p_wg.png',
    './assets/puzzles/meta.bin.gz',
    './assets/puzzles/starter.tsv.gz',
    './vendor/stockfish/Copying.txt',
    './vendor/stockfish/stockfish-19-lite-single.js',
    './vendor/stockfish/stockfish-19-lite-single.wasm',
];

function isHeavyStaticAsset(pathname) {
    return pathname.includes('/assets/pieces/')
        || pathname.includes('/assets/icons/')
        || pathname.includes('/assets/fonts/')
        || pathname.includes('/assets/puzzles/')
        || pathname.includes('/vendor/stockfish/')
        || pathname.endsWith('/assets/mascot.png')
        || pathname.endsWith('/assets/mascot.svg')
        || pathname.endsWith('/assets/wood_move.wav');
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(PRECACHE_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (isHeavyStaticAsset(url.pathname)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
        })());
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const net = await fetch(req);
            if (net && net.ok) cache.put(req, net.clone()).catch(() => {});
            return net;
        } catch {
            const hit = await cache.match(req);
            if (hit) return hit;
            if (req.mode === 'navigate') {
                return (await cache.match('./index.html')) || (await cache.match('./'));
            }
            return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
        }
    })());
});
