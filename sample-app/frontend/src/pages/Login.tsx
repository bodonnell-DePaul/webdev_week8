// =============================================================================
// pages/Login.tsx — register OR login with basic-auth-style credentials → JWT
// =============================================================================
import { useState } from 'react';
import { saveAuth, AuthInfo } from '../lib/auth';

export default function Login({ onAuthed }: { onAuthed: (a: AuthInfo) => void }) {
  const [username, setU] = useState('alice');
  const [password, setP] = useState('password');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const url = `/api/auth/${mode}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: AuthInfo = await res.json();
      saveAuth(data);
      onAuthed(data);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 460 }}>
      <h3>{mode === 'login' ? 'Sign in' : 'Create account'}</h3>
      <form onSubmit={submit}>
        <div className="row" style={{ margin: '8px 0' }}>
          <label style={{ width: 80 }}>Username</label>
          <input value={username} onChange={(e) => setU(e.target.value)} required />
        </div>
        <div className="row" style={{ margin: '8px 0' }}>
          <label style={{ width: 80 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} required minLength={4} />
        </div>
        {err && <div className="banner bad">{err}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy} type="submit">
            {busy ? '…' : mode === 'login' ? 'Sign in' : 'Register'}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Need an account?' : 'Already have one?'}
          </button>
        </div>
      </form>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 16 }}>
        Defaults are populated for class convenience. After login the JWT lives in
        <code>localStorage</code>; every demo page picks it up automatically.
      </p>
    </div>
  );
}
