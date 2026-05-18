// =============================================================================
// pages/PushPage.tsx — Web Push (VAPID) demo
// -----------------------------------------------------------------------------
// Walks students through every step:
//   1. Request Notification permission.
//   2. Get a service worker registration (provided by vite-plugin-pwa).
//   3. Fetch the server's VAPID public key.
//   4. Subscribe via `pushManager.subscribe(...)`.
//   5. POST the subscription details to /api/push/subscribe.
//   6. Trigger a test push via /api/push/send.
//   7. Receive it in the service worker (sw.ts) which calls showNotification.
//
// The whole point is: this still works even after closing the tab.
// =============================================================================

import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';
import { useLog } from '../lib/useLog';

// Convert base64url to Uint8Array — required by pushManager.subscribe.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushPage() {
  const { push, Log, clear } = useLog();
  const [permission, setPermission] = useState(Notification.permission);
  const [subscribed, setSubscribed] = useState(false);
  const [title, setTitle] = useState('Hello from class!');
  const [body, setBody] = useState('Web Push delivered this notification.');

  useEffect(() => {
    (async () => {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          setSubscribed(!!sub);
        }
      }
    })();
  }, []);

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      push('Push API not supported in this browser', 'bad');
      return;
    }

    // 1. Permission.
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== 'granted') { push(`permission: ${perm}`, 'bad'); return; }
    push(`permission granted`, 'good');

    // 2. SW registration.
    const reg = await navigator.serviceWorker.ready;
    push(`service worker ready`, 'muted');

    // 3. VAPID public key from server.
    const { publicKey } = await (await fetch('/api/push/vapid-public-key')).json();
    push(`fetched VAPID public key (${publicKey.length} chars)`, 'muted');

    // 4. Subscribe.
    // Note: pass the Uint8Array buffer (ArrayBuffer) to satisfy the
    // PushSubscriptionOptionsInit type without a `Uint8Array<SharedArrayBuffer>` mismatch.
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
    push(`subscription endpoint: ${sub.endpoint.slice(0, 60)}…`, 'good');

    // 5. POST to backend.
    const json = sub.toJSON();
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      }),
    });
    if (res.ok) {
      setSubscribed(true);
      push('subscription saved on server', 'good');
    } else {
      push(`server returned ${res.status}`, 'bad');
    }
  }

  async function sendTest() {
    const res = await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ title, body, url: '/push' }),
    });
    const j = await res.json();
    push(`sent=${j.sent} failed=${j.failed}`, j.sent > 0 ? 'good' : 'bad');
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
      setSubscribed(false);
      push('local subscription removed (server copy will expire)', 'muted');
    }
  }

  return (
    <>
      <h2>Web Push (VAPID)</h2>
      <p>
        Server can ring the user's "doorbell" through the browser's vendor push
        service — even when this tab is closed (try it!). VAPID signs the
        request so the push service knows who's calling.
      </p>

      <div className="banner">
        <b>Caveats:</b> permission prompts are easy for users to decline; iOS requires the user
        to install the PWA before push works (Lecture §11).
      </div>

      <div className="card">
        <div className="row">
          <div className="metric">permission <strong>{permission}</strong></div>
          <div className="metric">subscribed <strong>{subscribed ? '✓' : '—'}</strong></div>
          <button onClick={subscribe} disabled={subscribed}>Subscribe</button>
          <button className="secondary" onClick={unsubscribe} disabled={!subscribed}>Unsubscribe</button>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Send a test notification</h3>
        <div className="row" style={{ margin: '6px 0' }}>
          <label style={{ width: 60 }}>title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ margin: '6px 0' }}>
          <label style={{ width: 60 }}>body</label>
          <input value={body} onChange={(e) => setBody(e.target.value)} style={{ flex: 1 }} />
        </div>
        <button onClick={sendTest}>Send to all subscribers</button>
      </div>

      <Log />
    </>
  );
}
