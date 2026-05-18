# Realtime Demo — Week 8 sample application

A reference React + ASP.NET Core (.NET 10) application that demonstrates **every real-time web technology covered in the Week 8 lecture, side by side**, with each tech on its own page and instrumented with **Application Insights**-tagged telemetry.

| Page          | Technology                       | Lecture section |
| ------------- | -------------------------------- | --------------- |
| `/polling`    | HTTP short polling + long polling | §4              |
| `/streaming`  | HTTP streaming (NDJSON over POST) | §5              |
| `/sse`        | Server-Sent Events                | §6              |
| `/websocket`  | Raw WebSocket                     | §7              |
| `/signalr`    | SignalR (chat hub)                | §8              |
| `/webrtc`     | WebRTC (P2P data channel)         | §9              |
| `/push`       | Web Push (VAPID)                  | §11             |
| `/pwa`        | PWA install + offline             | §12             |
| `/compare`    | Telemetry summary across all techs | n/a            |

---

## Prerequisites

- **.NET 10 SDK** (`10.0.300` or later) — `dotnet --version` should print `10.x`.
- **Node.js 20+** with npm.

> A `global.json` in this directory pins the .NET SDK version so all students use the same toolchain.

## Run the backend

```powershell
cd backend\RealtimeDemo.Api
dotnet restore
dotnet run --no-launch-profile --urls "http://127.0.0.1:5080"
```

The first run creates the SQLite database (`realtimedemo.db`) and a development VAPID key-pair (`vapid.json`). Both are written next to the project file.

To enable live Application Insights telemetry, set the connection string in `appsettings.json` or as an environment variable:

```powershell
$env:ApplicationInsights__ConnectionString = "InstrumentationKey=...;IngestionEndpoint=..."
```

Without a connection string the SDK is registered passively, telemetry stays in the local SQLite mirror, and the `Compare` page still works.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The Vite dev server proxies `/api`, `/hubs`, and `/ws` to the backend.

For an installable production build:

```powershell
npm run build
npm run preview
```

## Default credentials

The login form pre-fills `alice / password`. Use the *Register* button on first run.

## Known-good environment

| Component  | Tested version       | Notes                                                                    |
| ---------- | -------------------- | ------------------------------------------------------------------------ |
| .NET SDK   | 10.0.300             | Pinned via `global.json` in the lecture root.                            |
| Node.js    | 20+ (tested on 24.3) | `package.json` lists matching engines.                                   |
| npm        | 10+                  | Bundled with Node.                                                       |
| Browser    | Chrome / Edge 120+   | Firefox 120+ and Safari 17+ also work but Web Push on iOS needs an installed PWA. |
| OS         | Windows / macOS / Linux | Backend uses SQLite, no native dependencies.                          |

Run everything on `localhost` for development — service workers, Web Push, and WebRTC all relax their HTTPS requirement on `localhost`. **Production must be HTTPS.**

## Troubleshooting checklist

| Symptom | First thing to check |
| --- | --- |
| Page shows a stale UI after a code change | Service worker is serving cached files — DevTools → Application → Service Workers → Unregister, then reload. The `/pwa` page has an *Unregister SW* button as a kill switch. |
| Push notifications never appear | Permission denied, HTTPS missing, VAPID keys not configured, or the OS notification center is muted. The `/push` page prints permission state and the server endpoint response. |
| WebRTC stays in `connecting` forever | This sample uses **STUN only**. On most LANs it works; behind a restrictive NAT you must add a TURN server. Try both peers in the same browser first to confirm the data-channel logic. |
| SignalR is using *Long Polling* in dev tools | A proxy / firewall is blocking WebSocket upgrade. Confirm Vite's `ws: true` proxy is forwarding to the backend (check `vite.config.ts`). |
| `?access_token=…` shows up in logs | **Stop and redact.** SSE / WebSocket / SignalR-on-WS all rely on the token query parameter because the browser can't set headers; production proxies and observability pipelines must strip it. |
| `dotnet run` complains about SDK version | Confirm `dotnet --version` prints `10.0.300+`. The `global.json` two levels up pins this. |
| Vite dev server cannot connect to backend | Backend must be on `http://127.0.0.1:5080` (the proxy target). Verify with `curl http://127.0.0.1:5080/api/health`. |

## End-to-end smoke tests

`e2e-test.mjs` exercises every backend endpoint (REST, polling, long polling, HTTP streaming, SSE, raw WebSocket, SignalR negotiate, Web Push VAPID, telemetry summary). `e2e-signalr.mjs` covers the SignalR hub via the official client.

```powershell
# with the backend running on http://127.0.0.1:5080
node e2e-test.mjs
node e2e-signalr.mjs
```

Both scripts print a green ✓ for each technology.

## Architecture quick-reference

```
┌────────────────────────┐                ┌─────────────────────────────┐
│   React + Vite + TS    │                │  ASP.NET Core (.NET 10)     │
│   (frontend, :5173)    │                │  RealtimeDemo.Api (:5080)   │
│                        │                │                             │
│  • Pages per tech      │   /api/*       │  • Controllers              │
│  • vite-plugin-pwa     │ ─────────────► │      Auth, Polling, SSE,    │
│  • SignalR client      │   /hubs/*      │      HttpStreaming, Push,   │
│  • EventSource         │ ─────────────► │      Telemetry              │
│  • WebSocket           │   /ws/*        │  • SignalR hub: ChatHub     │
│  • PushManager         │ ─────────────► │  • Raw WS: EchoWS           │
│  • Service Worker      │                │                             │
│                        │                │  • EF Core + SQLite         │
│                        │                │  • JWT bearer auth          │
│                        │                │  • Application Insights     │
└────────────────────────┘                │    TelemetryService         │
                                          └─────────────────────────────┘
```

## Things to point out in class

1. **Auth differences across transports.** REST and SignalR's *negotiate* call use `Authorization: Bearer …`; **SSE and raw WebSocket cannot** because the browser APIs don't allow custom headers. **SignalR is not magic here either** — when its chosen transport is WebSockets or SSE the JS client uses `accessTokenFactory` to pass the JWT via `?access_token=…`. The frontend therefore passes `?access_token=…` on those endpoints and a banner on each page explains the trade-off. **Never log full URLs in production**: redact the `access_token` query parameter at every proxy and observability layer.
2. **Same data, different delivery.** Polling, long polling, and SSE all read from the same `PollItems` table. Producing one item via the polling page is visible on the SSE page too.
3. **Transport negotiation.** Open DevTools → Network → WS while the SignalR page is connected. You'll see the negotiation request, then the WebSocket. Disable WebSockets in Chrome flags and watch SignalR fall back to SSE then long-polling.
4. **WebRTC TURN caveat.** The demo uses only STUN. On a LAN it works; behind a restrictive NAT it would need TURN. We deliberately don't ship a TURN server so students hit this in their lab.
5. **Service-worker lifecycle.** Reload the page after a code change and watch DevTools → Application → Service Workers for the `installing → waiting → active` flow. The `Unregister SW` button on `/pwa` is the kill switch.
6. **Telemetry per technology.** Every demo's events are tagged with `technology=<SSE|WebSocket|SignalR|…>`. In App Insights you can chart "events by technology" with no extra setup. The same rows are visible locally on the `Compare` page.

## Project layout

```
backend/
  RealtimeDemo.Api/
    Program.cs                     # composition root: CORS, auth, AI, DI
    appsettings.json
    Auth/                          # PBKDF2 password hasher
    Controllers/
      AuthController.cs            # register, login → JWT
      PollingController.cs         # short + long + produce
      HttpStreamingController.cs   # NDJSON streaming over POST
      SseController.cs             # text/event-stream
      PushController.cs            # VAPID public key, subscribe, send
      TelemetryController.cs       # summary / recent
    Data/AppDbContext.cs           # EF Core context
    Models/Entities.cs             # User, ChatMessage, PollItem, …
    Hubs/ChatHub.cs                # SignalR hub + WebRTC signaling relay
    EchoWebSocketHandler.cs        # raw WebSocket echo + tick
    Telemetry/TelemetryService.cs  # App Insights + SQLite mirror
frontend/
  src/
    main.tsx                       # React entry + SW registration
    App.tsx                        # nav + router
    sw.ts                          # service worker (injectManifest)
    lib/
      auth.ts                      # token storage + buildSseUrl / buildWsUrl
      useLog.tsx                   # tiny log hook used by every page
    pages/
      Home.tsx, Login.tsx
      PollingPage.tsx, HttpStreamingPage.tsx
      SsePage.tsx, WebSocketPage.tsx, SignalRPage.tsx
      WebRTCPage.tsx
      PushPage.tsx, PwaPage.tsx
      ComparePage.tsx
  index.html, vite.config.ts, tsconfig.json, package.json
e2e-test.mjs       # node smoke test of REST/SSE/WS/HTTP-stream/Push/Polling
e2e-signalr.mjs    # node smoke test of the SignalR hub
global.json        # pins .NET SDK
```
