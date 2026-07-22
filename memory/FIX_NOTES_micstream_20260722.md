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

## Rollback

```
ssh mac
cp ~/aura-cam/mic_capture.sh.bak.20260722T184944 ~/aura-cam/mic_capture.sh
launchctl kickstart -k gui/$(id -u)/com.aura.capture
```
