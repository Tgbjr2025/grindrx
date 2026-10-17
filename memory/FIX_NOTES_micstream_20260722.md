# FIX_NOTES — M1 mic live-feed noise cleanup (2026-07-22)

Ship record per R10. This change lives on the **MacBook Air (aura-cam)**, not in this
build tree; these notes are the durable record of what shipped and how to roll back.

## Problem

The mic live feed (`/player` on port 8767) carried a loud broadband hiss. Measured
noise floor of the stream was **-21 dB** (a clean speech feed should sit under -60 dB).

Root cause: in `~/aura-cam/mic_capture.sh`, sox applied `noisered 0.25` (mild) and then
an aggressive upward compander (`compand … 6:-80,-42,…`) that lifted quiet passages by
up to ~38 dB — amplifying the residual noise floor almost to speech level. The capture
log also showed sustained clipping from the compand stage.

## Fix

`~/aura-cam/mic_capture.sh` rewritten (backup: `mic_capture.sh.bak.20260722T184944`):

- sox is now **capture-only** (it keeps the macOS TCC mic grant); all DSP moved to
  ffmpeg, in denoise-before-gain order:
  1. `highpass=f=80` — rumble removal
  2. `arnndn` (RNNoise, model `~/aura-cam/models/cb.rnnn`) — neural speech denoise
  3. `afftdn=nf=-40:tn=1` — adaptive FFT denoise, tracks the residual floor
  4. `dynaudnorm=f=250:g=11:m=8:p=0.85:t=0.01` — gentle upward leveling for quiet
     sounds; the `t` threshold stops it amplifying silence (what the old compand did)
  5. `alimiter=limit=0.891` — -1 dB safety ceiling
- New file: `~/aura-cam/models/cb.rnnn` (RNNoise "conjoined-burgers" voice model,
  from GregorR/rnnoise-models).
- `~/aura-cam/mic_stream.py` player caption corrected to "320kbps MP3 · 48kHz ·
  noise-suppressed (RNNoise)" (backup: `mic_stream.py.bak.20260722T*`).
- Restarted via `launchctl kickstart -k gui/$UID/com.aura.capture` and
  `…/com.aura.micstream`. TCC mic grant survived the restart.

Note: dynaudnorm lookahead adds ~1.5 s latency to the feed — acceptable for a monitor.

## Verification (measured on the stream end-to-end, via the OVH tunnel)

| Metric | Before | After |
|---|---|---|
| Noise floor (quiet room) | -21.3 dB | **-inf** (silence) |
| RMS (quiet room) | -26.7 dB | -88 dB |
| Speech test (`say` through speaker) | — | peak -3.5 dB, floor stays -inf |

Stream verified live: mp3, 48 kHz, stereo, 320 kbps; `/health` ok.

## Addendum (same day) — room-monitor retune

Operator needs **faint sounds to stay audible** — the first pass was too aggressive
(RNNoise at mix=1.0 eats non-speech transients; dynaudnorm t=0.01 left quiet sounds
unboosted). Retuned chain (backup: `mic_capture.sh.bak.20260722T*`, second timestamp):

- `arnndn … mix=0.5` — half blend: halves broadband hiss, keeps footsteps/doors/ambience
- `afftdn=nf=-45:nr=20:tn=1` — steady-hiss removal, preserves impulsive sounds
- `dynaudnorm=f=250:g=11:m=25:p=0.9:t=0.0015` — up to ~28 dB lift for faint sounds
- highpass relaxed 80 → 70 Hz

Verified by band analysis of the live stream (quiet room): >6 kHz at **-80 dB**
(was -40 dB — hiss is gone); remaining floor ~-35 dB is genuine low-frequency room
ambience (<300 Hz), deliberately audible. Do not "fix" that floor back to silence —
it is the point of the monitor.

## Addendum 1b (2026-07-23) — second cleanup pass (operator: "clean up the noise some more")

Chain tightened: highpass 70→90 Hz, arnndn mix 0.5→0.7, afftdn nr 20→28; dynaudnorm
unchanged. Measured live: constant ambience bed eliminated (floor -inf, RMS ≈ -72 dB,
was ≈ -47 dB); faint transients still register ~23 dB above residual (peak -49 dB over
a 20 s window). If the operator later reports faint sounds too quiet, first knob back
is mix 0.7→0.6.

**1c — operator did report faint sounds too quiet.** Final settled chain:
`highpass=f=75, arnndn mix=0.55, afftdn nf=-45:nr=22:tn=1,
dynaudnorm f=250:g=11:m=35:p=0.9:t=0.0008, alimiter 0.891`.
Measured: ambience bed audible at ≈-36 dB (intentional), >6 kHz ≈-74 dB (no hiss),
faint-event lift up to ~31 dB, LF body kept for footsteps/doors. This is the
operator-approved sensitivity/noise trade-off — don't tighten it again without asking. Also learned the hard way: Apple-silicon Macs hardware-disconnect the
internal mic when the lid closes — a zeroed stream with healthy processes means LID
CLOSED, not a dead pipeline.

## Addendum 2 (2026-07-23) — recorder + library/player on the OVH box

Operator asked for recording + a media player/library. Built standalone under
`/home/ubuntu/micarchive/` on the OVH box (deliberately NOT wired into mediakit —
its Opus/evidence-chain path stays untouched and dormant):

- `recorder.sh` — ffmpeg tees the live feed (tunnel `127.0.0.1:18767/stream`) into
  half-hour clock-aligned segments `archive/YYYY-MM-DDTHH-MM-SS.mp3`, re-encoded
  320k stereo → 64k mono (~700 MB/day). systemd `micarchive-recorder.service`,
  Restart=always (feed drop ⇒ new segment, no gap beyond the outage).
- `library_server.py` — stdlib-only web UI/API on **http://100.74.76.76:8768/library**
  (bound to the tailnet IP only; the box's public IP does NOT serve it). Endpoints:
  `/library` (player UI, date-grouped, REC badge, download), `/api/recordings`,
  `/rec/<name>` (Range/seek support), `/live` (proxy of the live feed), `/health`.
  systemd `micarchive-library.service`.
- `cleanup.sh` + `micarchive-cleanup.timer` — daily, deletes segments older than
  14 days (~10 GB steady state; disk had 64 GB free at install).

Verified live: first segment decodes (ffprobe 64 kbps, duration matches wall clock),
Range requests return 206, `/live` proxies the stream, `/health` reports
`recording_now=yes`. Ops: `systemctl {status,restart} micarchive-recorder
micarchive-library`; retention via `RETENTION_DAYS` env in cleanup.

## Rollback

```
ssh mac
cp ~/aura-cam/mic_capture.sh.bak.20260722T184944 ~/aura-cam/mic_capture.sh
launchctl kickstart -k gui/$(id -u)/com.aura.capture
```
