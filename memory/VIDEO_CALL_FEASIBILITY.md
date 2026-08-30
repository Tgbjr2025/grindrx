# Video calling — feasibility & what it would actually take

**Status: NOT implemented in v0.1.25. This is an honest assessment, not a shipped feature.**
Requested alongside the v0.1.25 batch ("the video chat needs added"). After auditing the
codebase we did not ship a video-call feature, because doing it properly requires
infrastructure that does not exist yet and cannot be faked responsibly (same principle we
applied to CAS-4001: we do not fake access to a server/paid capability).

## What exists today (nothing reusable for calling)
- **No WebRTC anywhere.** No `RTCPeerConnection`, `getUserMedia`, `MediaStream`, ICE, STUN or
  TURN in the frontend or the Rust backend.
- **A `VideoCall` message *type* exists but is inert** (`src/lib/model/message.ts`,
  `videoCallMessageSchema` with `body: z.unknown()`). It is only how the app would *display* a
  call-event artifact the Grindr server might emit; it does not place or receive a call. It
  currently renders as the generic "Video call" label via `UnsupportedMessage.svelte`.
- **The WebSocket (`src-tauri/src/api/ws.rs`, `wss://grindr.mobi/v1/ws`) is a chat/notification
  transport only.** It recognises `chat.v1.message_sent` and tap events. There is a generic
  `ws_send` passthrough (`src/lib/ws.svelte.ts` `ws.send()`, currently unused) but Grindr's
  server would not interpret arbitrary payloads as call signaling.
- **No camera/mic anything.** No `CAMERA`/`RECORD_AUDIO` Android permissions in the manifest, no
  camera/mic Tauri capability, and the CSP (`src-tauri/tauri.conf.json`) has no `connect-src`
  entries for STUN/TURN. Grindr's own servers do not broker WebRTC for third-party clients.

## What real 1:1 video calling requires (all of it is new)
1. **A signaling channel you control.** Two clients must exchange SDP offers/answers and ICE
   candidates. Options: (a) stand up a small signaling server (e.g. a WebSocket service on the
   OCI/OVH box) that both peers connect to, keyed by profileId; or (b) tunnel signaling over an
   existing channel — but Grindr's WS won't relay it, so this means (a) in practice.
2. **STUN + TURN servers.** STUN for NAT discovery (public STUN exists) and — critically — a
   **TURN relay** for the ~15-30% of mobile networks (CGNAT, symmetric NAT) where direct P2P
   fails. TURN is bandwidth-heavy and effectively must be self-hosted (coturn) or paid for.
3. **A WebRTC client in the WebView.** `getUserMedia` for camera+mic, `RTCPeerConnection`, track
   management, a call UI (incoming-call screen, in-call controls, mute/flip/hang-up), and
   call-state handling over the signaling channel.
4. **Native permissions + capabilities.** Android `CAMERA` and `RECORD_AUDIO` manifest
   permissions, runtime permission prompts, a Tauri capability grant, and CSP `connect-src`
   entries for the signaling + STUN/TURN origins. Android WebView also needs
   `onPermissionRequest` wired so `getUserMedia` is allowed.
5. **Discovery / presence.** A way to know the other user is online and reachable, plus
   push/notification to ring a backgrounded app.

## Rough shape of a first version (if the user wants to invest)
- Signaling: a WebSocket service on the OVH/OCI box (both already run services), auth'd with the
  app's existing session, rooms keyed by the two profileIds.
- Media: coturn on the same box for TURN; public STUN as a first hop.
- Client: a new `call/` route + a `WebRTCCall` store; reuse `ws_send`-style plumbing but pointed
  at the new signaling service, not Grindr's WS.
- This is a multi-day build plus ongoing TURN bandwidth cost, and needs on-device testing on two
  phones (the S26 + a second device) — it is not something to bolt on blind in one session.

## Recommendation
Treat video calling as its own project with the signaling + TURN infrastructure decided first.
Everything above the infrastructure line (the WebRTC client + UI) is straightforward once a
signaling server and a TURN relay exist. Ping back when you want to stand those up and we'll
scope the client build.
