#!/usr/bin/env bash
# GrindrX iOS build. macOS + Xcode only.
#
# Two modes, because they need different signing settings:
#
#   ./scripts/build-ios.sh unsigned-ipa
#       Signing OFF. Produces an UNSIGNED .ipa for AltStore/SideStore, which
#       signs it on-device with the user's own certificate. No Apple account,
#       no team, no provisioning profile, no Xcode login required.
#       This is the free distribution path. CFBundleVersion is forced numeric
#       because Apple rejects the semver string Tauri derives from `version`.
#
#   ./scripts/build-ios.sh device
#       Signs with Apple DEVELOPMENT TEAM from $APPLE_DEVELOPMENT_TEAM.
#       Produces a signed .app that `tauri ios dev` installs onto a connected
#       iPhone. Requires the Apple ID session in Xcode to be valid
#       (Xcode > Settings > Accounts) or this fails with
#       "The login details for account ... were rejected".
#
# Why this script exists rather than plain `bun tauri ios build`:
#   1. That command always ends at an xcodebuild *export* step which demands
#      `teamID`, so it cannot produce the unsigned .ipa AltStore needs. We
#      build, then package the .app into Payload/ ourselves.
#   2. Tauri writes CODE_SIGN_IDENTITY "-" and DEVELOPMENT_TEAM "" into
#      gen/apple/project.yml. `tauri ios init` PRESERVES edits to that file, so
#      this script patches it per mode instead of fighting the generator.
#   3. gen/apple/Externals/<arch>/<config>/libapp.a is picked up as a *resource*
#      because project.yml lists Externals as a source. After switching config,
#      the stale .a from the previous config duplicates an output and the build
#      dies with "duplicate output file". Clean the other config's .a first.
set -euo pipefail

MODE="${1:-unsigned-ipa}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$ROOT/src-tauri/gen/apple"
PROJECT="$GEN/project.yml"
cd "$ROOT"

log() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# bun, cargo and Homebrew are all installed but OFF the non-interactive SSH PATH
# on the M1. Put them on before probing, not after.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

case "$(uname -s)" in
  Darwin) ;;
  *) die "iOS builds need macOS + Xcode. This is $(uname -s)." ;;
esac
command -v xcodebuild >/dev/null || die "xcodebuild not found"
command -v bun       >/dev/null || die "bun not on PATH"

log "prerequisites"
# NOTE: never pipe into an early-exiting consumer (`head`, `grep -q`) under
# `set -o pipefail`. The consumer closes the pipe, the producer dies on SIGPIPE,
# and the script exits silently with no message. Read into a variable instead.
XCODE_VER="$(xcodebuild -version 2>&1 | sed -n '1p')"
printf '%s\n' "$XCODE_VER"
printf 'bun %s\n' "$(bun --version)"

# CFBundleVersion must be 1-3 dot-separated integers. Tauri derives it from
# `version` ("0.1.48") which Apple rejects at install; tauri.conf.json carries
# the numeric bundle.iOS.bundleVersion and the build step re-applies it, but
# patch project.yml too so a bare xcodebuild is never wrong.
BUNDLE_VERSION="$(python3 -c "import json,sys;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['bundle']['iOS']['bundleVersion'])")"
printf 'bundleVersion from tauri.conf.json: %s\n' "$BUNDLE_VERSION"

patch_project() {
  python3 - "$PROJECT" "$1" <<'PY'
import io, sys
path, mode = sys.argv[1], sys.argv[2]
s = io.open(path, encoding="utf-8").read()
team = __import__("os").environ.get("APPLE_DEVELOPMENT_TEAM", "")

if mode == "unsigned-ipa":
    new = ('        CODE_SIGN_IDENTITY: "-"\n'
           '        CODE_SIGNING_REQUIRED: NO\n'
           '        CODE_SIGNING_ALLOWED: NO\n'
           '        DEVELOPMENT_TEAM: ""\n')
else:
    if not team:
        sys.exit("device mode needs APPLE_DEVELOPMENT_TEAM set to your 10-char team id")
    new = ('        CODE_SIGN_IDENTITY: "Apple Development"\n'
           '        CODE_SIGN_STYLE: Automatic\n'
           f'        DEVELOPMENT_TEAM: {team}\n')

# Replace whatever signing block is present, whatever mode left it in.
lines, out, i = s.splitlines(True), [], 0
SIG = ("CODE_SIGN_IDENTITY:", "CODE_SIGNING_REQUIRED:", "CODE_SIGNING_ALLOWED:",
       "CODE_SIGN_STYLE:", "DEVELOPMENT_TEAM:")
while i < len(lines):
    if any(lines[i].lstrip().startswith(k) for k in SIG):
        while i < len(lines) and any(lines[i].lstrip().startswith(k) for k in SIG):
            i += 1
        out.append(new)
        continue
    out.append(lines[i]); i += 1
io.open(path, "w", encoding="utf-8").write("".join(out))
PY
}

log "regenerating the Xcode project (preserves project.yml edits)"
bun tauri ios init >/dev/null

# Drop the OTHER config's static lib. Tauri names the arch dirs `arm64` /
# `x86_64`, which do NOT match the Rust target triple (`aarch64-apple-ios`), so
# iterate what is actually on disk rather than deriving it from the triple.
if [ "$MODE" = "unsigned-ipa" ]; then
  keep=release
else
  keep=debug
fi
for archdir in "$GEN"/Externals/*/; do
  [ -d "$archdir" ] || continue
  arch="$(basename "$archdir")"
  for cfg in release debug; do
    if [ "$cfg" != "$keep" ]; then
      rm -rf "$archdir$cfg"
      printf 'removed stale %s/%s\n' "$arch" "$cfg"
    fi
  done
done
python3 - "$PROJECT" "$BUNDLE_VERSION" <<'PY'
import io, sys, re
p, bv = sys.argv[1], sys.argv[2]
s = io.open(p, encoding="utf-8").read()

# Apple needs a numeric build number, not the semver Tauri derives from `version`.
s = re.sub(r'CFBundleVersion:\s*"[^"]*"', f'CFBundleVersion: "{bv}"', s)

# project.yml lists Externals as a source, so xcodegen copies the 500+MB
# libapp.a into the app bundle as a resource. It is already linked into the
# binary via `dependencies: - framework: libapp.a`, so shipping it is dead
# weight: it turned the .ipa from 5.8MB into 146MB. The glob MUST be
# recursive - the lib lives at Externals/arm64/<config>/libapp.a, and a bare
# "*.a" only matches the top level and silently does nothing.
s = s.replace(
    "      - path: Externals\n",
    '      - path: Externals\n        excludes:\n          - "**/*.a"\n',
    1,
)
assert '**/*.a' in s, "failed to add the recursive *.a exclude to project.yml"
io.open(p, "w", encoding="utf-8").write(s)
PY
patch_project "$MODE"
# --spec is required: xcodegen looks for ./project.yml in the cwd, and we are
# at the repo root, not gen/apple.
xcodegen generate --spec "$PROJECT" >/dev/null
grep -E "CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|CODE_SIGNING_ALLOWED" "$PROJECT" | sed 's/^/  /'

log "building (this compiles all Rust deps for the device target; expect several minutes)"
# `tauri ios build` ALWAYS ends non-zero in unsigned-ipa mode: its final export
# step demands a teamID that we deliberately did not set. So a non-zero exit is
# not the signal - a real build failure prints "** BUILD FAILED **".
BUILD_LOG=/tmp/grindrx-ios-build.log
bun tauri ios build --ci > "$BUILD_LOG" 2>&1 || true
if grep -q '\*\* BUILD FAILED \*\*' "$BUILD_LOG"; then
  tail -30 "$BUILD_LOG"
  die "xcodebuild failed - full log at $BUILD_LOG"
fi
grep -q 'exportArchive' "$BUILD_LOG" \
  && printf 'note: export step failed as expected (unsigned mode); using the built .app\n'
tail -3 "$BUILD_LOG" | sed 's/^/  /'

APP="$(find "$HOME/Library/Developer/Xcode/DerivedData" -path '*release-iphoneos/GrindrX.app' -maxdepth 6 2>/dev/null | head -1)"
[ -n "$APP" ] || die "no release-iphoneos/GrindrX.app was produced"
log "built $APP"
plutil -p "$APP/Info.plist" | grep -E "CFBundleIdentifier|CFBundleVersion|CFBundleShortVersion" | sed 's/^/  /'
lipo -archs "$APP/GrindrX" | sed 's/^/  arch: /'

if [ "$MODE" = "unsigned-ipa" ]; then
  log "packaging unsigned .ipa for AltStore/SideStore"
  OUT="$ROOT/dist"; mkdir -p "$OUT"

  # Belt and braces: if libapp.a ever lands in the bundle again, drop it. A
  # correct .app is ~15MB; without this the ipa silently becomes 146MB.
  if [ -f "$APP/libapp.a" ]; then
    printf 'stripping stray libapp.a (%s bytes) from the bundle\n' "$(stat -f%z "$APP/libapp.a")"
    rm -f "$APP/libapp.a"
  fi
  APP_MB=$(( $(du -sk "$APP" | cut -f1) / 1024 ))
  [ "$APP_MB" -lt 60 ] || die "app bundle is ${APP_MB}MB, expected <60MB - a static lib is being shipped"

  rm -rf /tmp/grindrx-ipabuild; mkdir -p /tmp/grindrx-ipabuild/Payload
  cp -R "$APP" /tmp/grindrx-ipabuild/Payload/
  VER="$(python3 -c "import json;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['version'])")"
  BV="$(python3 -c "import json;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['bundle']['iOS']['bundleVersion'])")"
  IPA="$OUT/GrindrX-$VER-$BV-unsigned-ipa.ipa"
  rm -f "$IPA"
  ( cd /tmp/grindrx-ipabuild && zip -qry "$IPA" Payload )

  # Do NOT pipe into `grep -q` here: it exits on first match, unzip takes
  # SIGPIPE, and `set -o pipefail` turns that into a false failure.
  unzip -l "$IPA" > /tmp/grindrx-ipa-listing.txt
  grep -q "^ *[0-9].*Payload/GrindrX\.app/GrindrX$" /tmp/grindrx-ipa-listing.txt \
    || die "ipa is missing the executable"
  codesign -dv "$APP" > /tmp/grindrx-codesign.txt 2>&1 || true
  grep -q "not signed" /tmp/grindrx-codesign.txt || die "app is unexpectedly signed"

  log "IPA"
  ls -la "$IPA" | sed 's/^/  /'
  shasum -a 256 "$IPA" | sed 's/^/  sha256: /'
  printf '\nImport into AltStore/SideStore on the device. It signs with the user own cert.\n'
fi

if [ "$MODE" = "device" ]; then
  log "deploying to the connected device"
  printf 'Now run:  bun tauri ios dev\n'
fi