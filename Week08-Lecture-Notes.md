# Web Development — Week 8

## Real-Time Web Communication, Streaming & Progressive Web Apps
---

## Table of Contents

1. [Why "Real-Time" Matters](#1-why-real-time-matters)
2. [Communication Models — Pick Before You Code](#2-communication-models)
3. [The HTTP Request/Response Baseline](#3-the-http-baseline)
4. [HTTP Polling — Short Polling and Long Polling](#4-http-polling)
5. [HTTP Streaming (Fetch Streams / Chunked Responses)](#5-http-streaming)
6. [Server-Sent Events (SSE)](#6-server-sent-events-sse)
7. [WebSockets](#7-websockets)
8. [SignalR](#8-signalr)
9. [WebRTC (Media + Data Channels)](#9-webrtc)
10. [Service Workers — Programmable Network Proxy](#10-service-workers)
11. [Web Push Notifications](#11-web-push)
12. [Progressive Web Apps (PWA) & Offline Architecture](#12-progressive-web-apps-pwa)
13. [Adjacent Technologies You Should Recognize](#13-adjacent-technologies)
14. [How to Choose — Decision Framework](#14-decision-framework)
15. [Cross-Cutting Concerns: Scaling, Security, Observability](#15-cross-cutting-concerns)
16. [Lecture Recap & Studio Lab Preview](#16-recap)

---

## 1. Why Real-Time Matters

The web started as a *pull* medium: a browser asked, a server answered, the conversation ended. Modern users now expect software to behave like a living surface — chat windows that update mid-keystroke, dashboards that breathe, video that flows, AI assistants that "type" their answer token by token. Every one of those experiences is a deliberate choice of *who* pushes data, *when*, and *over what wire*.

In this lecture we map the landscape of how a browser and a server stay in touch over time. We focus on **concepts**, **architecture**, **capabilities**, and the **trade-offs** that decide which tool fits a given problem. There is no single "best" technology — there is only the right tool for the right shape of communication.

### What you will be able to answer by the end

- *"Should this feature use polling, SSE, WebSockets, SignalR, or WebRTC?"*
- *"What infrastructure does each of these need to run in production at scale?"*
- *"What does a PWA give me that a normal web app does not, and what does it cost?"*
- *"When my AI-generated code says `new WebSocket(...)`, what is actually happening on the network?"*

---

## 2. Communication Models

Before any specific technology, decide *how* information needs to flow. Five questions answer almost every "which tech?" debate:

1. **Direction** — server → client, client → server, both, or peer ↔ peer?
2. **Latency budget** — milliseconds, seconds, or "eventually"?
3. **Fan-out** — one-to-one, one-to-few, one-to-many, many-to-many?
4. **Reliability** — must every message arrive in order? May any be dropped?
5. **Lifecycle** — short request, persistent connection, or background even when the app is closed?

If you can answer those five, the technology chooses itself. Students who reach for an AI assistant and ask for "real-time chat" tend to get a WebSocket bolted onto everything. Decide the *model* first; the API comes second.

> A useful rule of thumb: **start at the simplest model that satisfies your latency budget, and only escalate when measurement says you must.** Plain HTTP + polling is good enough far more often than people assume.

---

## 3. The HTTP Baseline

Before we talk real-time, anchor yourself in classic HTTP:

- **Stateless, request-driven.** The client speaks first; the server responds and the connection (logically) ends.
- **Half-duplex per request.** Only one side talks at a time, only in response to the other.
- **Cache-friendly.** CDNs, proxies, and browsers can store responses.
- **Connection reuse exists** (HTTP keep-alive, HTTP/2 multiplexing, HTTP/3 over QUIC) but the *programming model* is still "ask → receive".

**Why this matters:** Every real-time technology in this lecture either (a) bends HTTP to simulate push, (b) negotiates an upgrade away from HTTP for a persistent channel, or (c) bypasses the server entirely. Knowing the baseline helps you see what each one is actually doing differently.

### Capabilities at a glance

| Capability | Plain HTTP |
| --- | --- |
| Server can push without being asked | ❌ |
| Bi-directional within one connection | ❌ |
| Works through every proxy/firewall | ✅ |
| Friendly to CDNs and caching | ✅ |
| Native binary support | ✅ (body) |
| Built-in reconnection | n/a |

### Use cases where plain HTTP is still the right answer

- CRUD APIs, REST resources, GraphQL queries/mutations.
- Anything the user explicitly *requests* — search results, file downloads, form submissions.
- Read-mostly content where update latency of seconds-to-minutes is fine.

---

## 4. HTTP Polling

**Polling** is the original way to fake server push: the client *keeps asking* "anything new?" on a timer.

### 4.1 Short Polling

The client sends a request every *N* seconds. The server answers immediately with whatever it has (often nothing).

**Architecture**

```
Client ──GET /updates──► Server ──[]──► Client
        (every 5s)
Client ──GET /updates──► Server ──[3 new items]──► Client
```

**Pros**

- Trivial to implement; works everywhere; no special infrastructure.
- Stateless on the server — load-balances and caches naturally.
- Easy to debug (just HTTP in the dev tools).

**Cons**

- Wasted requests when nothing changed (cost & battery on mobile).
- Latency ≈ poll interval. There is no "right now".
- Doesn't scale gracefully — N clients × frequency = constant load floor.

**Use cases**

- Background "is my batch job done yet?" checks.
- Low-frequency status displays (every 30 seconds is fine).
- Fallback for clients/networks that cannot hold a persistent connection.

### 4.2 Long Polling

The client makes a request; the server *holds the response open* until it has data (or a timeout). When the client receives the answer it immediately reconnects.

**Architecture**

```
Client ──GET /updates──► Server  (holds…holds…)
                          ↓ data arrives
                         answers
Client ◄────payload──── Server
Client ──GET /updates──► Server (reconnects immediately)
```

**Pros**

- Near-real-time delivery without inventing a new protocol.
- Survives any HTTP-friendly proxy, firewall, or corporate network.
- Each "tick" is still one HTTP request — easy to log, trace, and authenticate.

**Cons**

- Server has to *hold* many sockets open (looks like idle traffic).
- One message per round-trip: bursty data → many reconnect cycles.
- Reconnection windows can drop messages without careful ID tracking.

**Use cases**

- Mobile/legacy environments where WebSockets are blocked.
- The hidden fallback inside SignalR and other abstractions.
- Quick "good enough" real-time when adding WS infrastructure is overkill.

### 4.3 When polling is the *wrong* choice

- High-frequency updates (>1/sec) to many users — you will burn CPU and bandwidth.
- Truly bidirectional or low-latency chat-style traffic.
- IoT or game state — get a real persistent channel instead.

---

## 5. HTTP Streaming

Between polling and SSE there is a humble but powerful technique: **stream the body of one HTTP response**. The server sets `Transfer-Encoding: chunked` (HTTP/1.1) or just writes a long HTTP/2 stream, and the client reads it incrementally via the **Streams API** / `fetch().body.getReader()`.

This is exactly how most LLM "typing" UIs work today (OpenAI, Anthropic, Azure OpenAI, the GPT-style chat in your IDE) — they ship newline-delimited JSON chunks back over one POST. SSE is a *standardized framing* on top of this idea; raw HTTP streaming is the looser cousin.

### 5.1 Architecture

```
Client ──POST /chat──► Server
        ◄──chunk 1──── (token 1)
        ◄──chunk 2──── (token 2)
        ◄──chunk 3──── (token 3)
        ◄────────────  (end of stream)
```

- One HTTP response, body delivered incrementally.
- Any payload format you want (JSON lines, NDJSON, raw text, binary).
- The client uses `ReadableStream` / async iterators.

### 5.2 Pros

- Lets the **client POST a request** (with headers, body, auth) and *also* receive a stream back — SSE cannot do that with `EventSource`.
- No new protocol: ordinary HTTP, works through proxies, CDNs, and auth middleware.
- Binary-safe.
- Perfect match for LLM token streaming and large-result paging.

### 5.3 Cons

- No automatic reconnection (you write that yourself).
- No standard framing — you and your consumer must agree on a format.
- Buffering middleboxes can hold chunks back until "done" if not configured properly.
- One-way (server → client) within the same response, like SSE.

### 5.4 Use cases

- **AI / LLM token streaming** with an authenticated POST body.
- **Large result sets** delivered incrementally instead of all at once.
- **Server-driven render of progressive HTML** (a la React Server Components / streaming SSR).
- **File generation** progress that streams partial bytes.

> Treat HTTP streaming as the **substrate**. Reach for **SSE** when you want a standard event framing and built-in reconnection. Reach for **WebSockets** when the client also needs to *send* during the stream.

---

## 6. Server-Sent Events (SSE)

**Server-Sent Events** is a W3C/HTML5 standard for *one-way* server-to-client streaming over a single, long-lived HTTP response with content type `text/event-stream`. The browser exposes it through the `EventSource` API.

### 6.1 Architecture & how it works

```
Client ──GET /stream (Accept: text/event-stream)──► Server
              ↑                                       │
              │   data: {…}                           │
              │   data: {…}                           │
              │   event: update                       │
              │   data: {…}                           │
              └───────────────────────────────────────┘
                  (one persistent HTTP response)
```

- A single HTTP/1.1 (or HTTP/2 stream) connection stays open.
- Server writes UTF-8 text frames consisting of named fields: `data:`, `event:`, `id:`, `retry:`.
- The browser automatically reconnects on drop and resumes from `Last-Event-ID`.
- HTTP/2 multiplexing removes the historical "6 connections per origin" limit.

### 6.2 Capabilities

- **Server → client only.** The client cannot push back on the same channel.
- **Text/UTF-8 only** (binary must be base64-encoded).
- **Built-in retry & resume** — the browser handles it without code.
- **Friendly to HTTP infrastructure** — proxies, load balancers, WAFs, TLS termination, observability tools all work unchanged.
- **Lightweight** — small constant overhead per connection, no framing protocol of its own.

### 6.3 Pros

- Simplest persistent-channel technology to learn and operate.
- Just HTTP — no upgrade dance, no extra firewall rules.
- Automatic reconnection is a feature, not your problem.
- Excellent for streaming AI/LLM token responses (the entire ChatGPT/Claude/Copilot-style "typing" effect is SSE under the hood for many providers).
- Compresses well over HTTP/2 and HTTP/3.

### 6.4 Cons

- Unidirectional. Need to send anything back? Make a separate request.
- Text-only payloads.
- Long-lived connections consume server file descriptors and memory.
- Some intermediaries buffer responses — destroying "real time" — unless you configure them.
- **`EventSource` cannot set custom HTTP headers** (no `Authorization: Bearer …`). You're forced to either (a) use **cookie-based auth**, (b) put a short-lived token in the query string (then never log it), or (c) use a polyfill like `fetch-event-source` that wraps the protocol around `fetch()` so you *can* send headers.
- Not great when you need fine-grained connection control (binary frames, custom subprotocols, etc.).

### 6.5 Use cases

- **AI/LLM token streaming** ("typing" effect, code assistants, summarization).
- **Real-time dashboards** — stock tickers, sensor data, build pipelines, system metrics.
- **Live feeds** — sports scores, election results, news, comment streams.
- **Notification fan-out** — toast popups, "X has been updated" pings.
- **Log tailing** in DevOps dashboards.

### 6.6 When *not* to use SSE

- Chat (need client → server too).
- Multiplayer games (need symmetric low-latency).
- Anything that must carry binary data efficiently.

---

## 7. WebSockets

**WebSockets** (RFC 6455) are a *protocol-level* technology that upgrades a single HTTP connection into a full-duplex, persistent TCP channel. After the upgrade handshake, both ends can send framed messages — text or binary — at any time, with very low per-frame overhead.

### 7.1 Architecture & how it works

```
Client                                  Server
  │  HTTP/1.1 GET /ws                     │
  │  Upgrade: websocket  ───────────────► │
  │  Sec-WebSocket-Key: …                 │
  │                                       │
  │  ◄──── 101 Switching Protocols ───────│
  │                                       │
  │  ◄═══ framed messages (text/binary) ══│
  │  ═══ framed messages (text/binary) ══►│
  │             (full-duplex)             │
```

- After the 101 handshake, the socket no longer speaks HTTP.
- Both peers can send unsolicited messages.
- A simple framing protocol carries payloads with very low overhead (2–14 bytes/frame).
- TLS-wrapped variant is `wss://`.

### 7.2 Capabilities

- **True bidirectional, low-latency messaging.**
- **Text *or* binary payloads.**
- **Per-message compression** via the `permessage-deflate` extension.
- **Subprotocols** — agree on higher-level semantics (`json`, `graphql-ws`, `mqtt`, etc.).
- **Browser-native** — first-class `WebSocket` API everywhere.

### 7.3 Pros

- The lowest-overhead bidirectional channel widely available in browsers.
- Symmetrical: either side can initiate a message at any time.
- Predictable latency — no negotiation, no polling, no buffering.
- Excellent ecosystem (Node `ws`, ASP.NET Core, Spring, Go, Python `websockets`, etc.).

### 7.4 Cons

- **You own the lifecycle.** Reconnection, heartbeats, message acknowledgment, replay, ordering, and authentication after upgrade are all *your* responsibility unless a library helps.
- **Sticky sessions** typically required behind a load balancer because the connection lives on a single node.
- **Scaling needs a backplane** (Redis pub/sub, NATS, Kafka, Azure Web PubSub) to fan messages out across server nodes.
- **Proxy hostility.** Some corporate proxies strip the upgrade or aggressively idle-close — you need pings.
- **No HTTP semantics after upgrade.** Cache headers, conditional gets, CORS preflight don't apply once you're on the socket; you must design auth and authorization explicitly.

### 7.5 Use cases

- **Chat & collaboration** — Slack, Teams, Discord text channels.
- **Live collaborative editing** — Google Docs, Figma, Miro (often combined with CRDTs/OT).
- **Multiplayer games & real-time strategy** — low-latency state sync.
- **Trading & financial dashboards** — high-frequency market data.
- **IoT control plane** — bidirectional command/telemetry.
- **Live auctions, sports betting odds, real-time bidding.**

### 7.6 Common pitfalls

- Forgetting to send periodic pings → idle-cut by intermediaries.
- Putting authentication in the URL query string and then logging it.
- Letting a single node hold all connections — no graceful drain on deploy.
- Sending one giant message instead of streaming chunks.

---

## 8. SignalR

**SignalR** is Microsoft's high-level real-time library for ASP.NET Core. It is *not* a separate wire protocol. Instead, it **abstracts** the choice of transport (WebSockets → SSE → Long Polling) behind a **Hub** programming model. You write methods on a `Hub` class; clients call them by name; the server can call back into clients by name. It handles connection lifecycle, reconnection, group management, serialization (JSON or MessagePack), and offers a managed cloud variant (Azure SignalR Service).

### 8.1 Architecture & how it works

```
Client ──POST /chathub/negotiate──► Server
         ◄──{transports, connectionId, [redirect]}──
Client ──Upgrade chosen transport──► Hub
              ▲                       │
              │   strongly-typed       │
              │   method invocations   │
              ▼                       │
            Client ◄═══════════════► Hub
                                      │
                                  ┌───┴────┐
                                  │Backplane│ (Redis / Azure / SQL)
                                  └─────────┘
```

- **Negotiation step** discovers the best transport at runtime.
- **Hubs** are server-side classes; the framework auto-wires client proxies.
- **Groups** allow targeted broadcast (`Clients.Group("room42").SendAsync(...)`).
- **Backplane** distributes messages across hub server instances.
- **Azure SignalR Service** can replace your hub fleet with a managed, globally distributed broker.

### 8.2 Capabilities

- Bidirectional RPC-style messaging with automatic serialization.
- Transparent transport fallback for hostile networks.
- Built-in user/group/connection targeting.
- First-class auth integration with ASP.NET Core (JWT, cookies, claims).
- Server-side streams (large or infinite results streamed to a client).
- Client-side strongly typed proxies in C#, TypeScript, Java, Python.

### 8.3 Pros

- **Massive productivity win** vs. raw WebSockets when you're in .NET.
- Handles reconnection, heartbeats, fallback, and scale-out for you.
- Group & user targeting without writing your own registry.
- Plays nicely with ASP.NET Core middleware (auth, logging, exception filters).
- A clear managed-service upgrade path (Azure SignalR) when you outgrow self-hosting.

### 8.4 Cons

- Framework dependency — you're committing to the .NET / ASP.NET Core stack.
- A little overhead vs. raw WebSockets (JSON by default; switch to MessagePack for hot paths).
- The negotiation endpoint becomes a hotspot you must protect & cache.
- "Magic" can hide problems — silent fallback to long polling under a broken proxy looks fine until you look at metrics.
- Group churn at scale can saturate the backplane if abused.
- **SignalR does NOT escape the browser auth-header limitation.** When the chosen transport is WebSockets or SSE, the JS client passes the JWT as `?access_token=…` (via `accessTokenFactory`) — the same trade-off as raw WebSockets and `EventSource`. Make sure your reverse proxy and logs do not capture full URLs in production.

### 8.5 Use cases

- **Enterprise chat / collaboration apps** built on .NET.
- **Live dashboards** — operations, finance, support, telemetry consoles.
- **Real-time notifications** inside line-of-business applications.
- **Customer-support tools** with presence and typing indicators.
- **Online auctions, ticketing, and order flow** where rapid bidirectional updates matter.
- **AI streaming** to .NET clients (server can stream tokens via `IAsyncEnumerable`).

### 8.6 SignalR vs. raw WebSockets — when each wins

- **Choose SignalR** when you want productivity, .NET integration, automatic fallback, groups, presence, and a managed scale-out story.
- **Choose raw WebSockets** when you need wire-level control, lowest possible overhead, or you're outside the .NET ecosystem.

---

## 9. WebRTC

**WebRTC** (Web Real-Time Communication) is an open standard that allows browsers and native apps to establish **peer-to-peer**, low-latency channels for **audio**, **video**, and **arbitrary data** — without a plugin and without the server relaying media in the common case.

### 9.1 Architecture & how it works

WebRTC is three pillars plus a missing fourth:

1. **`MediaStream`** — capture mic, camera, screen.
2. **`RTCPeerConnection`** — negotiate codecs, NAT-traverse, transport encrypted media.
3. **`RTCDataChannel`** — bidirectional arbitrary data, ordered or unordered, reliable or unreliable.
4. **Signaling** — *not* part of WebRTC. You bring your own channel (commonly WebSockets, SignalR, or SSE) to exchange the initial SDP offer/answer and ICE candidates.

```
            ┌───────── Signaling Server ─────────┐
            │ (WebSocket / SignalR / HTTP)        │
   ┌────────┴─────────┐                ┌──────────┴────────┐
   │   Browser A      │   SDP offer    │     Browser B     │
   │                  ├───────────────►│                   │
   │                  │◄───SDP answer──┤                   │
   │                  │◄──ICE cand────►│                   │
   └──────────────────┘                └───────────────────┘
              │                                  │
              │  ICE / STUN / TURN negotiation   │
              │◄────────────────────────────────►│
              │                                  │
              │  Direct P2P (encrypted SRTP/DTLS)│
              │  Audio / Video / Data            │
              │◄════════════════════════════════►│
```

### 9.2 Supporting infrastructure

- **STUN** — discovers your public IP behind NAT. Free, lightweight.
- **TURN** — relays media when peers can't reach each other directly. Roughly **10–25% of real sessions** require TURN; corporate firewalls and symmetric NATs are the usual reason. TURN consumes real bandwidth and is the single largest cost driver of any P2P deployment.
- **SFU (Selective Forwarding Unit)** — server that receives each client's stream once and *forwards* (does not transcode) to others. Required beyond ~4–6 participants.
- **MCU (Multipoint Conferencing Unit)** — server that *mixes* and re-encodes streams; used for very large meetings/webinars.

> **Common student mistake:** demos work on the classroom LAN with only STUN configured, so students conclude "WebRTC is easy". Then it breaks for half the users on real networks. **You must plan for TURN.** Treat it as a non-negotiable production requirement, not an optimization.

### 9.3 Capabilities

- **Sub-100ms latency** for audio/video — the lowest of any browser tech.
- **Adaptive bitrate, simulcast, and SVC** built into the stack.
- **Mandatory encryption** (DTLS for data, SRTP for media).
- **Direct file/data transfer** between peers — no server storage required.
- **Screen sharing** (`getDisplayMedia`) and **virtual backgrounds / AI effects** (via Insertable Streams or canvas pipelines).
- **NAT traversal** that "just works" most of the time.

### 9.4 Pros

- The only browser-native technology designed for real-time A/V.
- Peer-to-peer saves bandwidth and reduces latency vs. server-relayed video.
- Strong security defaults (encryption is non-optional).
- Massive ecosystem: Google Meet, Discord, Microsoft Teams, Zoom (fallback), WhatsApp Web, Facebook Messenger, Jitsi, Twilio, Agora, Daily, 100ms, LiveKit.

### 9.5 Cons

- **Substantial complexity.** Signaling, ICE, codecs, simulcast, congestion control — there is a lot to know.
- **Infrastructure you must run or buy:** STUN, TURN, possibly SFU.
- **Doesn't scale by P2P alone** — mesh topology breaks past ~4–6 participants. You need an SFU.
- **Mobile devices throttle and burn battery** under sustained A/V.
- **Difficult observability** — peer-to-peer media is hard to inspect server-side.
- **Compliance challenges** — recording, archiving, lawful intercept require extra plumbing.

### 9.6 Use cases

- **Video conferencing** — Meet, Teams web, Jitsi, Whereby.
- **Voice calls in the browser** — Discord, WhatsApp Web.
- **Telehealth / telemedicine** — secure clinician-to-patient sessions.
- **Live customer support with video / screen share.**
- **Remote desktop & co-browsing.**
- **Multiplayer browser games** using `RTCDataChannel` for very low latency.
- **Peer-to-peer file transfer** and end-to-end-encrypted chat.
- **Live AI avatars / agent video** with sub-second response.

### 9.7 Don't forget Data Channels

Students hear "WebRTC" and think *video*. **`RTCDataChannel`** is the same P2P pipe carrying arbitrary application data — text, JSON, binary, files. It can be configured **ordered or unordered**, **reliable or unreliable**, just like UDP-with-options. That makes it ideal for:

- Low-latency multiplayer game state.
- Direct peer-to-peer file transfer (no server storage).
- E2E-encrypted chat where the server never sees plaintext.
- IoT control planes where peers are on the same private mesh.

### 9.8 Common pitfalls

- Trying to build a 25-person mesh — bandwidth explodes; deploy an SFU.
- Skimping on TURN — works on your laptop, fails on the corporate Wi-Fi.
- Ignoring codec compatibility (H.264 vs VP8 vs VP9 vs AV1 vs hardware acceleration).
- Putting personally-identifying data in SDP / ICE logs.

---

## 10. Service Workers

A **service worker** is a JavaScript file the browser runs *in its own background thread*, completely separate from any page. Once registered, it becomes a **programmable network proxy** sitting between your app and the network. It is the single most important primitive behind PWAs and Web Push — understand it first.

### 10.1 Architecture

```
                          ┌──────────────────────┐
        ┌────fetch()─────►│                      │
        │                 │   Service Worker     │──── network ────► Server
   Web Page               │  (background script) │
        ▲                 │   - Cache API        │◄── push ─────────  Push Service
        │  postMessage    │   - IndexedDB        │
        ▼                 │   - sync / fetch /   │
   Other Tab              │     push handlers    │
                          └──────────────────────┘
```

- Lives in a **separate origin-scoped global** with no DOM access.
- Receives lifecycle events: `install`, `activate`, `fetch`, `push`, `sync`, `notificationclick`.
- Has access to the **Cache API** (HTTP response storage) and **IndexedDB** (structured client-side database).
- Persists across page reloads, tab closes, and (with Web Push) full app closure.

### 10.2 Capabilities

- Intercept and reshape every network request from controlled pages.
- Serve responses **from cache** when offline, or pre-fetch eagerly.
- Receive **Web Push** messages while the app is closed (see §11).
- Run **Background Sync** to retry failed POSTs when connectivity returns.
- Run **Periodic Background Sync** (limited support) for scheduled refresh.
- Show notifications (`registration.showNotification`).

### 10.3 Caching strategies (pick one per resource type)

| Strategy | Behavior | Use for |
| --- | --- | --- |
| Cache-first | Try cache, fall back to network | Static assets (JS, CSS, images, fonts) |
| Network-first | Try network, fall back to cache | API responses where freshness matters |
| Stale-while-revalidate | Serve cache, refresh in background | Avatar, badge, feed thumbnails |
| Cache-only | Cache, never network | Truly immutable, offline-only resources |
| Network-only | Skip the service worker | Auth, payments, anything that must be live |

### 10.4 Pros

- Foundation for offline UX, push, and install-to-home-screen.
- Once registered, runs invisibly — no extra UI required.
- Massive performance wins on repeat visits via cache.
- Works on top of *any* backend — language-agnostic.

### 10.5 Cons & pitfalls

- **Cache invalidation is hard.** Forget to bump your version and users see a stale app for days.
- The **service-worker lifecycle** (install → waiting → active) confuses everyone the first time.
- A buggy SW can lock users out of new releases. *Always* support a "skip waiting + claim clients" escape hatch and a "kill switch" you can deploy.
- Only works over **HTTPS** (and `localhost` for development).
- Storage is **best-effort** — the browser can evict caches under pressure.

### 10.6 Use cases

- **Offline-capable apps** (notes, docs, news, field-service).
- **Performance acceleration** (cache-first asset serving).
- **Background push handling** (see §11).
- **Background retry queues** for unreliable mobile networks.

---

## 11. Web Push

**Web Push** lets a server deliver a notification to a user **even when the browser tab is closed**, by leveraging push services run by the browser vendor (Chrome ↔ FCM, Firefox ↔ Mozilla autopush, Edge ↔ Windows Notification Service, Safari ↔ Apple Push). It is **not** a real-time channel for application data — it is a **doorbell**.

### 11.1 Architecture

```
Server ──(HTTPS, VAPID-signed)──► Push Service (Google/Mozilla/Apple)
                                            │
                                            ▼
                                   User's browser (background)
                                            │
                                            ▼
                                  Service Worker `push` event
                                            │
                                            ▼
                                  showNotification() → user
```

- The browser registers a **subscription URL** with its push service.
- The server stores subscriptions and sends payloads to those URLs, signed with **VAPID** (Voluntary Application Server Identification).
- A **Service Worker** wakes up to handle the push event even with the page closed.
- The user grants explicit permission, per origin.

### 11.2 Capabilities

- Background delivery while the site is closed.
- Payload up to ~4KB (encrypted end-to-end between server and service worker).
- Works across desktop and most mobile browsers (iOS supported since 16.4 *only for installed PWAs*).
- Optional notification UI (`showNotification`) with actions, icons, and click-to-focus.

### 11.3 Pros

- Re-engages users without an app store.
- Reuses existing browser-vendor push infrastructure (you do not run your own push pipeline).
- Strong opt-in model — permission is per-origin and revocable.

### 11.4 Cons

- **Permission friction** — many users decline immediately. Ask in context, never on first load.
- **iOS support requires the user to install the PWA to the Home Screen first.**
- Not a real-time data channel — payloads are best-effort and small.
- Easy to abuse → users will mute or block; design notifications with care.
- Delivery is **not guaranteed** and not low-latency. Don't use Web Push to deliver application state.

### 11.5 Use cases

- Chat / mention notifications when the user isn't on the site.
- Calendar / meeting reminders.
- Order-status, shipping, ride-share updates.
- Time-sensitive alerts (price drops, breaking news, security warnings).

---

## 12. Progressive Web Apps (PWA)

A **Progressive Web App** is not a single technology — it's a *pattern* that combines:

- A **Web App Manifest** (`manifest.webmanifest`) — name, icons, theme, display mode.
- A **Service Worker** — programmable network proxy that lives in the background.
- **HTTPS** — non-negotiable.
- Responsive UI, install prompt, offline support, push, and background sync where supported.

The goal: make a web site feel like an installed app — launchable from the home screen, runnable offline, capable of background updates and notifications — without going through an app store.

### 12.1 Architecture

```
        Browser
   ┌──────────────────────┐
   │   Web App (React)    │◄───── manifest.webmanifest
   │          ▲           │
   │          │ fetch()    │
   │          ▼           │
   │  Service Worker      │◄───── push events
   │  (network proxy +    │       background sync
   │  cache + push)       │
   │          ▲           │
   │          │ Cache API │
   │          ▼           │
   │   On-device storage  │
   │  (Cache, IndexedDB)  │
   └──────────────────────┘
              │
              ▼
            Server
```

The service worker sits between the page and the network. It can serve from cache, fall through to network, sync in the background, and receive push messages.

### 12.2 Capabilities

- **Installable** to home screen / desktop, runs in its own window.
- **Offline mode** via Cache API and IndexedDB (with strategies: cache-first, network-first, stale-while-revalidate).
- **Background sync** — queue actions while offline, replay on reconnect (where supported).
- **Push notifications** (see §11).
- **Periodic background sync** (limited support).
- **Hardware access** — camera, mic, geolocation, Bluetooth, USB, NFC (varying support).
- **Single codebase, all platforms.**

### 12.3 Pros

- Zero install friction vs. native — no store gatekeeping, no signing certificates.
- One codebase, many platforms (web + iOS + Android + desktop).
- Automatic updates — no version sprawl.
- Cheaper than native development; great for MVPs and indie/startup teams.
- Discoverable via the open web (SEO, links).

### 12.4 Cons

- **iOS lags.** Some APIs (background sync, periodic sync, push pre-16.4) are limited.
- **Hardware access** is still narrower than native (no Bluetooth on iOS Safari, etc.).
- **Storage quotas** can be reclaimed by the browser when disk pressure rises.
- **Service worker debugging** is a learning curve — cached versions, registration scope, update lifecycle.
- **App store presence** still matters for discoverability in some segments.

### 12.5 Use cases

- News / media reading apps where offline-while-commuting matters.
- Field-service & logistics apps that work in poor connectivity.
- E-commerce mobile experiences (Twitter Lite, Pinterest, Starbucks, Uber).
- Internal tools where you don't want app-store friction.
- Productivity apps with cache-first behavior (notes, todo, time-tracking).

### 12.6 Common pitfalls

- Shipping a buggy service worker → users see a broken cached site for days.
- Not versioning your cache — old assets served alongside new ones.
- Overusing cache-first → stale data shown when the network would have been fine.
- Treating PWA as "I added a manifest and called it done" instead of designing for offline.

---

## 13. Adjacent Technologies

These don't all fit in one lecture, but you'll meet them in production and AI-generated code. Recognize the shape of each.

### 13.1 gRPC and gRPC-Web Streaming

Google's high-performance RPC framework over HTTP/2 with Protocol Buffers. Supports four call styles, including **server streaming**, **client streaming**, and **bidirectional streaming**. In the browser, **gRPC-Web** restricts you to unary + server streaming (no client streaming) until WebTransport becomes ubiquitous.

- **Best for:** strongly typed microservice-to-microservice traffic; mobile/native clients; high-throughput backends.
- **Less great for:** the open web (binary, harder to debug, requires a proxy like Envoy).

### 13.2 MQTT

A pub/sub messaging protocol designed for IoT devices on constrained networks. Tiny header, QoS levels (0/1/2), retained messages, last-will, broker-based topology.

- **Best for:** IoT telemetry, sensor fleets, home automation, vehicle data.
- **Reachable from the browser** via MQTT-over-WebSockets.

### 13.3 GraphQL Subscriptions

Pushes updates to a subscribed query result, typically over WebSockets (`graphql-ws`) or SSE. Pairs naturally with GraphQL queries and mutations.

- **Best for:** apps that already use GraphQL and want "live queries" without inventing a parallel channel.
- **Watch for:** N+1 subscription explosion and authorization complexity.

### 13.4 WebTransport

A newer browser API built on **HTTP/3 + QUIC** that offers reliable streams *and* unreliable datagrams, multiplexed over a single connection. Think "WebSockets done right for the next decade".

- **Best for:** real-time games, low-latency telemetry, future-proof apps.
- **Status (late 2025/early 2026):** Chrome/Edge/Firefox shipping; Safari catching up; libraries maturing.

### 13.5 Webhooks (server-to-server contrast)

Don't conflate browser real-time with **webhooks**. A webhook is just *"I will POST to your URL when an event happens."* It's server-to-server, fire-and-forget, with retries and signing. It is how Stripe, GitHub, Slack, Twilio, and most SaaS notify *your* server of changes — not how your browser stays in sync with users.

- **Pros:** dead simple; ordinary HTTP; provider keeps no socket open.
- **Cons:** requires your server to be reachable; you must verify signatures and handle replays.
- **Use cases:** payment events, CI pipelines, third-party integrations, "external system → my backend".

### 13.6 BroadcastChannel & Shared Workers (client-side coordination)

Sometimes the "real-time" problem is *between tabs* of the same user, not between user and server:

- **`BroadcastChannel`** — same-origin tabs publish/subscribe by string name. Great for "user logged out in one tab, log out everywhere".
- **`SharedWorker`** — a single script shared by all tabs of an origin. Useful for a one-socket-many-tabs pattern.
- **Web Worker** — background thread for CPU-bound work (not network, but real-time UX).

### 13.7 HTTP/2 Server Push — *deprecated, do not use*

For a few years HTTP/2 had a "push promise" feature that let the server preemptively send resources. **Chrome removed support in 2022.** It is no longer a viable mechanism. If you see AI-generated code or older blog posts reaching for it, replace it with HTTP streaming, SSE, or `<link rel="preload">`.

### 13.8 Background Sync, Periodic Sync

Smaller browser primitives that complement PWAs:

- **Background Sync** — retry failed POSTs once back online.
- **Periodic Background Sync** — wake up periodically to refresh.
- **BroadcastChannel** — same-origin tabs talking to each other.
- **Shared Worker / Service Worker** — single background script across tabs.

### 13.9 Push services beyond Web Push

For native mobile installed apps you'll still meet **APNs** (Apple), **FCM** (Google), **WNS** (Windows). PWAs largely shield you from these directly via Web Push.

---

## 14. Decision Framework

A practical, narrow-to-broad decision tree for picking a technology:

1. **Does anything need to be real-time?**
   - *No* → REST/HTTP. Stop.
2. **Is the data flow server-to-client only?**
   - *Yes, low frequency* → polling.
   - *Yes, high frequency or streaming* → **SSE**.
3. **Do clients need to send messages too?**
   - *Yes, .NET shop, want productivity* → **SignalR**.
   - *Yes, want wire-level control or non-.NET stack* → **WebSockets**.
4. **Is it audio / video / sub-100ms data between users?**
   - **WebRTC** (with WS/SignalR for signaling).
5. **Do we need to reach users while the app is closed?**
   - **Web Push + Service Worker**.
6. **Do we want home-screen install + offline?**
   - **PWA** (manifest + service worker, on top of any of the above).
7. **IoT / device fleet?** → **MQTT** (often over WebSockets).
8. **Already on GraphQL?** → **GraphQL Subscriptions** for live data.
9. **Greenfield, future-looking, gaming/telemetry?** → Evaluate **WebTransport**.

### Comparison cheat sheet

| Technology | Direction | Protocol | Best Sweet Spot | Worst Sweet Spot |
| --- | --- | --- | --- | --- |
| Short Polling | C ↔ S | HTTP | "Is job done?" | High-frequency anything |
| Long Polling | C ↔ S | HTTP | Hostile networks fallback | Bursty data |
| HTTP Streaming | S → C (one POST) | HTTP | LLM token streams | Anything needing reconnect |
| SSE | S → C | HTTP | Dashboards, notifications, feeds | Chat, games |
| WebSockets | C ↔ S | TCP upgrade | Chat, collab, games | Audio/video |
| SignalR | C ↔ S | WS / SSE / LP | Real-time on .NET, with groups | Non-.NET shops |
| WebRTC | P ↔ P | UDP (SRTP/SCTP) | A/V, P2P data | Notifications, simple updates |
| Service Worker | n/a | n/a | Offline, caching, background | Anything you need on first load |
| Web Push | S → C | HTTPS via vendor | Background notifications | Bulk data delivery |
| PWA pattern | n/a | n/a | Installable, offline-capable web app | Heavy native-only features |

---

## 15. Cross-Cutting Concerns

Every real-time technology brings the same family of operational concerns. Address them up front.

### 15.1 Scaling

- **Sticky sessions** for stateful connections (WebSockets, SignalR fallbacks).
- **Backplanes** (Redis, NATS, Kafka, Azure Web PubSub / SignalR Service) to fan messages across nodes.
- **Region locality** — connect users to the nearest cluster; replicate only what truly must be global.
- **Connection per resource ratio** — track memory per connection (typically 1–8 KB) and CPU per broadcast.
- **Backpressure** — slow consumers must never stall the whole node.

### 15.2 Security

- **TLS everywhere** (`wss://`, `https://`) — non-negotiable.
- **JWT or session cookies** validated at connection establishment, then again on every privileged call.
- **Rate limiting** at the edge and per connection.
- **Input validation & size limits** on every frame.
- **Don't log PII** — connection metadata is fine; payloads are not.
- **CORS** for SSE/HTTP endpoints; explicit origin allow-lists for sockets.

### 15.3 Observability

- **Connection counts** per node and per shard.
- **Message latency p50/p95/p99** (publish → delivery).
- **Reconnect rate** — spikes indicate deploys, network issues, or bugs.
- **Fanout amplification** — recipients per message.
- **Transport mix** for SignalR — silent fallback to long polling is a smell.
- **Per-technology custom telemetry** (in this lecture's lab we use Application Insights).

### 15.4 Cost

- **Egress bytes** dominate at scale (especially WebRTC TURN and WebSocket broadcasts).
- **Idle connections** are not free — memory and FDs cost money in big numbers.
- **Managed services** (Azure SignalR / Web PubSub, LiveKit Cloud, Twilio) trade dollars for engineering time.

