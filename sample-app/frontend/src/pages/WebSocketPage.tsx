// =============================================================================
// pages/WebSocketPage.tsx — raw WebSocket (no framework)
// -----------------------------------------------------------------------------
// Connects to /ws/echo (handled by EchoWebSocketHandler in the backend).
// Demonstrates: bidirectional messaging, server-initiated push (the "tick"
// frame every 2s), and the auth/header constraint identical to EventSource.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { buildWsUrl } from '../lib/auth';
import { useLog } from '../lib/useLog';

export default function WebSocketPage() {
  const { push, Log, clear } = useLog();
  const wsRef = useRef<WebSocket | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('hello, websocket');
  const [sent, setSent] = useState(0);
  const [recvd, setRecvd] = useState(0);

  function connect() {
    const url = buildWsUrl('/ws/echo');
    push(`opening WebSocket → ${url.replace(/access_token=[^&]+/, 'access_token=…')}`, 'muted');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => { setOpen(true); push('open', 'good'); };
    ws.onclose = (e) => { setOpen(false); push(`closed code=${e.code} reason=${e.reason}`, 'muted'); };
    ws.onerror = () => { push('error', 'bad'); };
    ws.onmessage = (e) => {
      setRecvd((n) => n + 1);
      try {
        const obj = JSON.parse(e.data);
        if (obj.type === 'tick') {
          push(`⏱ server tick #${obj.n} at ${obj.at}`, 'muted');
        } else if (obj.type === 'echo') {
          push(`↩ echo: ${obj.echoed}`, 'good');
        } else {
          push(`${e.data}`, 'info');
        }
      } catch {
        push(`${e.data}`, 'info');
      }
    };
  }
  function disconnect() { wsRef.current?.close(); wsRef.current = null; }
  function send() {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(text);
    setSent((n) => n + 1);
    push(`→ sent: ${text}`, 'info');
  }
  useEffect(() => () => wsRef.current?.close(), []);

  return (
    <>
      <h2>Raw WebSocket</h2>
      <p>
        Bidirectional persistent connection. The server echoes anything you
        send and also pushes a "tick" every 2 seconds — that's the unsolicited
        server→client capability you don't get from polling/SSE/streaming.
      </p>

      <div className="banner">
        <b>Auth caveat:</b> browser <code>WebSocket</code> also cannot set custom
        headers, so the JWT comes via <code>?access_token=…</code> — same trade-off as SSE.
      </div>

      <div className="card">
        <div className="row">
          <button onClick={open ? disconnect : connect}>
            {open ? 'Disconnect' : 'Connect'}
          </button>
          <div className="metric">state <strong>{open ? 'OPEN' : '—'}</strong></div>
          <div className="metric">sent <strong>{sent}</strong></div>
          <div className="metric">received <strong>{recvd}</strong></div>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Send a message</h3>
        <div className="row">
          <input value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
          <button disabled={!open} onClick={send}>Send</button>
        </div>
      </div>

      <Log />
    </>
  );
}
