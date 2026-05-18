// =============================================================================
// auth.ts — token storage + helpers
// -----------------------------------------------------------------------------
// We store the JWT in localStorage for class simplicity. Production code should
// consider an HTTP-only cookie set by the server to mitigate XSS.
// =============================================================================

const KEY = 'realtime-demo.jwt';
const USER_KEY = 'realtime-demo.user';

export type AuthInfo = { token: string; username: string; expiresAt: string };

export function saveAuth(a: AuthInfo) {
  localStorage.setItem(KEY, a.token);
  localStorage.setItem(USER_KEY, JSON.stringify({ username: a.username, expiresAt: a.expiresAt }));
}
export function clearAuth() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
}
export function getToken(): string | null {
  return localStorage.getItem(KEY);
}
export function getUser(): { username: string; expiresAt: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// `EventSource` cannot send custom headers (lecture §6.4). For SSE we put the
// token on the query string — discussed live with students.
export function buildSseUrl(url: string, params: Record<string, string | number> = {}): string {
  const u = new URL(url, location.href);
  const token = getToken();
  if (token) u.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

// Same constraint for raw WebSockets.
export function buildWsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(path, `${proto}//${location.host}`);
  const token = getToken();
  if (token) url.searchParams.set('access_token', token);
  return url.toString();
}
