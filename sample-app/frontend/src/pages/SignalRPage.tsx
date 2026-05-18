// =============================================================================
// pages/SignalRPage.tsx — chat hub demo
// -----------------------------------------------------------------------------
// Demonstrates the SignalR advantages over raw WebSockets:
//   • Negotiated transport (visible in the log — usually "WebSockets").
//   • Automatic reconnection with exponential backoff.
//   • Server-side RPC methods (`SendMessage`, `GetHistory`, `JoinRoom`, ...).
//   • Strongly typed client → server and server → client method calls.
//   • Groups for targeted broadcast.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { getToken } from '../lib/auth';
import { useLog } from '../lib/useLog';

type ChatMessage = { user: string; text: string; sentAt: string };

export default function SignalRPage() {
  const { push, Log, clear } = useLog();
  const connRef = useRef<HubConnection | null>(null);
  const [state, setState] = useState<'idle' | 'connected' | 'reconnecting' | 'disconnected'>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [room, setRoom] = useState('lobby');
  const [text, setText] = useState('hello, SignalR!');
  const [transport, setTransport] = useState<string>('?');

  async function connect() {
    const conn = new HubConnectionBuilder()
      .withUrl('/hubs/chat', { accessTokenFactory: () => getToken() ?? '' })
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Information)
      .build();

    // Server → client callbacks ----------------------------------------------
    conn.on('ReceiveMessage', (user: string, t: string, sentAt: string) => {
      setMessages((m) => [...m, { user, text: t, sentAt }]);
      push(`📨 ${user}: ${t}`, 'good');
    });
    conn.on('UserConnected', (u: string) => push(`🟢 ${u} connected`, 'muted'));
    conn.on('UserDisconnected', (u: string) => push(`🔴 ${u} disconnected`, 'muted'));
    conn.on('Typing', (u: string, typing: boolean) =>
      typing ? push(`✏ ${u} is typing…`, 'muted') : null
    );
    conn.on('ReceiveRoomMessage', (r: string, u: string, t: string) =>
      push(`🏷 [${r}] ${u}: ${t}`, 'info')
    );
    conn.on('RoomJoined', (r: string, u: string) => push(`${u} joined room ${r}`, 'muted'));

    // Lifecycle --------------------------------------------------------------
    conn.onreconnecting(() => { setState('reconnecting'); push('reconnecting…', 'bad'); });
    conn.onreconnected(() => { setState('connected'); push('reconnected', 'good'); });
    conn.onclose(() => { setState('disconnected'); push('closed', 'muted'); });

    try {
      await conn.start();
      // The internal transport choice is on conn.connection.transport but
      // typed access depends on SignalR build. We probe with try/catch.
      try {
        // @ts-expect-error — private but useful for class demo
        setTransport(conn.connection?.transport?.name ?? 'WebSockets');
      } catch { /* ignore */ }

      connRef.current = conn;
      setState('connected');
      push('connected', 'good');

      // Load history right after connect.
      const hist: ChatMessage[] = await conn.invoke('GetHistory', 20);
      setMessages(hist);
      push(`loaded ${hist.length} history messages`, 'muted');
    } catch (e: any) {
      push(`connect failed: ${e.message ?? e}`, 'bad');
    }
  }
  async function disconnect() {
    await connRef.current?.stop();
    connRef.current = null;
  }
  useEffect(() => () => { connRef.current?.stop(); }, []);

  async function send() {
    if (!connRef.current) return;
    await connRef.current.invoke('SendMessage', text);
  }
  async function joinRoom() { await connRef.current?.invoke('JoinRoom', room); }
  async function sendRoom() { await connRef.current?.invoke('SendToRoom', room, text); }
  let typingTimer: any;
  function onTypingChange() {
    if (!connRef.current) return;
    connRef.current.invoke('Typing', true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => connRef.current?.invoke('Typing', false), 1000);
  }

  return (
    <>
      <h2>SignalR — chat hub</h2>
      <p>
        Hub method invocations both ways, automatic transport negotiation,
        automatic reconnection, and group targeting — all without writing
        socket lifecycle code.
      </p>

      <div className="card">
        <div className="row">
          <button onClick={state === 'connected' ? disconnect : connect}>
            {state === 'connected' ? 'Disconnect' : 'Connect'}
          </button>
          <div className="metric">state <strong>{state}</strong></div>
          <div className="metric">transport <strong>{transport}</strong></div>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Send broadcast / room</h3>
        <div className="row">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); onTypingChange(); }}
            style={{ flex: 1 }}
          />
          <button disabled={state !== 'connected'} onClick={send}>Broadcast</button>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <label>room</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)} style={{ width: 120 }} />
          <button className="secondary" disabled={state !== 'connected'} onClick={joinRoom}>Join</button>
          <button className="secondary" disabled={state !== 'connected'} onClick={sendRoom}>Send to room</button>
        </div>
      </div>

      <div className="card">
        <h3>History ({messages.length})</h3>
        <div style={{ maxHeight: 240, overflowY: 'auto', fontSize: 13 }}>
          {messages.map((m, i) => (
            <div key={i}>
              <code style={{ color: 'var(--muted)' }}>{new Date(m.sentAt).toLocaleTimeString()}</code>{' '}
              <b>{m.user}:</b> {m.text}
            </div>
          ))}
        </div>
      </div>

      <Log />
    </>
  );
}
