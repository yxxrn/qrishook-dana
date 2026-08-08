#!/usr/bin/env python3
"""QRIS Hook payment gateway. Stdlib only.
QRIS static (dari app DANA) -> pembayar scan -> notifikasi DANA -> webhook -> invoice auto-paid.

API:
  POST /invoice              {"amount": 15000, "reference": "ORD-1", "callback_url": "https://...", "callback_secret": "..."}
                             -> {"invoice_id": "inv_xxx", "amount": 15000, "status": "pending", "qris_url": "/qris.png"}
  GET  /invoice/<id>         -> {"invoice_id", "amount", "status", "reference", "sender_name", "paid_at", ...}
  GET  /invoices?status=pending
  POST /hook                 (dari app QRIS Hook) -> cocokkan amount ke invoice pending tertua -> paid + callback
  GET  /qris.png             gambar QRIS static (opsional, jika ada file)
  GET  /recent | /healthz
Env: QRIS_HOOK_SECRET, QRIS_HOOK_DATA, QRIS_HOOK_PORT
"""
import os, json, hmac, random, sqlite3, threading, urllib.request, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

sys_path_ok = os.path.exists("/opt/qrishook-hook/qris.py")
if sys_path_ok:
    import sys
    sys.path.insert(0, "/opt/qrishook-hook")
    import qris

SECRET = os.environ.get("QRIS_HOOK_SECRET", "")
DATA_DIR = os.environ.get("QRIS_HOOK_DATA", "/opt/qrishook-hook/data")
PORT = int(os.environ.get("QRIS_HOOK_PORT", "8080"))
DB = os.path.join(DATA_DIR, "gateway.db")
QRIS_IMG = "/opt/qrishook-hook/qris.png"
ALERT_URL = os.environ.get("QRIS_ALERT_URL", "")  # menerima {"status":"unmatched",...}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  base_amount INTEGER NOT NULL,
  reference TEXT,
  callback_url TEXT,
  callback_secret TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sender_name TEXT,
  event_id TEXT,
  paid_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.execute(_SCHEMA)
    # sweep: invoice kadaluarsa -> expired (expires_at null = tanpa batas)
    conn.execute("UPDATE invoices SET status='expired' WHERE status='pending'"
                 " AND expires_at IS NOT NULL AND expires_at < ?", (now(),))
    conn.commit()
    return conn


def log_event(body):
    with open(os.path.join(DATA_DIR, "events.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": now(), "event": body}, ensure_ascii=False) + "\n")


def fire_callback(url, secret, payload):
    def _do():
        try:
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", **({"X-Callback-Secret": secret} if secret else {})},
                method="POST")
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            log_event({"type": "callback_failed", "url": url, "error": str(e)})
    threading.Thread(target=_do, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _auth_ok(self):
        if not SECRET:
            return True
        return hmac.compare_digest(self.headers.get("X-Webhook-Secret", ""), SECRET)

    def do_GET(self):
        p = self.path
        if p == "/healthz":
            return self._json(200, {"ok": True})
        if p == "/recent":
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            lines = []
            f = os.path.join(DATA_DIR, "events.jsonl")
            if os.path.exists(f):
                with open(f, encoding="utf-8", errors="replace") as fh:
                    lines = [json.loads(l) for l in fh.read().splitlines()[-32:] if l.strip()]
            return self._json(200, lines)
        if p == "/qris.png" and os.path.exists(QRIS_IMG):
            data = open(QRIS_IMG, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if p.startswith("/qris/"):
            if not sys_path_ok:
                return self._json(500, {"error": "qris module missing"})
            conn = db()
            row = conn.execute("SELECT amount FROM invoices WHERE id=?", (p.split("/")[-1].removesuffix(".png"),)).fetchone()
            conn.close()
            if not row:
                return self._json(404, {"error": "invoice not found"})
            try:
                import qrcode
                from io import BytesIO
                payload = qris.convert(row[0])
                buf = BytesIO()
                qrcode.make(payload).save(buf, format="PNG")
                data = buf.getvalue()
            except Exception as e:
                return self._json(500, {"error": str(e)})
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if p.startswith("/invoice/"):
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            conn = db()
            row = conn.execute("SELECT * FROM invoices WHERE id=?", (p.split("/")[-1],)).fetchone()
            conn.close()
            if not row:
                return self._json(404, {"error": "invoice not found"})
            cols = ["id", "amount", "base_amount", "reference", "callback_url", "callback_secret", "status",
                    "sender_name", "event_id", "paid_at", "expires_at", "created_at"]
            d = dict(zip(cols, row))
            d.pop("callback_secret", None)
            return self._json(200, d)
        if p.startswith("/invoices"):
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            status = None
            if "?" in p:
                status = dict(q.split("=") for q in p.split("?")[1].split("&")).get("status")
            conn = db()
            q = "SELECT id, amount, base_amount, reference, status, sender_name, paid_at, created_at FROM invoices"
            args = ()
            if status:
                q += " WHERE status=?"
                args = (status,)
            q += " ORDER BY created_at DESC LIMIT 50"
            rows = conn.execute(q, args).fetchall()
            conn.close()
            cols = ["invoice_id", "amount", "base_amount", "reference", "status", "sender_name", "paid_at", "created_at"]
            return self._json(200, [dict(zip(cols, r)) for r in rows])
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/hook":
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            try:
                body = self._body()
            except Exception:
                return self._json(400, {"error": "invalid JSON"})
            log_event(body)
            pay = body.get("payment") or {}
            amount = pay.get("amount")
            sender = pay.get("sender_name")
            if isinstance(amount, int) and amount > 0:
                conn = db()
                row = conn.execute(
                    "SELECT * FROM invoices WHERE status='pending' AND amount=? AND"
                    " (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC LIMIT 1",
                    (amount, now())).fetchone()
                if row:
                    cols = ["id", "amount", "reference", "callback_url", "callback_secret", "status",
                            "sender_name", "event_id", "paid_at", "created_at"]
                    inv = dict(zip(cols, row))
                    conn.execute("UPDATE invoices SET status='paid', sender_name=?, event_id=?, paid_at=? WHERE id=?",
                                 (sender, body.get("event_id"), now(), inv["id"]))
                    conn.commit()
                    conn.close()
                    payload = {"invoice_id": inv["id"], "amount": inv["amount"], "reference": inv["reference"],
                               "status": "paid", "sender_name": sender, "event_id": body.get("event_id"),
                               "paid_at": now()}
                    if inv["callback_url"]:
                        fire_callback(inv["callback_url"], inv["callback_secret"], payload)
                    return self._json(200, {"ok": True, "matched": inv["id"]})
                conn.close()
            if isinstance(amount, int) and amount > 0 and ALERT_URL:
                # pembayaran tanpa invoice aktif (expired/cancelled/tidak pernah ada)
                fire_callback(ALERT_URL, "", {"status": "unmatched", "amount": amount,
                                              "sender_name": sender, "event_id": body.get("event_id")})
            return self._json(200, {"ok": True, "matched": None})
        if self.path.startswith("/invoice/") and self.path.endswith("/cancel"):
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            inv_id = self.path.split("/")[-2]
            conn = db()
            cur = conn.execute("UPDATE invoices SET status='cancelled' WHERE id=? AND status='pending'", (inv_id,))
            conn.commit()
            conn.close()
            if cur.rowcount == 0:
                return self._json(404, {"error": "invoice not found or not pending"})
            return self._json(200, {"ok": True, "invoice_id": inv_id, "status": "cancelled"})
        if self.path == "/invoice":
            if not self._auth_ok():
                return self._json(401, {"error": "bad secret"})
            try:
                body = self._body()
            except Exception:
                return self._json(400, {"error": "invalid JSON"})
            amount = body.get("amount")
            if not isinstance(amount, int) or amount <= 0:
                return self._json(400, {"error": "amount must be positive int (IDR)"})
            conn = db()
            # surcharge unik 1-100 supaya nominal tiap invoice pending beda -> matching pasti
            while True:
                charged = amount + random.randint(1, 100)
                clash = conn.execute(
                    "SELECT 1 FROM invoices WHERE status='pending' AND amount=?", (charged,)).fetchone()
                if not clash:
                    break
            inv_id = "inv_" + uuid.uuid4().hex[:12]
            expires_in = body.get("expires_in", 900)
            expires_at = None
            if isinstance(expires_in, int) and expires_in > 0:
                from datetime import timedelta
                expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
            conn.execute("INSERT INTO invoices (id, amount, base_amount, reference, callback_url, callback_secret, status, expires_at, created_at)"
                         " VALUES (?,?,?,?,?,?,'pending',?,?)",
                         (inv_id, charged, amount, body.get("reference"), body.get("callback_url"),
                          body.get("callback_secret"), expires_at, now()))
            conn.commit()
            conn.close()
            resp = {"invoice_id": inv_id, "amount": amount, "charged_amount": charged,
                    "reference": body.get("reference"), "status": "pending",
                    "expires_at": expires_at, "expires_in": expires_in}
            if sys_path_ok:
                resp["qris_payload"] = qris.convert(charged)
                resp["qris_url"] = f"/qris/{inv_id}.png"
            return self._json(201, resp)
        return self._json(404, {"error": "not found"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()