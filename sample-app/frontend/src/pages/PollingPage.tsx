// =============================================================================
// pages/PollingPage.tsx — Short vs Long polling demo
// =============================================================================
// Two side-by-side panels:
//   LEFT  — calls /api/polling/items every interval. Watch the network tab:
//           the request fires on a timer regardless of whether new data is
//           available.
//   RIGHT — calls /api/polling/long-poll, which the server holds open until
//           something appears (or the configured timeout elapses).
//
// Both panels read from the same shared PollItem timeline, so producing an
// event affects both at once. This is the cleanest way to make the latency
// trade-off obvious to students.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { authHeader } from '../lib/auth';
import { useLog } from '../lib/useLog';

type Item = { id: number; message: string; createdAt: string };

export default function PollingPage() {
  // ---- shared "produce" form ----
  const [msg, setMsg] = useState('hello from polling demo');
  async function produce() {
    await fetch('/api/polling/produce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ message: msg }),
    });
  }

  return (
    <>
      <h2>HTTP Polling — short vs long</h2>
      <p>
        Both panels read the same server timeline. Produce an item and watch
        how each transport reacts.
      </p>

      <div className="card">
        <div className="row">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} style={{ flex: 1 }} />
          <button onClick={produce}>Produce item</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ShortPollPanel />
        <LongPollPanel />
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// SHORT POLLING — fires on a timer regardless of whether data exists.
// -----------------------------------------------------------------------------
function ShortPollPanel() {
  const { push, Log, clear } = useLog();
  const [running, setRunning] = useState(false);
  const [interval, setInterval_] = useState(2000);
  const lastIdRef = useRef(0);
  const [reqCount, setReqCount] = useState(0);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;

    async function tick() {
      const t0 = performance.now();
      try {
        const res = await fetch(
          `/api/polling/items?afterId=${lastIdRef.current}`,
          { headers: authHeader() }
        );
        const items: Item[] = await res.json();
        const latency = Math.round(performance.now() - t0);
        setReqCount((n) => n + 1);
        if (items.length) {
          setHits((n) => n + items.length);
          lastIdRef.current = items[items.length - 1].id;
          items.forEach((i) => push(`📥 [${latency}ms] #${i.id} ${i.message}`, 'good'));
        } else {
          push(`… empty (${latency}ms)`, 'muted');
        }
      } catch (e: any) {
        push(`error: ${e.message ?? e}`, 'bad');
      }
      if (!cancelled && running) setTimeout(tick, interval);
    }
    tick();
    return () => { cancelled = true; };
  }, [running, interval, push]);

  return (
    <div className="card">
      <h3>Short polling</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        One request every <code>{interval}</code> ms. Latency ≤ interval; wasted
        when nothing changed.
      </p>
      <div className="row" style={{ margin: '6px 0' }}>
        <button onClick={() => setRunning((r) => !r)}>
          {running ? 'Stop' : 'Start polling'}
        </button>
        <label>interval (ms)</label>
        <input
          type="number" min={250} step={250}
          value={interval}
          onChange={(e) => setInterval_(Number(e.target.value) || 2000)}
          style={{ width: 90 }}
        />
        <button className="secondary" onClick={clear}>Clear</button>
      </div>
      <div className="row">
        <div className="metric">requests <strong>{reqCount}</strong></div>
        <div className="metric">items received <strong>{hits}</strong></div>
        <div className="metric">
          waste %{' '}
          <strong>{reqCount === 0 ? 0 : Math.round(100 * (1 - hits / reqCount))}</strong>
        </div>
      </div>
      <Log />
    </div>
  );
}

// -----------------------------------------------------------------------------
// LONG POLLING — server holds request open until something arrives.
// -----------------------------------------------------------------------------
function LongPollPanel() {
  const { push, Log, clear } = useLog();
  const [running, setRunning] = useState(false);
  const lastIdRef = useRef(0);
  const [reqCount, setReqCount] = useState(0);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    if (!running) return;
    const ctl = new AbortController();
    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        const t0 = performance.now();
        try {
          push(`opening long-poll (afterId=${lastIdRef.current})`, 'muted');
          const res = await fetch(
            `/api/polling/long-poll?afterId=${lastIdRef.current}&timeoutSec=20`,
            { headers: authHeader(), signal: ctl.signal }
          );
          const items: Item[] = await res.json();
          const dt = Math.round(performance.now() - t0);
          setReqCount((n) => n + 1);
          if (items.length) {
            setHits((n) => n + items.length);
            lastIdRef.current = items[items.length - 1].id;
            items.forEach((i) =>
              push(`📥 [${dt}ms] #${i.id} ${i.message}`, 'good')
            );
          } else {
            push(`server held the connection ${dt}ms with no data (timeout)`, 'muted');
          }
        } catch (e: any) {
          if (cancelled) return;
          push(`error: ${e.message ?? e}`, 'bad');
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    loop();
    return () => { cancelled = true; ctl.abort(); };
  }, [running, push]);

  return (
    <div className="card">
      <h3>Long polling</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        Each request waits up to 20 s. Latency ≈ 0 ms when something happens;
        each round-trip still costs one HTTP request.
      </p>
      <div className="row" style={{ margin: '6px 0' }}>
        <button onClick={() => setRunning((r) => !r)}>
          {running ? 'Stop' : 'Start long-poll'}
        </button>
        <button className="secondary" onClick={clear}>Clear</button>
      </div>
      <div className="row">
        <div className="metric">requests <strong>{reqCount}</strong></div>
        <div className="metric">items received <strong>{hits}</strong></div>
      </div>
      <Log />
    </div>
  );
}
