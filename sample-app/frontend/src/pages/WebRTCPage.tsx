// =============================================================================
// pages/WebRTCPage.tsx — peer-to-peer demo (data channel + audio/video/screen)
// -----------------------------------------------------------------------------
// • Uses SignalR (chat hub) as the SIGNALING channel — see ChatHub.RelaySignal.
// • Establishes an RTCPeerConnection between two browser sessions of this
//   app (open two browsers / profiles, log in as different users).
// • Always opens an RTCDataChannel for text chat.
// • Optionally adds local camera, microphone, and/or screen-share tracks, and
//   renders the remote stream into a <video> element.
//
// Implementation notes:
//   • On hub connect we call `GetPeers` to learn about users already online —
//     `UserConnected` alone only fires for *future* arrivals.
//   • ICE candidates that arrive before `setRemoteDescription` are queued and
//     flushed once the remote description is applied (perfect-negotiation lite).
//   • Renegotiation (`onnegotiationneeded`) fires when media is added mid-call.
//     A "polite peer" tiebreaker (lexicographic connection-ID comparison)
//     resolves SDP offer/answer glare.
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
  const targetRef = useRef<string>('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const politeRef = useRef(false);

  const [hubState, setHubState] = useState<'idle' | 'on'>('idle');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [target, setTarget] = useState<string>('');
  const [pcState, setPcState] = useState<string>('—');
  const [dcState, setDcState] = useState<string>('—');
  const [chat, setChat] = useState<{ from: string; text: string }[]>([]);
  const [text, setText] = useState('hello peer!');
  const [bytes, setBytes] = useState({ in: 0, out: 0 });
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [hasRemoteMedia, setHasRemoteMedia] = useState(false);

  // Keep targetRef in sync so callbacks (which close over the initial value)
  // can read the current target without forcing a re-attach of handlers.
  useEffect(() => { targetRef.current = target; }, [target]);

  async function connectHub() {
    const hub = new HubConnectionBuilder()
      .withUrl('/hubs/chat', { accessTokenFactory: () => getToken() ?? '' })
      .withAutomaticReconnect()
      .build();

    hub.on('Welcome', (connId: string) => {
      myIdRef.current = connId;
      push(`my connection id: ${connId.slice(0, 6)}…`, 'muted');
    });
    hub.on('UserConnected', (user: string, connId: string) => {
      if (connId === myIdRef.current) return;
      setPeers((p) => (p.some((x) => x.id === connId) ? p : [...p, { id: connId, user }]));
      push(`peer joined: ${user}`, 'muted');
    });
    hub.on('UserDisconnected', (_user: string, connId: string) => {
      setPeers((p) => p.filter((x) => x.id !== connId));
      if (targetRef.current === connId) hangup('peer disconnected');
    });
    hub.on('WebRTCSignal', async (fromId: string, fromUser: string, payload: any) => {
      push(`signal from ${fromUser}: ${payload.type}`, 'muted');
      await handleSignal(fromId, payload);
    });

    await hub.start();
    hubRef.current = hub;
    setHubState('on');
    push('signaling hub connected', 'good');

    // Discover peers who were already online before we joined.
    try {
      const existing = (await hub.invoke<Peer[]>('GetPeers')) ?? [];
      setPeers((p) => {
        const seen = new Set(p.map((x) => x.id));
        return [...p, ...existing.filter((x) => !seen.has(x.id) && x.id !== myIdRef.current)];
      });
      if (existing.length) push(`discovered ${existing.length} existing peer(s)`, 'muted');
    } catch (e) {
      push(`GetPeers failed: ${String(e)}`, 'bad');
    }
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
      const t = targetRef.current;
      if (e.candidate && t && hubRef.current) {
        try {
          await hubRef.current.invoke('RelaySignal', t, {
            type: 'candidate', candidate: e.candidate.toJSON(),
          });
        } catch (err) {
          push(`relay candidate failed: ${String(err)}`, 'bad');
        }
      }
    };
    pc.ondatachannel = (e) => attachDataChannel(e.channel);

    // Render remote media as it arrives.
    pc.ontrack = (e) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      const stream = remoteStreamRef.current;
      // The event provides either e.streams[0] (preferred) or the individual track.
      if (e.streams && e.streams[0]) {
        e.streams[0].getTracks().forEach((t) => {
          if (!stream.getTracks().some((x) => x.id === t.id)) stream.addTrack(t);
        });
      } else if (!stream.getTracks().some((t) => t.id === e.track.id)) {
        stream.addTrack(e.track);
      }
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
      }
      setHasRemoteMedia(true);
      e.track.onended = () => {
        // Track ended on the remote side; drop it from our view.
        try { stream.removeTrack(e.track); } catch { /* ignore */ }
        if (stream.getTracks().length === 0) setHasRemoteMedia(false);
      };
      push(`remote ${e.track.kind} track received`, 'good');
    };

    // Renegotiation: fires when we add/remove tracks after the initial offer.
    pc.onnegotiationneeded = async () => {
      const t = targetRef.current;
      if (!t || !hubRef.current) return;
      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') return;
        await pc.setLocalDescription(offer);
        await hubRef.current.invoke('RelaySignal', t, {
          type: 'offer', sdp: pc.localDescription,
        });
        push('renegotiation offer sent', 'muted');
      } catch (err) {
        push(`negotiation error: ${String(err)}`, 'bad');
      } finally {
        makingOfferRef.current = false;
      }
    };

    return pc;
  }

  function attachDataChannel(dc: RTCDataChannel) {
    dcRef.current = dc;
    dc.onopen = () => { setDcState('open'); push('data channel open ✓', 'good'); };
    dc.onclose = () => { setDcState('closed'); push('data channel closed', 'muted'); };
    dc.onmessage = (e) => {
      const size = typeof e.data === 'string' ? e.data.length : (e.data as ArrayBuffer).byteLength;
      setBytes((b) => ({ ...b, in: b.in + size }));
      setChat((c) => [...c, { from: 'peer', text: String(e.data) }]);
    };
  }

  async function startCall() {
    if (!target) { push('select a peer first', 'bad'); return; }
    // The initiator is the "impolite" peer in our tiebreaker: it never yields
    // to a colliding remote offer.
    politeRef.current = (myIdRef.current ?? '') > target;
    const pc = ensurePC();
    if (!dcRef.current || dcRef.current.readyState === 'closed') {
      const dc = pc.createDataChannel('chat');
      attachDataChannel(dc);
    }
    try {
      makingOfferRef.current = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await hubRef.current!.invoke('RelaySignal', target, {
        type: 'offer', sdp: pc.localDescription,
      });
      push(`offer sent → ${target.slice(0, 6)}…`, 'muted');
    } catch (err) {
      push(`startCall error: ${String(err)}`, 'bad');
    } finally {
      makingOfferRef.current = false;
    }
  }

  async function handleSignal(fromId: string, payload: any) {
    const pc = ensurePC();
    // Lock onto the first peer that signals us if we haven't picked one yet.
    if (!targetRef.current) {
      setTarget(fromId);
      targetRef.current = fromId;
      // The receiver is "polite" relative to a higher-ID initiator.
      politeRef.current = (myIdRef.current ?? '') < fromId;
    }

    try {
      if (payload.type === 'offer') {
        const offerCollision =
          makingOfferRef.current || pc.signalingState !== 'stable';
        ignoreOfferRef.current = !politeRef.current && offerCollision;
        if (ignoreOfferRef.current) {
          push('glare: ignoring remote offer (impolite)', 'muted');
          return;
        }
        if (offerCollision) {
          // Polite peer: roll back local changes so we can accept their offer.
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' } as any).catch(() => undefined),
          ]);
        }
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await hubRef.current!.invoke('RelaySignal', fromId, {
          type: 'answer', sdp: pc.localDescription,
        });
        push('answer sent', 'muted');
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingCandidates();
        push('answer applied', 'muted');
      } else if (payload.type === 'candidate') {
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          // Remote description not yet applied — queue for later.
          pendingCandidatesRef.current.push(payload.candidate);
        } else {
          try { await pc.addIceCandidate(payload.candidate); }
          catch (err) {
            if (!ignoreOfferRef.current) push(`addIceCandidate: ${String(err)}`, 'bad');
          }
        }
      }
    } catch (err) {
      push(`signal error: ${String(err)}`, 'bad');
    }
  }

  async function flushPendingCandidates() {
    const pc = pcRef.current;
    if (!pc) return;
    const q = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const c of q) {
      try { await pc.addIceCandidate(c); }
      catch (err) { push(`flushed candidate failed: ${String(err)}`, 'bad'); }
    }
  }

  // ---- Media controls ----------------------------------------------------

  async function ensureLocalStream(): Promise<MediaStream> {
    if (!localStreamRef.current) {
      localStreamRef.current = new MediaStream();
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    }
    return localStreamRef.current;
  }

  async function addOrReplaceTrack(track: MediaStreamTrack) {
    const pc = ensurePC();
    const existing = pc.getSenders().find((s) => s.track?.kind === track.kind);
    if (existing) {
      await existing.replaceTrack(track);
    } else {
      pc.addTrack(track, await ensureLocalStream());
    }
  }

  function removeTrackOfKind(kind: 'audio' | 'video') {
    const pc = pcRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === kind);
    if (sender && sender.track) {
      sender.track.stop();
      // Replace with null so the remote `ontrack`/track.onended fires and the
      // peer connection renegotiates cleanly.
      sender.replaceTrack(null).catch(() => undefined);
    }
    const local = localStreamRef.current;
    if (local) {
      local.getTracks().filter((t) => t.kind === kind).forEach((t) => {
        t.stop();
        local.removeTrack(t);
      });
    }
  }

  async function toggleCamera() {
    if (camOn) {
      removeTrackOfKind('video');
      setCamOn(false);
      push('camera off', 'muted');
      return;
    }
    if (screenOn) {
      push('stop screen-share before enabling camera', 'bad');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const local = await ensureLocalStream();
      for (const t of stream.getTracks()) {
        local.addTrack(t);
        await addOrReplaceTrack(t);
        t.onended = () => { setCamOn(false); };
      }
      setCamOn(true);
      push('camera on', 'good');
    } catch (err) {
      push(`getUserMedia(video) failed: ${String(err)}`, 'bad');
    }
  }

  async function toggleMic() {
    if (micOn) {
      removeTrackOfKind('audio');
      setMicOn(false);
      push('mic off', 'muted');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const local = await ensureLocalStream();
      for (const t of stream.getTracks()) {
        local.addTrack(t);
        await addOrReplaceTrack(t);
        t.onended = () => { setMicOn(false); };
      }
      setMicOn(true);
      push('mic on', 'good');
    } catch (err) {
      push(`getUserMedia(audio) failed: ${String(err)}`, 'bad');
    }
  }

  async function toggleScreen() {
    if (screenOn) {
      // Stop screen tracks, then restore camera if it was on.
      const s = screenStreamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      removeTrackOfKind('video');
      setScreenOn(false);
      push('screen share off', 'muted');
      return;
    }
    if (camOn) {
      push('stop camera before sharing screen', 'bad');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: false,
      });
      screenStreamRef.current = stream;
      const local = await ensureLocalStream();
      for (const t of stream.getTracks()) {
        local.addTrack(t);
        await addOrReplaceTrack(t);
        t.onended = () => {
          // User clicked the browser's "Stop sharing" affordance.
          setScreenOn(false);
          screenStreamRef.current = null;
          const lc = localStreamRef.current;
          if (lc) lc.getTracks().filter((x) => x.kind === 'video').forEach((x) => lc.removeTrack(x));
        };
      }
      setScreenOn(true);
      push('screen share on', 'good');
    } catch (err) {
      push(`getDisplayMedia failed: ${String(err)}`, 'bad');
    }
  }

  function hangup(reason = 'hangup') {
    const pc = pcRef.current;
    if (pc) {
      pc.getSenders().forEach((s) => { try { s.track?.stop(); } catch { /* ignore */ } });
      try { pc.close(); } catch { /* ignore */ }
    }
    pcRef.current = null;
    dcRef.current = null;
    pendingCandidatesRef.current = [];
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setPcState('—'); setDcState('—');
    setCamOn(false); setMicOn(false); setScreenOn(false);
    setHasRemoteMedia(false);
    push(`call ended (${reason})`, 'muted');
  }

  useEffect(() => () => {
    hangup('unmount');
    hubRef.current?.stop();
  }, []);

  return (
    <>
      <h2>WebRTC — P2P data channel + media</h2>
      <p>
        SignalR is used as the <em>signaling</em> channel (SDP + ICE). The
        actual chat and media travel peer-to-peer over an{' '}
        <code>RTCPeerConnection</code>; the server never sees the payload.
        Open two browsers (or one normal window + one incognito) and log in as
        two different users to try it out.
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
        <button disabled={!target} onClick={startCall}>Start call</button>{' '}
        <button className="secondary" disabled={!pcRef.current} onClick={() => hangup()}>Hang up</button>
      </div>

      <div className="card">
        <h3>Media</h3>
        <div className="row">
          <button onClick={toggleCamera} disabled={!target}>
            {camOn ? 'Stop camera' : 'Start camera'}
          </button>
          <button onClick={toggleMic} disabled={!target}>
            {micOn ? 'Mute mic' : 'Start mic'}
          </button>
          <button onClick={toggleScreen} disabled={!target}>
            {screenOn ? 'Stop screen share' : 'Share screen'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Pick a peer first, then enable media. Tracks are added to the existing
          peer connection and trigger a renegotiation automatically.
        </p>
        <div className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>local</div>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: 280, height: 200, background: '#000', borderRadius: 6 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              remote {hasRemoteMedia ? '' : '(waiting…)'}
            </div>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: 280, height: 200, background: '#000', borderRadius: 6 }}
            />
          </div>
        </div>
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

  function send() {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    dcRef.current.send(text);
    setBytes((b) => ({ ...b, out: b.out + text.length }));
    setChat((c) => [...c, { from: 'me', text }]);
  }
}
