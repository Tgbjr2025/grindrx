#!/data/data/com.termux/files/usr/bin/bash
# Termux:Boot entrypoint — re-arms capture after every phone reboot.
# (Termux:Boot runs every script in ~/.termux/boot/ at boot.)
termux-wake-lock

# Watcher (instant uploads) — restart it if it ever dies.
nohup bash -c 'while true; do "$HOME/.anchor/bin/anchor-watcher"; sleep 30; done' \
    >>"$HOME/.anchor/watcher.log" 2>&1 &

# Reconciliation sweep every 15 minutes — the actual guarantee.
nohup bash -c 'while true; do "$HOME/.anchor/bin/anchor-sweep"; sleep 900; done' \
    >>/dev/null 2>&1 &
