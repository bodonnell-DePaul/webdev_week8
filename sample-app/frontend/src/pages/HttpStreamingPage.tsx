// =============================================================================
// pages/HttpStreamingPage.tsx — chunked NDJSON over a single POST
// -----------------------------------------------------------------------------
// Shows how an authenticated POST can stream chunks back — the model behind
// LLM "typing" UIs. We deliberately use the Streams API (fetch().body) to
// underscore the difference from `EventSource`.
// =============================================================================

import { useState } from 'react';
import { authHeader } from '../lib/auth';
import { useLog } from '../lib/useLog';

export default function HttpStreamingPage() {
  const { push, Log, clear } = useLog();
  const [text, setText] = useState('the quick brown fox jumps over the lazy dog');
  const [running, setRunning] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [firstByteMs, setFirstByteMs] = useState<number | null>(null);

  async function go() {
    setRunning(true);
    setChunkCount(0);
    setFirstByteMs(null);
    push('POST /api/streaming/echo', 'muted');

    const t0 = performance.now();
    try {
      const res = await fetch('/api/streaming/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ text }),
      });
      if (!res.body) {
        push('streaming not supported in this browser', 'bad');
        setRunning(false);
        return;
      }

      // Streams API → manual NDJSON parsing.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let first = true;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (first) {
          setFirstByteMs(Math.round(performance.now() - t0));
          first = false;
        }
        buffer += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.done) {
              push('✓ stream complete', 'good');
            } else {
              setChunkCount((n) => n + 1);
              push(`chunk #${obj.i}: "${obj.token}"`, 'info');
            }
          } catch {
            push(`unparseable line: ${line}`, 'bad');
          }
        }
      }
    } catch (e: any) {
      push(`error: ${e.message ?? e}`, 'bad');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h2>HTTP Streaming (NDJSON over POST)</h2>
      <p>
        One authenticated <code>POST</code>; body is delivered token-by-token.
        This is exactly how ChatGPT-style "typing" UIs work — and one of the
        few real-time techniques that lets the client send a body{' '}
        <em>and</em> stream a response.
      </p>

      <div className="card">
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={running} onClick={go}>
            {running ? 'streaming…' : 'Start stream'}
          </button>
          <button className="secondary" onClick={clear}>Clear log</button>
          <div className="metric">chunks <strong>{chunkCount}</strong></div>
          <div className="metric">
            TTFB <strong>{firstByteMs === null ? '—' : firstByteMs + 'ms'}</strong>
          </div>
        </div>
      </div>

      <Log />
    </>
  );
}
