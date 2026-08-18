#!/usr/bin/env bash
# Nightly encrypted backup of the Anchor vault + database.
# Uses age (asymmetric): the private key lives OFF this box — losing the box
# does not lose the ability to restore, and the box alone cannot decrypt old
# backups. See RESTORE.md.
set -euo pipefail

DATA_DIR="${ANCHOR_DATA_DIR:-/var/lib/anchor}"
BACKUP_DIR="${ANCHOR_BACKUP_DIR:-/var/backups/anchor}"
RECIPIENT="${ANCHOR_BACKUP_AGE_RECIPIENT:?Set ANCHOR_BACKUP_AGE_RECIPIENT (age public key) in /etc/anchor/anchor.env}"
KEEP_DAYS="${ANCHOR_BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/anchor-$STAMP.tar.age"

mkdir -p "$BACKUP_DIR"

# Consistent SQLite snapshot even while services run (WAL-safe).
SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"' EXIT
sqlite3 "$DATA_DIR/anchor.db" ".backup '$SNAP/anchor.db'"

tar -C / -cf - "${SNAP#/}/anchor.db" "${DATA_DIR#/}/vault" \
    --transform "s|${SNAP#/}|anchor-db|" \
  | age -r "$RECIPIENT" -o "$OUT"

# Prune old backups (the age-encrypted files, nothing else).
find "$BACKUP_DIR" -name 'anchor-*.tar.age' -mtime "+$KEEP_DAYS" -delete

# Heartbeat so the digest health line shows "last backup Xh ago" (rule 8).
sqlite3 "$DATA_DIR/anchor.db" \
  "INSERT INTO heartbeats (component, last_seen, detail) VALUES ('backup', strftime('%Y-%m-%dT%H:%M:%S','now','localtime'), '$OUT')
   ON CONFLICT(component) DO UPDATE SET last_seen=excluded.last_seen, detail=excluded.detail;"

echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
