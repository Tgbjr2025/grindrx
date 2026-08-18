#!/usr/bin/env bash
# Anchor ONE-COMMAND bootstrap — built for a memory-impaired solo operator.
#
# Run this once, as root, on the OVH server:
#     curl -fsSL https://raw.githubusercontent.com/Tgbjr2025/grindrx/main/anchor/deploy/bootstrap.sh | sudo bash
#
# It is FORGIVING and RESUMABLE: if a step stumbles it warns and keeps going,
# and re-running it continues from where it was. It:
#   1. installs Node 22 + the Claude CLI, then the whole server
#   2. generates the access token, ntfy push topic, and encrypted-backup key
#   3. publishes Anchor over Tailscale (https, no domain/DNS) if available
#   4. TEXTS the app URL + token + backup key to your phone via ntfy AND writes
#      /root/anchor-RECOVERY.txt — so you never have to remember or copy them
#   5. pauses only for the two sign-ins that are legally yours: Claude + Google
#
# Note: NO `set -e`. One failing optional step must not abort the whole setup.
set -uo pipefail

REPO_URL="https://github.com/Tgbjr2025/grindrx.git"
CLONE_DIR="${ANCHOR_CLONE_DIR:-/root/grindrx}"
ANCHOR_DIR="$CLONE_DIR/anchor"
ENV_FILE=/etc/anchor/anchor.env
DATA_DIR=/var/lib/anchor
RECOVERY=/root/anchor-RECOVERY.txt
NTFY_URL="${ANCHOR_NTFY_URL:-https://ntfy.sh}"
WARNINGS=()

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m   ✓ %s\033[0m\n' "$*"; }
ask()  { printf '\n\033[1;33m>>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;31m   ! %s\033[0m\n' "$*"; WARNINGS+=("$*"); }

[[ $EUID -eq 0 ]] || { echo "Run this as root (use: sudo bash ...)."; exit 1; }

# ---------------------------------------------------------------------------
say "Step 1/7 — Get the code"
apt-get update -qq && apt-get install -y -qq git curl jq openssl >/dev/null || warn "apt base packages had trouble"
if [[ -d "$CLONE_DIR/.git" ]]; then
    git -C "$CLONE_DIR" fetch --depth 1 origin main && git -C "$CLONE_DIR" reset --hard origin/main \
        || warn "could not update the code (using what's on disk)"
else
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR" || { echo "Clone failed — check network."; exit 1; }
fi
ok "code at $CLONE_DIR"

# ---------------------------------------------------------------------------
say "Step 2/7 — Node 22 + the Claude CLI (the brain)"
NODEVER="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0)"
if [[ "${NODEVER:-0}" -lt 22 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 \
        && apt-get install -y -qq nodejs >/dev/null 2>&1 \
        && ok "Node $(node -v) installed" || warn "Node 22 install had trouble"
else
    ok "Node $(node -v) present"
fi
if ! command -v claude >/dev/null; then
    npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 \
        && ok "Claude CLI installed" || warn "Claude CLI install failed (set ANCHOR_LLM_BACKEND=api later)"
else
    ok "Claude CLI present"
fi

# ---------------------------------------------------------------------------
say "Step 3/7 — Install the server (this takes a few minutes)"
bash "$ANCHOR_DIR/deploy/setup_server.sh" || warn "server setup reported an issue — continuing"
ok "server step done"

set_env() {  # idempotent KEY=VALUE in the env file
    local key="$1" val="$2"
    if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
    else
        echo "$key=$val" >> "$ENV_FILE"
    fi
}
get_env() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

# ---------------------------------------------------------------------------
say "Step 4/7 — Push notifications (ntfy) — how Anchor talks to your phone"
TOPIC="$(get_env ANCHOR_NTFY_TOPIC)"
if [[ -z "$TOPIC" ]]; then
    TOPIC="anchor-$(openssl rand -hex 10)"
    set_env ANCHOR_NTFY_TOPIC "$TOPIC"
fi
ok "your private ntfy topic: $TOPIC"
ask "ON YOUR PHONE, one time: install the 'ntfy' app (Play Store or F-Droid),
    tap +  →  Subscribe to topic  →  type EXACTLY:   $TOPIC
    Then come back here and press ENTER (I'll send a test buzz)."
read -r _ </dev/tty || true
curl -s -H "Title: Anchor is being set up" \
     -d "If you can read this, notifications work. Setup is continuing." \
     "$NTFY_URL/$TOPIC" >/dev/null 2>&1 && ok "test push sent — check your phone" \
     || warn "test push failed (check the topic name)"

push() { curl -s -H "Title: $1" -d "$2" "$NTFY_URL/$TOPIC" >/dev/null 2>&1 || true; }

# ---------------------------------------------------------------------------
say "Step 5/7 — Encrypted backups + your recovery sheet"
command -v age-keygen >/dev/null || apt-get install -y -qq age >/dev/null 2>&1 || true
AGE_PUB="$(get_env ANCHOR_BACKUP_AGE_RECIPIENT)"
AGE_PRIV=""
if [[ -z "$AGE_PUB" ]] && command -v age-keygen >/dev/null; then
    # age-keygen -o REFUSES to write over an existing file, so write straight
    # to the (removed-first) destination rather than an mktemp file.
    KEYDST="$DATA_DIR/backup-private-key.txt"
    rm -f "$KEYDST"
    if age-keygen -o "$KEYDST" 2>/dev/null; then
        chmod 600 "$KEYDST" 2>/dev/null; chown root:root "$KEYDST" 2>/dev/null
        AGE_PUB="$(grep 'public key:' "$KEYDST" | awk '{print $NF}')"
        AGE_PRIV="$(grep -v '^#' "$KEYDST" | head -1)"
        set_env ANCHOR_BACKUP_AGE_RECIPIENT "$AGE_PUB"
        ok "backup key generated"
    else
        warn "age-keygen failed — backups off for now"
    fi
elif [[ -n "$AGE_PUB" ]]; then
    AGE_PRIV="$(grep -v '^#' "$DATA_DIR/backup-private-key.txt" 2>/dev/null | head -1 || echo '(saved earlier)')"
    ok "backup key already set"
else
    warn "age not available — backups off (install 'age' and re-run)"
fi
chown root:anchor "$ENV_FILE" 2>/dev/null; chmod 640 "$ENV_FILE" 2>/dev/null
systemctl restart anchor-api anchor-worker 2>/dev/null || true
[[ -n "$AGE_PUB" ]] && systemctl start anchor-backup.service 2>/dev/null || true

# ---------------------------------------------------------------------------
say "Step 6/7 — Build the app screen + put Anchor on the network"
if command -v npm >/dev/null; then
    ( cd "$ANCHOR_DIR/gui" && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null 2>&1 ) \
        && ok "app screen built" || warn "GUI build skipped (re-run later) — the API still works"
    systemctl restart anchor-api 2>/dev/null || true
fi

ANCHOR_URL=""
# Bind the API to the PRIVATE Tailscale IP only. That interface is reachable
# only by your own signed-in devices — never the public internet — and
# Tailscale encrypts the traffic (WireGuard), so plain http over it is safe.
# No `tailscale serve`, no certificate step, nothing that can hang.
TSIP=""
command -v tailscale >/dev/null && TSIP="$(timeout 10 tailscale ip -4 2>/dev/null | head -1 || true)"
if [[ -n "$TSIP" ]]; then
    set_env ANCHOR_API_HOST "$TSIP"
    systemctl restart anchor-api 2>/dev/null || true
    ANCHOR_URL="http://$TSIP:8300"
    ok "reachable over Tailscale at $ANCHOR_URL"
else
    ANCHOR_URL="http://127.0.0.1:8300  (local only)"
    warn "Tailscale IP not found — run 'tailscale up' on this server and re-run for phone access."
fi

# ---------------------------------------------------------------------------
say "Step 7/7 — Sign in the brain, and Google (the two steps only you can do)"
if command -v claude >/dev/null && [[ ! -e "$DATA_DIR/.claude/.credentials.json" && ! -e "$DATA_DIR/.claude.json" ]]; then
    ask "CLAUDE LOGIN. I'll open the Claude sign-in. A link/code appears — sign
    in with YOUR Claude account, then type /exit. (This lets Anchor think,
    using your subscription — no API key.)"
    read -r -p "   Press ENTER to start..." _ </dev/tty || true
    sudo -u anchor HOME="$DATA_DIR" claude </dev/tty || warn "Claude login didn't finish — run later: sudo -u anchor HOME=$DATA_DIR claude"
elif command -v claude >/dev/null; then
    ok "Claude already logged in"
fi

if [[ ! -f "$DATA_DIR/google_token.json" ]]; then
    if [[ -f "$DATA_DIR/google_client_secret.json" ]]; then
        ask "GOOGLE APPROVAL. A Google URL will print. Open it on any phone/PC,
        sign in, approve (click past the 'unverified app' warning — it's your
        own app). This lets Anchor write to your Calendar and Contacts."
        read -r -p "   Press ENTER to start..." _ </dev/tty || true
        sudo -u anchor HOME="$DATA_DIR" /opt/anchor/venv/bin/python -m anchor_server.google_auth </dev/tty \
            || warn "Google authorize didn't finish — you can redo it later"
    else
        set_env ANCHOR_DRY_RUN 1
        ask "Google isn't connected yet, so Anchor runs in SAFE MODE (captures +
        transcribes + the app all work; calendar writes are held). To connect
        Google later: put your OAuth 'Desktop app' JSON at
        $DATA_DIR/google_client_secret.json  then re-run this script."
    fi
fi
chown root:anchor "$ENV_FILE" 2>/dev/null; chmod 640 "$ENV_FILE" 2>/dev/null
systemctl restart anchor-api anchor-worker 2>/dev/null || true

# ---------------------------------------------------------------------------
say "Saving your recovery sheet (and texting it to your phone)"
TOKEN="$(get_env ANCHOR_API_TOKEN)"
[[ -z "$AGE_PRIV" ]] && AGE_PRIV="$(grep -v '^#' "$DATA_DIR/backup-private-key.txt" 2>/dev/null | head -1 || echo '(backups not set up)')"
cat > "$RECOVERY" <<EOF
================ ANCHOR — KEEP THIS SOMEWHERE SAFE ================
Saved: $(date)

Open the app (add to your phone's home screen):
    $ANCHOR_URL

Access token (paste once when the app asks; also for a new phone):
    $TOKEN

Push topic (subscribe in the ntfy app):
    $TOPIC

Backup recovery key (needed to restore backups — guard this!):
    $AGE_PRIV

Server files:  /etc/anchor/anchor.env   (all settings/secrets)
Backups:       /var/backups/anchor/     (nightly, encrypted)
Re-run setup:  sudo bash $ANCHOR_DIR/deploy/bootstrap.sh
==================================================================
EOF
chmod 600 "$RECOVERY"
ok "written to $RECOVERY"

push "Anchor is ready ✓" "Open: $ANCHOR_URL
Token: $TOKEN
(Full details saved on the server at $RECOVERY)"
[[ "$AGE_PRIV" != "(backups not set up)" ]] && push "Anchor backup key — SAVE THIS" "Restore key: $AGE_PRIV"

# ---------------------------------------------------------------------------
say "DONE"
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    printf '\033[1;31mSome optional steps need attention:\033[0m\n'
    for w in "${WARNINGS[@]}"; do printf '   • %s\n' "$w"; done
    echo "(The core is up regardless. Re-running this command retries these safely.)"
fi
cat <<EOF

Anchor is running. Your phone just got the app link + token (and backup key).
Save those (a screenshot is fine).

NEXT, on your Samsung phone (about 20 min):
  1. Install from F-Droid: Termux, Termux:API, Termux:Boot, Termux:Widget
  2. In Termux:
        pkg install -y git && git clone $REPO_URL
        bash grindrx/anchor/phone/setup_termux.sh
     (it asks for the URL and token above), then:  anchor backfill
  3. Open the app URL in Chrome, paste the token, Add to Home screen.

If anything above showed a "!", just run this same command again — it retries
those safely and continues.
EOF
