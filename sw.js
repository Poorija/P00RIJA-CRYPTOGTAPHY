const CACHE_NAME = 'poorija-cryptography-v8';
const SHARE_TARGET_URL = './index.html?share-target=1#share';
const SHARE_TARGET_CACHE_KEY = './__share_target__/latest';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/tailwind/tailwind.generated.css',
  './css/styles.css',
  './js/crypto-config.js',
  './js/app.js',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2',
  './vendor/qrcodejs/qrcode.min.js',
  './vendor/otpauth/otpauth.umd.min.js',
  './vendor/crypto-js/crypto-js.min.js',
  './vendor/jszip/jszip.min.js',
  './assets/icon-app.png',
  './assets/icon-app.svg',
  './assets/icon-maskable.svg',
  './assets/pwa-icons/apple-touch-icon.png',
  './assets/pwa-icons/icon-192.png',
  './assets/pwa-icons/icon-512.png',
  './Fonts/Vazirmatn/Vazirmatn-VariableFont_wght.ttf',
  './Fonts/Inter-Regular.ttf'
];

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function persistShareTargetPayload(formData) {
  const files = await Promise.all(
    formData.getAll('files')
      .filter((entry) => entry instanceof File)
      .map(async (file) => ({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        lastModified: file.lastModified,
        base64: arrayBufferToBase64(await file.arrayBuffer())
      }))
  );

  const payload = {
    title: formData.get('title') || '',
    text: formData.get('text') || '',
    url: formData.get('url') || '',
    files,
    receivedAt: new Date().toISOString()
  };

  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    SHARE_TARGET_CACHE_KEY,
    new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      }
    })
  );
}

async function notifyClientsShareTargetReady() {
  const clientsList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  await Promise.all(clientsList.map(async (client) => {
    try {
      client.postMessage({ type: 'share-target-ready' });
      if ('focus' in client) {
        await client.focus();
      }
      if ('navigate' in client) {
        await client.navigate(SHARE_TARGET_URL);
      }
    } catch (error) {
      // Best effort only.
    }
  }));

  if (!clientsList.length) {
    await self.clients.openWindow(SHARE_TARGET_URL);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname.endsWith('/index.html') && url.searchParams.get('share-target') === '1') {
    event.respondWith(Response.redirect(SHARE_TARGET_URL, 303));
    event.waitUntil((async () => {
      const formData = await request.formData();
      await persistShareTargetPayload(formData);
      await notifyClientsShareTargetReady();
    })());
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        return response;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_error) {
    payload = {
      title: 'P00RIJA Cryptography',
      body: event.data ? event.data.text() : 'Encrypted update received.',
    };
  }

  const title = payload.title || 'P00RIJA Cryptography';
  const options = {
    body: payload.body || 'Encrypted update received.',
    tag: payload.tag || 'poorija-encrypted-update',
    badge: './assets/pwa-icons/icon-192.png',
    icon: './assets/pwa-icons/icon-192.png',
    data: {
      url: payload.url || './#chat',
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './#chat', self.location.origin).href;

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientsList) {
      if ('focus' in client) {
        await client.focus();
      }
      if ('navigate' in client) {
        await client.navigate(targetUrl);
      }
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});
