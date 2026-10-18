/* ============================================================
   Moloiso Pig Farm — Service Worker
   Caches all static assets for full offline support.
   ============================================================ */

   const CACHE_NAME = 'moloiso-pigfarm-v1';

   // All assets required for the app to function offline
   const PRECACHE_ASSETS = [
     './',
     './index.html',
     './style.css',
     './app.js',
     './manifest.json',
     'https://unpkg.com/dexie/dist/dexie.js'
   ];
   
   /* ---------- INSTALL: Pre-cache all static assets ---------- */
   self.addEventListener('install', (event) => {
     console.log('[SW] Installing Moloiso Pig Farm…');
     event.waitUntil(
       caches.open(CACHE_NAME)
         .then((cache) => {
           console.log('[SW] Pre-caching app shell');
           return cache.addAll(PRECACHE_ASSETS);
         })
         .then(() => self.skipWaiting())
         .catch((err) => console.error('[SW] Pre-cache failed:', err))
     );
   });
   
   /* ---------- ACTIVATE: Clean old caches ---------- */
   self.addEventListener('activate', (event) => {
     console.log('[SW] Activating…');
     event.waitUntil(
       caches.keys().then((keys) => {
         return Promise.all(
           keys.map((key) => {
             if (key !== CACHE_NAME) {
               console.log('[SW] Removing old cache:', key);
               return caches.delete(key);
             }
             return Promise.resolve();
           })
         );
       }).then(() => self.clients.claim())
     );
   });
   
   /* ---------- FETCH: Cache-first strategy with network fallback ---------- */
   self.addEventListener('fetch', (event) => {
     // Only handle GET requests
     if (event.request.method !== 'GET') return;
   
     // Skip non-http(s) schemes (e.g. chrome-extension)
     const url = new URL(event.request.url);
     if (!url.protocol.startsWith('http')) return;
   
     event.respondWith(
       caches.match(event.request).then((cachedResponse) => {
         if (cachedResponse) {
           // Serve from cache, then update in background (stale-while-revalidate)
           event.waitUntil(
             fetch(event.request)
               .then((networkResponse) => {
                 if (networkResponse && networkResponse.status === 200) {
                   const copy = networkResponse.clone();
                   caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                 }
               })
               .catch(() => { /* offline — keep cached version */ })
           );
           return cachedResponse;
         }
   
         // Not in cache → fetch from network
         return fetch(event.request)
           .then((networkResponse) => {
             // Cache successful GET responses for same-origin and CDN
             if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
               const copy = networkResponse.clone();
               caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
             }
             return networkResponse;
           })
           .catch(() => {
             // Offline fallback for navigation requests
             if (event.request.mode === 'navigate') {
               return caches.match('./index.html');
             }
             return new Response('Offline — resource not available.', {
               status: 503,
               statusText: 'Service Unavailable',
               headers: { 'Content-Type': 'text/plain' }
             });
           });
       })
     );
   });
   
   /* ---------- MESSAGE: Allow skipping waiting ---------- */
   self.addEventListener('message', (event) => {
     if (event.data && event.data.type === 'SKIP_WAITING') {
       self.skipWaiting();
     }
   });