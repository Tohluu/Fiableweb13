// Network-only: account pages, API responses and delivery details are never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
    if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
    event.respondWith(fetch(event.request).catch(() => new Response(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apexwings | Offline</title><body style="font-family:system-ui;padding:32px;max-width:480px;margin:auto"><h1>You are offline</h1><p>Connect to the internet to book deliveries and see the latest order updates.</p><button onclick="location.reload()">Try again</button></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    )));
});
