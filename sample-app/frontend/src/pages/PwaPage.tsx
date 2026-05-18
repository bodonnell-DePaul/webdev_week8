// =============================================================================
// pages/PwaPage.tsx — install + offline state
// =============================================================================
import { useEffect, useState } from 'react';
import { useLog } from '../lib/useLog';

// `BeforeInstallPromptEvent` isn't in lib.dom; we type it loosely.
type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function PwaPage() {
  const { push, Log, clear } = useLog();
  const [installEvent, setInstallEvent] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [swStatus, setSwStatus] = useState<string>('checking…');

  useEffect(() => {
    function onBIP(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BIPEvent);
      push('install prompt available', 'good');
    }
    function onInstalled() {
      setInstalled(true);
      push('app installed ✓', 'good');
    }
    function onOnline()  { setOnline(true);  push('back online', 'good');  }
    function onOffline() { setOnline(false); push('offline', 'bad'); }

    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    (async () => {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) setSwStatus(`active (scope: ${reg.scope})`);
        else if (reg?.installing) setSwStatus('installing…');
        else if (reg?.waiting) setSwStatus('waiting (refresh to activate)');
        else setSwStatus('not registered');
      } else {
        setSwStatus('not supported');
      }
    })();

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [push]);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const r = await installEvent.userChoice;
    push(`install: ${r.outcome}`, r.outcome === 'accepted' ? 'good' : 'muted');
    setInstallEvent(null);
  }

  async function clearCaches() {
    if (!('caches' in window)) return;
    const names = await caches.keys();
    for (const n of names) await caches.delete(n);
    push(`cleared ${names.length} caches`, 'muted');
  }

  async function unregisterSW() {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    push(`unregistered ${regs.length} service worker(s) — reload to re-register`, 'muted');
  }

  return (
    <>
      <h2>Progressive Web App</h2>
      <p>
        The browser already registered a service worker on first load
        (look in DevTools → Application → Service Workers). That's what makes
        this app installable and runnable offline.
      </p>

      <div className="card">
        <div className="row">
          <div className="metric">online <strong>{online ? '✓' : '✗'}</strong></div>
          <div className="metric">installed <strong>{installed ? '✓' : '—'}</strong></div>
          <div className="metric">SW <strong>{swStatus}</strong></div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={install} disabled={!installEvent || installed}>
            {installed ? 'Already installed' : installEvent ? 'Install app' : 'Install prompt not ready'}
          </button>
          <button className="secondary" onClick={clearCaches}>Clear caches</button>
          <button className="secondary" onClick={unregisterSW}>Unregister SW</button>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Test offline</h3>
        <ol>
          <li>Open DevTools → <em>Network</em> → set <em>Throttling</em> to <strong>Offline</strong>.</li>
          <li>Reload this page. The cached shell should still render.</li>
          <li>Watch the metric flip to <code>online ✗</code>.</li>
        </ol>
      </div>

      <Log />
    </>
  );
}
