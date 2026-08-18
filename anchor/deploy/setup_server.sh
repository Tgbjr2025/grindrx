#!/usr/bin/env bash
# Anchor server setup — run as root on the OVH Ubuntu box.
# Idempotent: safe to re-run after pulling updates.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR=/opt/anchor
DATA_DIR=/var/lib/anchor
BACKUP_DIR=/var/backups/anchor
ENV_FILE=/etc/anchor/anchor.env

echo "== Anchor server setup =="

# 1. Service user + directories (vault locked to the service user)
id anchor &>/dev/null || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin anchor
mkdir -p "$DATA_DIR"/vault "$BACKUP_DIR" /etc/anchor "$INSTALL_DIR"
chown -R anchor:anchor "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$DATA_DIR"/vault "$BACKUP_DIR"

# 2. System packages
apt-get update -qq
apt-get install -y -qq python3.11-venv python3.11-dev ffmpeg age curl >/dev/null

# 3. Python venv + install
python3.11 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q "$REPO_DIR/server"
cp "$REPO_DIR/deploy/backup.sh" "$INSTALL_DIR/backup.sh"
chmod 755 "$INSTALL_DIR/backup.sh"

# 4. Environment file (created once; never overwritten)
if [[ ! -f "$ENV_FILE" ]]; then
    cp "$REPO_DIR/.env.example" "$ENV_FILE"
    # Generate the phone<->server bearer token now so setup is one pass.
    sed -i "s/^ANCHOR_API_TOKEN=.*/ANCHOR_API_TOKEN=$(openssl rand -hex 32)/" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo ">>> EDIT $ENV_FILE: set ANTHROPIC_API_KEY, ANCHOR_NTFY_TOPIC, Google credentials."
fi
chown root:anchor "$ENV_FILE"; chmod 640 "$ENV_FILE"

# 5. systemd units
cp "$REPO_DIR"/deploy/systemd/anchor-*.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now anchor-api.service anchor-worker.service
systemctl enable --now anchor-digest.timer anchor-backup.timer

# 6. Google OAuth bootstrap hint
if [[ ! -f "$DATA_DIR/google_token.json" ]]; then
    cat <<'EOF'
>>> Google Calendar/People not yet authorized. On a machine with a browser:
    1. Create an OAuth "Desktop app" client in Google Cloud Console
       (enable the Calendar API and People API), download the client secret
       JSON to /var/lib/anchor/google_client_secret.json
    2. Run: /opt/anchor/venv/bin/python -m anchor_server.google_auth
       and follow the URL it prints. This writes google_token.json.
    Until then, set ANCHOR_DRY_RUN=1 in /etc/anchor/anchor.env to smoke-test.
EOF
fi

echo "== Done. Check: systemctl status anchor-api anchor-worker =="
echo "== HTTPS: put the API behind your reverse proxy (nginx/caddy) with a"
echo "   real certificate. The API listens on 127.0.0.1:8300 by default. =="
