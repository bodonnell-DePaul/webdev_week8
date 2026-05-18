// =============================================================================
// pages/SsePage.tsx — Server-Sent Events demo
// -----------------------------------------------------------------------------
// • Uses the native browser `EventSource` API.
// • EventSource CANNOT send custom Authorization headers, so we put the JWT on
//   the query string (see lib/auth.buildSseUrl). The UI shows a banner that
//   explicitly calls this out for students.
// • Includes a "produce item" button so students can watch the same timeline
//   as the polling demo, but delivered with no client poll.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { authHeader, buildSseUrl } from '../lib/auth';
import { useLog } from '../lib/useLog';

export default function SsePage() {
  const { push, Log, clear } = useLog();
  const esRef = useRef<EventSource | null>(null);
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [reconnects, setReconnects] = useState(0);
  const [afterId, setAfterId] = useState(0);
  const [msg, setMsg] = useState('hello from SSE demo');

  function connect() {
    const url = buildSseUrl('/api/sse/stream', { afterId });
    push(`opening SSE → ${url.replace(/access_token=[^&]+/, 'access_token=…')}`, 'muted');
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => { setConnected(true); push('open', 'good'); };
    es.onerror = () => {
      setConnected(false);
      push('error (browser will auto-reconnect)', 'bad');
      setReconnects((n) => n + 1);
    };

    // Default unnamed messages.
    es.onmessage = (e) => {
      setEventCount((n) => n + 1);
      push(`message: ${e.data}`, 'info');
    };

    // Named events from the server (`event: welcome`, `event: item`).
    es.addEventListener('welcome', (e: MessageEvent) => {
      push(`welcome: ${e.data}`, 'good');
    });
    es.addEventListener('item', (e: MessageEvent) => {
      setEventCount((n) => n + 1);
      try {
        const obj = JSON.parse(e.data);
        push(`item #${obj.Id ?? obj.id} ${obj.Message ?? obj.message}`, 'good');
        setAfterId(obj.Id ?? obj.id ?? 0);
      } catch {
        push(`item (unparseable): ${e.data}`, 'bad');
      }
    });
  }
  function disconnect() {
    esRef.current?.close();
    esRef.current = null;
    setConnected(false);
    push('closed', 'muted');
  }
  useEffect(() => () => esRef.current?.close(), []);

  async function produce() {
    await fetch('/api/polling/produce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ message: msg }),
    });
  }

  return (
    <>
      <h2>Server-Sent Events</h2>
      <p>
        Single long-lived HTTP response. The browser handles reconnection and
        <code> Last-Event-ID </code> resume automatically.
      </p>

      <div className="banner">
        <b>Auth caveat (Lecture §6.4):</b> the native <code>EventSource</code> API cannot send a custom
        <code> Authorization </code> header. This demo passes the JWT as
        <code>?access_token=…</code> on the URL — fine for class, never log this in production.
      </div>

      <div className="card">
        <div className="row">
          <button onClick={connected ? disconnect : connect}>
            {connected ? 'Disconnect' : 'Connect EventSource'}
          </button>
          <div className="metric">connected <strong>{connected ? '✓' : '—'}</strong></div>
          <div className="metric">events <strong>{eventCount}</strong></div>
          <div className="metric">reconnects <strong>{reconnects}</strong></div>
          <div className="metric">lastEventId <strong>{afterId || '—'}</strong></div>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Produce server event</h3>
        <div className="row">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} style={{ flex: 1 }} />
          <button onClick={produce}>Produce</button>
        </div>
      </div>

      <Log />
    </>
  );
}
