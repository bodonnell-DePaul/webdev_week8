// =============================================================================
// pages/WebRTCPage.tsx — peer-to-peer DataChannel demo
// -----------------------------------------------------------------------------
// • Uses SignalR (chat hub) as the SIGNALING channel — see ChatHub.RelaySignal.
// • Establishes an RTCPeerConnection between two open browser tabs of this
//   app, with a single STUN server.
// • Sends text + (optional) a small file over an RTCDataChannel — students see
//   that "WebRTC" is not only video, but also peer-to-peer arbitrary data.
//
// Caveats explicitly surfaced to students:
//   • STUN-only works on LAN; production needs TURN.
//   • Mesh topology breaks past a handful of peers (we only demo 1:1).
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { getToken } from '../lib/auth';
import { useLog } from '../lib/useLog';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

type Peer = { id: string; user: string };

export default function WebRTCPage() {
  const { push, Log, clear } = useLog();
  const hubRef = useRef<HubConnection | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const myIdRef = useRef<string | null>(null);

  const [hubState, setHubState] = useState<'idle' | 'on'>('idle');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [target, setTarget] = useState<string>('');
  const [pcState, setPcState] = useState<string>('—');
  const [dcState, setDcState] = useState<string>('—');
  const [chat, setChat] = useState<{ from: string; text: string }[]>([]);
  const [text, setText] = useState('hello peer!');
  const [bytes, setBytes] = useState({ in: 0, out: 0 });

  async function connectHub() {
    const hub = new HubConnectionBuilder()
      .withUrl('/hubs/chat', { accessTokenFactory: () => getToken() ?? '' })
      .withAutomaticReconnect()
      .build();

    hub.on('UserConnected', (user: string, connId: string) =>
      setPeers((p) => (p.some((x) => x.id === connId) ? p : [...p, { id: connId, user }]))
    );
    hub.on('UserDisconnected', (_user: string, connId: string) =>
      setPeers((p) => p.filter((x) => x.id !== connId))
    );
    hub.on('WebRTCSignal', async (fromId: string, fromUser: string, payload: any) => {
      push(`signal from ${fromUser}: ${payload.type}`, 'muted');
      await handleSignal(fromId, payload);
    });

    await hub.start();
    hubRef.current = hub;
    setHubState('on');
    push('signaling hub connected', 'good');
    // We don't expose connection ID directly; use a random tag for display
    // since RelaySignal uses the server-side ConnectionId anyway.
    myIdRef.current = 'self';
  }

  function ensurePC(): RTCPeerConnection {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      setPcState(pc.connectionState);
      push(`PC state → ${pc.connectionState}`,
           pc.connectionState === 'connected' ? 'good' : 'muted');
    };
    pc.onicecandidate = async (e) => {
      if (e.candidate && target && hubRef.current) {
        await hubRef.current.invoke('RelaySignal', target, {
          type: 'candidate', candidate: e.candidate.toJSON(),
        });
      }
    };
    pc.ondatachannel = (e) => attachDataChannel(e.channel);
    return pc;
  }

  function attachDataChannel(dc: RTCDataChannel) {
    dcRef.current = dc;
    dc.onopen = () => { setDcState('open'); push('data channel open ✓', 'good'); };
    dc.onclose = () => { setDcState('closed'); push('data channel closed', 'muted'); };
    dc.onmessage = (e) => {
      const size = typeof e.data === 'string' ? e.data.length : e.data.byteLength;
      setBytes((b) => ({ ...b, in: b.in + size }));
      setChat((c) => [...c, { from: 'peer', text: String(e.data) }]);
    };
  }

  async function startCall() {
    if (!target) { push('select a peer first', 'bad'); return; }
    const pc = ensurePC();
    const dc = pc.createDataChannel('chat');
    attachDataChannel(dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await hubRef.current!.invoke('RelaySignal', target, { type: 'offer', sdp: offer });
    push(`offer sent → ${target}`, 'muted');
  }

  async function handleSignal(fromId: string, payload: any) {
    const pc = ensurePC();
    setTarget(fromId);
    switch (payload.type) {
      case 'offer': {
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await hubRef.current!.invoke('RelaySignal', fromId, { type: 'answer', sdp: answer });
        push('answer sent', 'muted');
        break;
      }
      case 'answer':
        await pc.setRemoteDescription(payload.sdp);
        push('answer applied', 'muted');
        break;
      case 'candidate':
        try { await pc.addIceCandidate(payload.candidate); } catch (e) { push(String(e), 'bad'); }
        break;
    }
  }

  function send() {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    dcRef.current.send(text);
    setBytes((b) => ({ ...b, out: b.out + text.length }));
    setChat((c) => [...c, { from: 'me', text }]);
  }

  useEffect(() => () => {
    pcRef.current?.close();
    hubRef.current?.stop();
  }, []);

  return (
    <>
      <h2>WebRTC — P2P data channel</h2>
      <p>
        SignalR is used as the <em>signaling</em> channel (SDP + ICE). The
        actual chat travels peer-to-peer over an <code>RTCDataChannel</code>;
        the server never sees the messages.
      </p>

      <div className="banner">
        <b>Caveats (Lecture §9):</b> this demo uses STUN only — works on most LANs but a
        production deployment needs TURN. Mesh topology only scales to a few peers; a real
        multi-party app uses an SFU.
      </div>

      <div className="card">
        <div className="row">
          <button onClick={connectHub} disabled={hubState === 'on'}>
            {hubState === 'on' ? 'Signaling on' : 'Connect signaling (SignalR)'}
          </button>
          <div className="metric">peers visible <strong>{peers.length}</strong></div>
          <div className="metric">PC state <strong>{pcState}</strong></div>
          <div className="metric">DC state <strong>{dcState}</strong></div>
          <div className="metric">in <strong>{bytes.in} B</strong></div>
          <div className="metric">out <strong>{bytes.out} B</strong></div>
          <button className="secondary" onClick={clear}>Clear log</button>
        </div>
      </div>

      <div className="card">
        <h3>Pick a peer and call</h3>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— peers —</option>
          {peers.map((p) => (
            <option key={p.id} value={p.id}>{p.user} ({p.id.slice(0, 6)}…)</option>
          ))}
        </select>{' '}
        <button disabled={!target} onClick={startCall}>Start call</button>
      </div>

      <div className="card">
        <h3>P2P chat</h3>
        <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 13, marginBottom: 8 }}>
          {chat.map((c, i) => (
            <div key={i}><b>{c.from}:</b> {c.text}</div>
          ))}
        </div>
        <div className="row">
          <input value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
          <button disabled={dcState !== 'open'} onClick={send}>Send</button>
        </div>
      </div>

      <Log />
    </>
  );
}
