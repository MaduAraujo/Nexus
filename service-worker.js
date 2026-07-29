const CACHE_VERSION = 'nexus-v2';
const PRECACHE_URLS = [
    '/index.html',
    '/manifest.json',
    '/src/styles/index.css',
    '/src/javascript/index.js',
    '/src/javascript/shared/theme.js',
    '/src/assets/icons/icon-192.png',
    '/src/assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { title: 'Nexus', body: event.data ? event.data.text() : '' };
    }

    const title = data.title || 'Nexus';
    const options = {
        body: data.body || '',
        icon: '/src/assets/icons/icon-192.png',
        badge: '/src/assets/icons/icon-192.png',
        data: { url: data.url || '/index.html' },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

const VAPID_PUBLIC_KEY = 'BKEh0-IRJSvTztskLtGWT6syeAf1dyrRJwslbUs9v9ISuu9nMdr4fthxtkT6P8UdEDR4GJMKXJIXRNb-9EJhgAY';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
        self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }).then((subscription) =>
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: subscription.toJSON() }));
            })
        )
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/index.html';

    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then((clients) => {
            for (const client of clients) {
                if (client.url.includes(url) && 'focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(url);
        })
    );
});

function isCacheable(request, url) {
    if (request.method !== 'GET') return false;
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith('/supabase/')) return false;
    return true;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (!isCacheable(request, url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
