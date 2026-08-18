# Restoring Anchor from backup

Backups are nightly, encrypted with **age**, written to `/var/backups/anchor/`
(copy them off-box too — a cron `rsync` to any machine you control is enough;
they are already encrypted).

## What you need
- The latest `anchor-YYYYMMDD-HHMMSS.tar.age` file
- Your **age private key** (`keys.txt`) — stored OFF the server
  (password manager + a printed copy). Without it backups cannot be decrypted.

## Steps (fresh box)
```bash
# 1. Set the server up (installs services, creates the anchor user):
sudo bash anchor/deploy/setup_server.sh
sudo systemctl stop anchor-api anchor-worker

# 2. Decrypt and unpack the backup:
age -d -i keys.txt -o anchor-restore.tar anchor-20260817-030000.tar.age
tar -xf anchor-restore.tar

# 3. Put things back:
sudo cp anchor-db/anchor.db /var/lib/anchor/anchor.db
sudo cp -r var/lib/anchor/vault/* /var/lib/anchor/vault/
sudo chown -R anchor:anchor /var/lib/anchor

# 4. Restore /etc/anchor/anchor.env from your password manager
#    (it holds the API token, Anthropic key, ntfy topic, age recipient).

# 5. Start and verify:
sudo systemctl start anchor-api anchor-worker
curl -H "Authorization: Bearer $TOKEN" https://<your-host>/v1/health
```

The phone needs nothing: on its next 15-minute sweep it diffs against the
restored manifest and re-uploads anything captured while the server was down.
Re-uploads of things already in the restored vault deduplicate by sha256.

## Test the restore path (do this once, now)
Run steps 2–3 into a temp directory on any machine and confirm you can open
`anchor.db` with `sqlite3` and play one audio file from the vault. An untested
backup is not a backup.
