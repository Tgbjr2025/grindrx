#!/usr/bin/env bash
# Run ON the server from the forex-bot directory: bash deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/fxbot}"

echo "==> Installing to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --exclude .venv --exclude '*.sqlite3' --exclude .env ./ "$APP_DIR/" 2>/dev/null || cp -r . "$APP_DIR/"

cd "$APP_DIR"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt -q

[ -f config.yaml ] || cp config.example.yaml config.yaml
[ -f .env ] || cp .env.example .env

sudo cp deploy/fxbot.service /etc/systemd/system/fxbot.service
sudo systemctl daemon-reload
sudo systemctl enable fxbot

echo "==> Done. Next steps:"
echo "  1. Edit $APP_DIR/.env        (ANTHROPIC_API_KEY, MetaApi creds for live mode)"
echo "  2. Edit $APP_DIR/config.yaml (symbols, risk, costs)"
echo "  3. Smoke test:   cd $APP_DIR && .venv/bin/python run.py --once"
echo "  4. Start:        sudo systemctl start fxbot"
echo "  5. Logs:         journalctl -u fxbot -f"
