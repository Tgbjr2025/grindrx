#!/usr/bin/env python3
"""FXBot web dashboard - stdlib only, designed to bind to the Tailscale IP so
it is reachable from your own devices (phone/laptop on the tailnet) and
nothing else.

Run:  .venv/bin/python dashboard.py [--host 100.x.y.z] [--port 8899]
(installed as the fxbot-dash systemd service by deploy/deploy.sh)
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).parent
DB = BASE / "fxbot.sqlite3"
STATE = BASE / "paper_state.json"


def tailscale_ip() -> str:
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=5)
        ip = out.stdout.strip().splitlines()[0].strip()
        if ip.startswith("100."):
            return ip
    except Exception:  # noqa: BLE001
        pass
    return "127.0.0.1"


def get_status() -> dict:
    db = sqlite3.connect(DB)
    try:
        equity_rows = db.execute(
            "SELECT ts, equity FROM equity ORDER BY ts DESC LIMIT 500").fetchall()[::-1]
        latest = db.execute(
            "SELECT ts, balance, equity FROM equity ORDER BY ts DESC LIMIT 1").fetchone()
        outlook = db.execute(
            "SELECT ts, outlook FROM outlooks ORDER BY ts DESC LIMIT 1").fetchone()
        decisions = db.execute(
            "SELECT ts, symbol, action, confidence, gate_result FROM decisions "
            "ORDER BY id DESC LIMIT 15").fetchall()
        closed = db.execute(
            "SELECT ts_close, symbol, direction, lots, pnl FROM trades "
            "WHERE ts_close IS NOT NULL ORDER BY ts_close DESC LIMIT 15").fetchall()
        halted = db.execute("SELECT value FROM meta WHERE key='halted'").fetchone()
        n_cycles = db.execute("SELECT COUNT(*) FROM outlooks").fetchone()[0]
    finally:
        db.close()

    positions = []
    if STATE.exists():
        try:
            positions = json.loads(STATE.read_text()).get("positions", [])
        except Exception:  # noqa: BLE001
            positions = []

    return {
        "equity_series": [{"ts": t, "equity": e} for t, e in equity_rows],
        "latest": {"ts": latest[0], "balance": latest[1], "equity": latest[2]} if latest else None,
        "outlook": {"ts": outlook[0], "text": outlook[1]} if outlook else None,
        "decisions": [
            {"ts": t, "symbol": s, "action": a, "confidence": c, "gate": g}
            for t, s, a, c, g in decisions
        ],
        "closed_trades": [
            {"ts": t, "symbol": s, "direction": d, "lots": l, "pnl": p}
            for t, s, d, l, p in closed
        ],
        "positions": positions,
        "halted": bool(halted),
        "cycles": n_cycles,
    }


PAGE = """<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FXBot</title>
<style>
 body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;margin:0;padding:12px}
 h1{font-size:18px;margin:4px 0 12px}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
 .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px 14px}
 .card .k{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
 .card .v{font-size:20px;font-weight:600;margin-top:2px}
 .pos .v{font-size:14px}
 .green{color:#3fb950}.red{color:#f85149}.amber{color:#d29922}
 canvas{width:100%;height:180px;background:#161b22;border:1px solid #30363d;border-radius:10px;margin-top:8px}
 h2{font-size:13px;color:#8b949e;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.05em}
 .outlook{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.5}
 table{width:100%;border-collapse:collapse;font-size:12px}
 td,th{padding:5px 8px;text-align:left;border-bottom:1px solid #21262d;white-space:nowrap}
 th{color:#8b949e;font-weight:500}
 .wrap{overflow-x:auto}
 .halt{background:#3d1418;border:1px solid #f85149;color:#f85149;padding:10px;border-radius:10px;
       font-weight:700;text-align:center;margin-bottom:10px}
 footer{color:#484f58;font-size:11px;margin-top:16px;text-align:center}
</style></head><body>
<h1>📈 FXBot <span id="mode" style="color:#8b949e;font-size:12px"></span></h1>
<div id="haltbox"></div>
<div class="cards">
 <div class="card"><div class="k">Equity</div><div class="v" id="equity">–</div></div>
 <div class="card"><div class="k">Balance</div><div class="v" id="balance">–</div></div>
 <div class="card"><div class="k">Open positions</div><div class="v" id="npos">–</div></div>
 <div class="card"><div class="k">Cycles</div><div class="v" id="cycles">–</div></div>
</div>
<canvas id="chart" width="800" height="180"></canvas>
<h2>Open positions</h2><div class="wrap"><table id="positions"></table></div>
<h2>Latest outlook</h2><div class="outlook" id="outlook">–</div>
<h2>Recent decisions</h2><div class="wrap"><table id="decisions"></table></div>
<h2>Closed trades</h2><div class="wrap"><table id="closed"></table></div>
<footer id="foot"></footer>
<script>
const fmt=(n)=>'$'+Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
async function load(){
 const r=await fetch('/api/status');const d=await r.json();
 if(d.latest){equity.textContent=fmt(d.latest.equity);balance.textContent=fmt(d.latest.balance);}
 npos.textContent=d.positions.length;cycles.textContent=d.cycles;
 haltbox.innerHTML=d.halted?'<div class="halt">🛑 KILL SWITCH TRIPPED — BOT HALTED</div>':'';
 positions.innerHTML='<tr><th>Dir</th><th>Symbol</th><th>Lots</th><th>Entry</th><th>SL</th><th>TP</th><th>uPnL</th></tr>'+
  (d.positions.map(p=>`<tr><td>${p.direction.toUpperCase()}</td><td>${p.symbol}</td><td>${p.lots}</td>
   <td>${p.entry_price.toFixed(5)}</td><td>${p.stop_loss.toFixed(5)}</td><td>${p.take_profit.toFixed(5)}</td>
   <td class="${p.unrealized_pnl>=0?'green':'red'}">${fmt(p.unrealized_pnl)}</td></tr>`).join('')||'<tr><td colspan=7>none</td></tr>');
 if(d.outlook)outlook.textContent='['+d.outlook.ts.slice(0,16).replace('T',' ')+' UTC] '+d.outlook.text;
 decisions.innerHTML='<tr><th>Time</th><th>Symbol</th><th>Action</th><th>Conf</th><th>Result</th></tr>'+
  d.decisions.map(x=>`<tr><td>${x.ts.slice(11,16)}</td><td>${x.symbol}</td><td>${x.action}</td>
   <td>${x.confidence.toFixed(2)}</td><td>${x.gate}</td></tr>`).join('');
 closed.innerHTML='<tr><th>Closed</th><th>Symbol</th><th>Dir</th><th>Lots</th><th>PnL</th></tr>'+
  (d.closed_trades.map(t=>`<tr><td>${t.ts?t.ts.slice(5,16).replace('T',' '):''}</td><td>${t.symbol}</td>
   <td>${t.direction}</td><td>${t.lots}</td><td class="${(t.pnl||0)>=0?'green':'red'}">${t.pnl!=null?fmt(t.pnl):'n/a'}</td></tr>`).join('')
   ||'<tr><td colspan=5>none yet</td></tr>');
 // equity chart
 const c=document.getElementById('chart'),ctx=c.getContext('2d');
 const W=c.width,H=c.height;ctx.clearRect(0,0,W,H);
 const es=d.equity_series;if(es.length>1){
  const vals=es.map(p=>p.equity),min=Math.min(...vals),max=Math.max(...vals),pad=(max-min)*0.1||1;
  const y=v=>H-10-((v-(min-pad))/((max+pad)-(min-pad)))*(H-20);
  const x=i=>10+i*(W-20)/(es.length-1);
  ctx.strokeStyle='#3fb950';ctx.lineWidth=2;ctx.beginPath();
  es.forEach((p,i)=>{i?ctx.lineTo(x(i),y(p.equity)):ctx.moveTo(x(i),y(p.equity))});ctx.stroke();
  ctx.fillStyle='#8b949e';ctx.font='11px sans-serif';
  ctx.fillText(fmt(max),12,14);ctx.fillText(fmt(min),12,H-14);
 }
 foot.textContent='auto-refreshes every 60s · '+new Date().toLocaleTimeString();
}
load();setInterval(load,60000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/api/status":
            body = json.dumps(get_status()).encode()
            ctype = "application/json"
        elif self.path == "/":
            body = PAGE.encode()
            ctype = "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # quiet
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="", help="bind address (default: the Tailscale IP)")
    ap.add_argument("--port", type=int, default=8899)
    args = ap.parse_args()
    host = args.host or tailscale_ip()
    print(f"FXBot dashboard on http://{host}:{args.port} (tailnet-only)")
    ThreadingHTTPServer((host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
