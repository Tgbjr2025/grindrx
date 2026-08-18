#!/data/data/com.termux/files/usr/bin/bash
# Anchor phone setup — run INSIDE Termux on the Samsung phone.
# Prereqs (install from F-Droid, same signature): Termux, Termux:API, Termux:Boot.
set -eu

echo "== Anchor phone setup =="
pkg install -y termux-api inotify-tools jq curl coreutils findutils >/dev/null

# Storage permission (shows the Android prompt on first run).
[ -d "$HOME/storage" ] || termux-setup-storage

mkdir -p "$HOME/.anchor/bin" "$HOME/.anchor/captures" "$HOME/.termux/boot"

HERE="$(cd "$(dirname "$0")" && pwd)"
cp "$HERE/bin/anchor" "$HERE/bin/anchor-sweep" "$HERE/bin/anchor-watcher" \
   "$HERE/bin/anchor-sms-poll" "$HOME/.anchor/bin/"
cp "$HERE/boot/anchor-boot.sh" "$HOME/.termux/boot/anchor-boot.sh"
chmod +x "$HOME/.anchor/bin/"* "$HOME/.termux/boot/anchor-boot.sh"
ln -sf "$HOME/.anchor/bin/anchor" "$PREFIX/bin/anchor"

# Share-sheet target: sharing a file to Termux (e.g. a voicemail stuck in the
# carrier's visual-voicemail app) drops it here and it uploads immediately.
mkdir -p "$HOME/bin"
cat > "$HOME/bin/termux-file-editor" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u
. "$HOME/.anchor/config"
f="$1"
sha=$(sha256sum "$f" | cut -d' ' -f1)
stamp=$(date -r "$f" +%Y-%m-%dT%H:%M:%S%:z)
kind=voicemail
case "$f" in *.jpg|*.jpeg|*.png) kind=photo;; esac
if curl -sS -m 300 -X POST -H "Authorization: Bearer $ANCHOR_TOKEN" \
    -F "file=@$f" -F "kind=$kind" -F "sha256=$sha" \
    -F "source_path=(shared)" -F "captured_at=$stamp" \
    "$ANCHOR_SERVER/v1/ingest" >/dev/null; then
    termux-notification --title "Anchor" --content "Shared file uploaded ($kind)."
else
    cp "$f" "$HOME/.anchor/captures/" 2>/dev/null
    termux-notification --title "Anchor" --content "Upload failed — saved; sweep will retry."
fi
EOF
chmod +x "$HOME/bin/termux-file-editor"

if [ ! -f "$HOME/.anchor/config" ]; then
    printf 'Server URL (https://...): '; read -r server
    printf 'API token (from /etc/anchor/anchor.env on the server): '; read -r token
    cat > "$HOME/.anchor/config" <<EOF
ANCHOR_SERVER=$server
ANCHOR_TOKEN=$token
# Space-separated dirs to watch/sweep. Auto-detected defaults usually work:
#ANCHOR_CALL_DIRS="/storage/emulated/0/Recordings/Call"
EOF
    chmod 600 "$HOME/.anchor/config"
fi

# Detect the call-recording directory and report.
for d in "/storage/emulated/0/Recordings/Call" "/storage/emulated/0/Call" \
         "/storage/emulated/0/Sounds/Voicemail"; do
    [ -d "$d" ] && echo "found: $d ($(find "$d" -type f | wc -l) files)"
done

# Start capture now (same thing Termux:Boot does after a reboot).
bash "$HOME/.termux/boot/anchor-boot.sh"

echo ""
echo "== Done. Test: 'anchor status' then 'anchor backfill' =="
echo "IMPORTANT: disable battery optimization for Termux (Settings > Apps >"
echo "Termux > Battery > Unrestricted) or Android will kill the sync."
