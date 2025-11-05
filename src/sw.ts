/// <reference lib="webworker" />

const CACHE_NAME = 'quantum-chess-v1';
const STATIC_ASSETS: string[] = [
  '/',
  '/manifest.json',
  '/client.js',
  '/getPossibleMoves.js',
  '/types.js',
  '/board.png',
  '/icons/icon-192x192.svg',
  '/pieces/simple/white-pawn.png',
  '/pieces/simple/white-rook.png',
  '/pieces/simple/white-knight.png',
  '/pieces/simple/white-bishop.png',
  '/pieces/simple/white-queen.png',
  '/pieces/simple/white-king.png',
  '/pieces/simple/black-pawn.png',
  '/pieces/simple/black-rook.png',
  '/pieces/simple/black-knight.png',
  '/pieces/simple/black-bishop.png',
  '/pieces/simple/black-queen.png',
  '/pieces/simple/black-king.png'
];

// Install event - cache static assets
self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        (self as any).skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      })
      .then(() => {
        (self as any).clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event: any) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests - these need to be live
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          return response;
        }

        // Otherwise, fetch from network and cache
        return fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response since it can only be consumed once
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // If both cache and network fail, return a basic offline page for HTML requests
            const acceptHeader = event.request.headers.get('accept');
            if (acceptHeader && acceptHeader.includes('text/html')) {
              return new Response(
                '<html><body><h1>Offline</h1><p>Quantum Chess is currently offline. Please check your internet connection.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            }
            return undefined;
          });
      })
      .then((response) => {
        if (response) {
          return response;
        }
        // Return a basic fallback response
        return new Response('Service unavailable', { status: 503 });
      })
  );
});

// Background sync for when connection is restored
self.addEventListener('sync', (event: any) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle any background sync tasks here
      console.log('Background sync triggered')
    );
  }
});

// Handle push notifications (if needed later)
self.addEventListener('push', (event: any) => {
  if (event.data) {
    const options: any = {
      body: event.data.text(),
      icon: '/icons/icon-192x192.svg',
      badge: '/board.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      }
    };

    event.waitUntil(
      (self as any).registration.showNotification('Quantum Chess', options)
    );
  }
});

export {};
