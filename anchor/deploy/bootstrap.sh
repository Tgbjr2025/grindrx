#!/usr/bin/env bash
# Anchor ONE-COMMAND bootstrap — built for a memory-impaired solo operator.
#
# Run this once, as root, on the OVH server:
#     curl -fsSL https://raw.githubusercontent.com/Tgbjr2025/grindrx/main/anchor/deploy/bootstrap.sh | sudo bash
#
# It is idempotent: if it stops or you lose your place, just run it again and
# it picks up where it left off. It:
#   1. installs and starts the whole server (setup_server.sh)
#   2. generates the access token, ntfy push topic, and encrypted-backup key
#   3. publishes Anchor over your Tailscale network as https://<machine>.ts.net
#      (no domain, no DNS, no certificate wrangling — reachable only by your
#       own devices), falling back to a domain + Caddy if Tailscale isn't found
#   4. TEXTS the important secrets to your phone via ntfy AND writes them to
#      /root/anchor-RECOVERY.txt — so you never have to remember or copy them
#   5. pauses, with plain instructions, only for the two sign-ins that are
#      legally yours to do: your Claude login and the Google approval
set -euo pipefail

REPO_URL="https://github.com/Tgbjr2025/grindrx.git"
CLONE_DIR="${ANCHOR_CLONE_DIR:-/root/grindrx}"
ANCHOR_DIR="$CLONE_DIR/anchor"
ENV_FILE=/etc/anchor/anchor.env
DATA_DIR=/var/lib/anchor
RECOVERY=/root/anchor-RECOVERY.txt
NTFY_URL="${ANCHOR_NTFY_URL:-https://ntfy.sh}"

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m   ✓ %s\033[0m\n' "$*"; }
ask()  { printf '\n\033[1;33m>>> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this as root (use: sudo bash ...)."; exit 1; }

# ---------------------------------------------------------------------------
say "Step 1/7 — Get the code"
apt-get update -qq && apt-get install -y -qq git curl jq >/dev/null
if [[ -d "$CLONE_DIR/.git" ]]; then
    # Force-sync to the latest main so bug fixes always land on a re-run.
    git -C "$CLONE_DIR" fetch --depth 1 origin main
    git -C "$CLONE_DIR" reset --hard origin/main
else
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
fi
ok "code at $CLONE_DIR"

# ---------------------------------------------------------------------------
say "Step 2/7 — Install the server (this takes a few minutes)"
bash "$ANCHOR_DIR/deploy/setup_server.sh"
ok "services installed"

# Helper: set KEY=VALUE in the env file (idempotent).
set_env() {
    local key="$1" val="$2"
    if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^$key=.*|$key=$val|" "$ENV_FILE"
    else
        echo "$key=$val" >> "$ENV_FILE"
    fi
}
get_env() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

# ---------------------------------------------------------------------------
say "Step 3/7 — Push notifications (ntfy) — how Anchor talks to your phone"
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
     "$NTFY_URL/$TOPIC" >/dev/null && ok "test push sent — check your phone"

push() {  # push <title> <message>  (best-effort)
    curl -s -H "Title: $1" -d "$2" "$NTFY_URL/$TOPIC" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
say "Step 4/7 — Encrypted backups + your recovery sheet"
AGE_PUB="$(get_env ANCHOR_BACKUP_AGE_RECIPIENT)"
if [[ -z "$AGE_PUB" ]]; then
    # Generate the keypair on the server. The private key is what restores
    # backups — it is saved to the recovery sheet and texted to your phone so
    # it lives somewhere off the server too, without needing a laptop.
    KEYFILE="$(mktemp)"
    age-keygen -o "$KEYFILE" 2>/dev/null
    AGE_PUB="$(grep 'public key:' "$KEYFILE" | awk '{print $NF}')"
    AGE_PRIV="$(grep -v '^#' "$KEYFILE" | head -1)"
    set_env ANCHOR_BACKUP_AGE_RECIPIENT "$AGE_PUB"
    install -m 600 "$KEYFILE" "$DATA_DIR/backup-private-key.txt"
    chown root:root "$DATA_DIR/backup-private-key.txt"
    rm -f "$KEYFILE"
    ok "backup key generated"
fi

TOKEN="$(get_env ANCHOR_API_TOKEN)"
chown root:anchor "$ENV_FILE"; chmod 640 "$ENV_FILE"
systemctl restart anchor-api anchor-worker
# Kick a first backup so the key is proven to work.
systemctl start anchor-backup.service 2>/dev/null || true
ok "backups armed (nightly 3 AM)"

# ---------------------------------------------------------------------------
say "Step 5/7 — Build the app screen + put Anchor on the network"
if ! command -v node >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 || true
    apt-get install -y -qq nodejs >/dev/null 2>&1 || true
fi
if command -v npm >/dev/null; then
    ( cd "$ANCHOR_DIR/gui" && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null 2>&1 ) \
        && ok "app screen built" || ask "GUI build skipped (npm issue) — the API still works; re-run later."
    systemctl restart anchor-api
fi

ANCHOR_URL=""
if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then
    # Tailscale Serve: automatic HTTPS on your private tailnet, no domain/DNS,
    # reachable ONLY by your own signed-in devices. Ideal for a medical vault.
    tailscale serve --bg 8300 >/dev/null 2>&1 || tailscale serve --bg --https=443 http://127.0.0.1:8300 >/dev/null 2>&1 || true
    TSNAME="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' | sed 's/\.$//')"
    [[ -n "$TSNAME" ]] && ANCHOR_URL="https://$TSNAME"
    if [[ -n "$ANCHOR_URL" ]]; then
        ok "published over Tailscale: $ANCHOR_URL"
    else
        ask "Tailscale is here but Serve needs HTTPS enabled once in the admin
        console (Tailscale admin → DNS → enable MagicDNS + HTTPS Certificates),
        then re-run this script. Using the raw Tailscale IP for now."
        ANCHOR_URL="http://$(tailscale ip -4 2>/dev/null | head -1):8300"
    fi
else
    ask "Tailscale not detected. Two choices:
      A) Install Tailscale (recommended — no domain needed):
           curl -fsSL https://tailscale.com/install.sh | sh && tailscale up
         then re-run this script.
      B) Use a domain now: type it below (must already point DNS → this server),
         or just press ENTER to skip and set up remote access later."
    read -r DOMAIN </dev/tty || true
    if [[ -n "${DOMAIN:-}" ]]; then
        apt-get install -y -qq caddy >/dev/null 2>&1 || {
            apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
            apt-get update -qq && apt-get install -y -qq caddy >/dev/null 2>&1
        }
        printf '%s {\n    reverse_proxy 127.0.0.1:8300\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
        systemctl reload caddy 2>/dev/null || systemctl restart caddy
        ANCHOR_URL="https://$DOMAIN"
        ok "published at $ANCHOR_URL"
    else
        ANCHOR_URL="http://127.0.0.1:8300  (local only — set up Tailscale for phone access)"
    fi
fi

# ---------------------------------------------------------------------------
say "Step 6/7 — Sign in the brain, and Google (the two steps only you can do)"

# --- Claude login ---
if [[ ! -e "$DATA_DIR/.claude/.credentials.json" && ! -e "$DATA_DIR/.claude.json" ]]; then
    ask "CLAUDE LOGIN. I'll open the Claude sign-in now. A link/code appears —
    sign in with YOUR Claude account, then type /exit. (This is what lets
    Anchor think, using your subscription — no API key.)"
    read -r -p "   Press ENTER to start..." _ </dev/tty || true
    sudo -u anchor HOME="$DATA_DIR" claude </dev/tty || \
        ask "If that didn't finish, run later:  sudo -u anchor HOME=$DATA_DIR claude"
else
    ok "Claude already logged in"
fi

# --- Google authorize ---
if [[ ! -f "$DATA_DIR/google_token.json" ]]; then
    if [[ -f "$DATA_DIR/google_client_secret.json" ]]; then
        ask "GOOGLE APPROVAL. A Google URL will print. Open it on any phone/PC,
        sign in, approve (click past the 'unverified app' warning — it's your
        own app). This lets Anchor write to your Calendar and Contacts."
        read -r -p "   Press ENTER to start..." _ </dev/tty || true
        sudo -u anchor HOME="$DATA_DIR" /opt/anchor/venv/bin/python -m anchor_server.google_auth </dev/tty || true
    else
        set_env ANCHOR_DRY_RUN 1
        ask "Google isn't connected yet, so Anchor will run in SAFE MODE
        (captures + transcribes + the app all work; calendar writes are held,
        not sent). To connect Google later: put your OAuth 'Desktop app' JSON at
        $DATA_DIR/google_client_secret.json  then re-run this script."
    fi
fi
chown root:anchor "$ENV_FILE"; chmod 640 "$ENV_FILE"
systemctl restart anchor-api anchor-worker

# ---------------------------------------------------------------------------
say "Step 7/7 — Save your recovery sheet (and text it to your phone)"
AGE_PRIV_SAVED="$(cat "$DATA_DIR/backup-private-key.txt" 2>/dev/null | grep -v '^#' | head -1 || echo '(already existed — see your notes)')"
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
    $AGE_PRIV_SAVED

Server files:  /etc/anchor/anchor.env   (all settings/secrets)
Backups:       /var/backups/anchor/     (nightly, encrypted)
Re-run setup:  sudo bash $ANCHOR_DIR/deploy/bootstrap.sh
==================================================================
EOF
chmod 600 "$RECOVERY"
ok "written to $RECOVERY"

push "Anchor is ready ✓" "Open: $ANCHOR_URL
Token: $TOKEN
(Recovery key & details also saved on the server at $RECOVERY)"
push "Anchor backup key — SAVE THIS" "Restore key: $AGE_PRIV_SAVED"

say "DONE"
cat <<EOF

Anchor is running. Your phone just got two messages: the app link + token,
and your backup key. Save those (a screenshot is fine).

NEXT, on your Samsung phone (about 20 min, see the checklist):
  1. Install from F-Droid: Termux, Termux:API, Termux:Boot, Termux:Widget
  2. In Termux:
        pkg install -y git && git clone $REPO_URL
        bash grindrx/anchor/phone/setup_termux.sh
     (it asks for the URL and token above), then:  anchor backfill
  3. Open $ANCHOR_URL in Chrome, paste the token, Add to Home screen.

If anything here failed, just run this same command again — it continues
safely from where it stopped.
EOF
