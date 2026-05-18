// =============================================================================
// sw.ts — custom service worker (injectManifest strategy)
// -----------------------------------------------------------------------------
// We hand-write this file so students can read every line. The vite-plugin-pwa
// runtime *injects* the precache manifest into the placeholder below and
// generates the SW file at build time. In dev mode the plugin serves a
// matching SW so the demo also works with `npm run dev`.
//
// Capabilities demonstrated:
//   • Pre-cache the SPA shell (Workbox `precacheAndRoute`).
//   • Runtime caching strategy for API GETs (network-first with cache fallback).
//   • Web Push: receive an encrypted payload and show a notification.
//   • Notification click handler that focuses or opens the app.
// =============================================================================
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// `injectManifest` will inject the array here at build time.
precacheAndRoute(self.__WB_MANIFEST || []);

// ---- Runtime caching ------------------------------------------------------
// Cache GET /api/health and similar simple JSON for offline use.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/health'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 3 })
);

// Static SVG icons / fonts.
registerRoute(
  ({ request }) => ['image', 'font', 'style'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'static-assets' })
);

// ---- Lifecycle ------------------------------------------------------------
self.addEventListener('install', () => {
  // Take effect immediately on update.
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// ---- Web Push -------------------------------------------------------------
// Fires whenever the push service delivers a message — even with no open tab.
self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; url?: string } = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() }; }

  const title = payload.title ?? 'Notification';
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    data: { url: payload.url ?? '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// When the user clicks the notification, focus an existing tab or open new.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data?.url as string) ?? '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(target)) return (c as WindowClient).focus();
    }
    return self.clients.openWindow(target);
  })());
});
