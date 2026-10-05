#!/usr/bin/env bash
# GrindrX iOS device deploy: build -> sign -> install -> launch -> tail logs.
# Everything except the initial Apple ID sign-in is CLI. No AltStore, no GUI.
#
#   ./scripts/deploy-ios.sh [--debug] [--log-seconds N]
#
# Release by default, because that is what ships and what you want to verify:
# release is where FLAG_SECURE, the stripped console.log and the [DIAG] blocks
# behave differently. --debug uses `tauri ios dev` semantics (hot reload, needs
# the phone on the same LAN as this Mac).
#
# BLOCKING PREREQUISITE, once per session: the Xcode Apple ID session must be
# valid, or provisioning fails with
#   Unable to log in with account '<you>' / No profiles for '<bundle id>'
# Re-do it in Xcode > Settings > Accounts.
set -euo pipefail

PROFILE=release
LOG_SECONDS=45
while [ $# -gt 0 ]; do
  case "$1" in
    --debug) PROFILE=debug ;;
    --log-seconds) LOG_SECONDS="${2:?}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

log() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

TEAM="${APPLE_DEVELOPMENT_TEAM:-}"
[ -n "$TEAM" ] || die "set APPLE_DEVELOPMENT_TEAM to your 10-char team id"
command -v xcrun >/dev/null || die "macOS only"
command -v bun   >/dev/null || die "bun not on PATH"
security find-identity -v -p codesigning >/dev/null 2>&1 || die "no codesigning identity"

# UDID from the first physically attached device.
UDID="$(idevice_id -l | head -1)"
[ -n "$UDID" ] || die "no iOS device attached over USB"
BUNDLE_ID="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['identifier'])")"
log "target"
printf 'device  %s\nteam    %s\nbundle  %s\nprofile %s\n' "$UDID" "$TEAM" "$BUNDLE_ID" "$PROFILE"

APPLE_DEVELOPMENT_TEAM="$TEAM" bash scripts/build-ios.sh "$PROFILE" > /tmp/grindrx-deploy-build.log 2>&1 || {
  tail -40 /tmp/grindrx-deploy-build.log
  die "build failed - full log /tmp/grindrx-deploy-build.log"
}

APP="$(find "$HOME/Library/Developer/Xcode/DerivedData" -path "*${PROFILE}-iphoneos/GrindrX.app" -maxdepth 6 2>/dev/null | head -1)"
[ -n "$APP" ] || die "no ${PROFILE}-iphoneos/GrindrX.app produced"
log "built"
printf '%s\n' "$APP"
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "^ *Identifier|^ *TeamIdentifier|^ *Authority" | sed 's/^/  /'
codesign -dv "$APP" >/dev/null 2>&1 && { printf '  WARNING: release .app is unsigned\n'; }

log "uninstalling any previous copy (idempotent)"
xcrun devicectl device uninstall app --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true

log "installing"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tail -5

log "launching + streaming device log for ${LOG_SECONDS}s"
idevicesyslog -u "$UDID" > /tmp/grindrx-device.log 2>&1 &
LOGCAP=$!
trap 'kill $LOGCAP 2>/dev/null || true' EXIT
sleep 3
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1 | tail -4
sleep "$LOG_SECONDS"
kill $LOGCAP 2>/dev/null || true
trap - EXIT

log "app-side log lines"
if grep -q "RustStdoutStderr" /tmp/grindrx-device.log; then
  grep "RustStdoutStderr" /tmp/grindrx-device.log | tail -40
else
  echo "  (no RustStdoutStderr lines - is the app still running?)"
fi
echo
printf 'full device log: /tmp/grindrx-device.log\n'