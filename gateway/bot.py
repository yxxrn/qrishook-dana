#!/usr/bin/env python3
"""Telegram bot QRIS gateway (legacy Python, digantikan Supabase). Stdlib only.
Ketik nominal -> invoice + QR dinamis -> bayar -> bot konfirmasi otomatis via callback.

Env: QRIS_BOT_TOKEN, GATEWAY_SECRET, GATEWAY_URL (default http://127.0.0.1:8080),
     QRIS_PUBLIC_URL (default https://<PUBLIC_URL>), CALLBACK_PORT (8081)
"""
import os, json, urllib.request, urllib.parse, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ["QRIS_BOT_TOKEN"]
GW_SECRET = os.environ["GATEWAY_SECRET"]
GW = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8080")
PUBLIC = os.environ.get("QRIS_PUBLIC_URL", "https://<PUBLIC_URL>")
CB_PORT = int(os.environ.get("CALLBACK_PORT", "8081"))
EXPIRES = 900  # detik, selaras dengan default gateway
CHATS_FILE = os.path.join(os.environ.get("QRIS_HOOK_DATA", "/opt/qrishook-hook/data"), "chats.json")

API = f"https://api.telegram.org/bot{TOKEN}"


def remember_chat(chat_id):
    try:
        chats = json.load(open(CHATS_FILE)) if os.path.exists(CHATS_FILE) else []
        if chat_id not in chats:
            chats.append(chat_id)
            json.dump(chats, open(CHATS_FILE, "w"))
    except Exception:
        pass


def all_chats():
    try:
        return json.load(open(CHATS_FILE)) if os.path.exists(CHATS_FILE) else []
    except Exception:
        return []


def tg(method, **params):
    req = urllib.request.Request(API + "/" + method,
                                 data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print("tg error:", method, e, flush=True)
        return None


def gw(method, path, body=None):
    headers = {"X-Webhook-Secret": GW_SECRET, "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GW + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except Exception as e:
        print("gw error:", e, flush=True)
        return 0, {}


def rupiah(n):
    return f"Rp{n:,.0f}".replace(",", ".")


def handle_message(msg):
    chat = msg["chat"]["id"]
    text = (msg.get("text") or "").strip()
    low = text.lower()
    remember_chat(chat)
    if low in ("/start", "/help", "help", "bantuan"):
        tg("sendMessage", chat_id=chat, text=(
            "🏪 *QRIS Gateway - yxrn store*\n\n"
            "Kirim nominal, contoh:\n`15000` atau `/pay 15000`\n\n"
            "Perintah:\n`/status <id>` - cek invoice\n`/cancel <id>` - batalkan\n\n"
            "QR berlaku 15 menit. Setelah bayar, bot konfirmasi otomatis."),
            parse_mode="Markdown")
        return
    if low.startswith("/status"):
        inv = text.split()[1] if len(text.split()) > 1 else ""
        if not inv:
            tg("sendMessage", chat_id=chat, text="Format: /status <invoice_id>")
            return
        code, d = gw("GET", f"/invoice/{inv}")
        if code != 200:
            tg("sendMessage", chat_id=chat, text=f"❌ {d.get('error', 'invoice tidak ditemukan')}")
            return
        tg("sendMessage", chat_id=chat, text=(
            f"📄 *{d['id']}*\nStatus: *{d['status']}*\n"
            f"Nominal: {rupiah(d['base_amount'])} (+ kode {d['amount']-d['base_amount']} = {rupiah(d['amount'])})\n"
            + (f"Pengirim: {d['sender_name']}\n" if d.get("sender_name") else "")
            + (f"Lunas: {d['paid_at']}" if d["status"] == "paid" else "")),
            parse_mode="Markdown")
        return
    if low.startswith("/cancel"):
        inv = text.split()[1] if len(text.split()) > 1 else ""
        if not inv:
            tg("sendMessage", chat_id=chat, text="Format: /cancel <invoice_id>")
            return
        code, d = gw("POST", f"/invoice/{inv}/cancel")
        tg("sendMessage", chat_id=chat, text=("✅ Invoice dibatalkan" if code == 200 else f"❌ {d.get('error', 'gagal')}"))
        return
    if low.startswith("/pay"):
        text = text[4:].strip()
    if not text.isdigit():
        tg("sendMessage", chat_id=chat, text="Kirim nominal angka, contoh: `15000`", parse_mode="Markdown")
        return
    amount = int(text)
    if not (100 <= amount <= 10_000_000):
        tg("sendMessage", chat_id=chat, text="Nominal 100 - 10.000.000")
        return
    code, d = gw("POST", "/invoice", {"amount": amount, "reference": f"tg{chat}",
                                       "callback_url": f"http://127.0.0.1:{CB_PORT}/cb-bot",
                                       "expires_in": EXPIRES})
    if code != 201:
        tg("sendMessage", chat_id=chat, text=f"❌ Gagal buat invoice: {d.get('error', code)}")
        return
    extra = d["charged_amount"] - amount
    caption = (
        f"🧾 *{d['invoice_id']}*\n\n"
        f"Bayar: *{rupiah(d['charged_amount'])}*\n"
        f"(= {rupiah(amount)} + kode {extra})\n\n"
        f"Scan QR di atas. Berlaku 15 menit.\n"
        f"Konfirmasi otomatis setelah lunas ✅")
    tg("sendPhoto", chat_id=chat, photo=PUBLIC + d["qris_url"], caption=caption, parse_mode="Markdown")


class CallbackHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        try:
            cb = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            cb = {}
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")
        if cb.get("status") == "unmatched":
            txt = (f"⚠️ *Pembayaran tanpa invoice aktif*\n"
                   f"Nominal: {rupiah(cb.get('amount', 0))}"
                   + (f"\nPengirim: {cb.get('sender_name')}" if cb.get("sender_name") else "")
                   + "\nQR expired/cancel atau nominal tidak dikenal. Cek /recent.")
            for cid in all_chats():
                tg("sendMessage", chat_id=cid, text=txt, parse_mode="Markdown")
            return
        if cb.get("status") != "paid":
            return
        ref = cb.get("reference") or ""
        chat_id = ref[2:] if ref.startswith("tg") else None
        if not chat_id:
            return
        extra = cb.get("amount", 0) - cb.get("base_amount", cb.get("amount", 0))
        txt = (f"✅ *Lunas!*\nInvoice: `{cb.get('invoice_id')}`\n"
               f"Nominal: {rupiah(cb.get('amount', 0))}"
               + (f" (+ kode {extra})" if extra else "")
               + (f"\nPengirim: {cb.get('sender_name')}" if cb.get("sender_name") else ""))
        tg("sendMessage", chat_id=int(chat_id), text=txt, parse_mode="Markdown")

    def log_message(self, *args):
        pass


def poll_loop():
    offset = 0
    while True:
        try:
            req = urllib.request.Request(API + f"/getUpdates?offset={offset}&timeout=50")
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
            for upd in data.get("result", []):
                offset = upd["update_id"] + 1
                msg = upd.get("message")
                if msg and msg.get("text"):
                    threading.Thread(target=handle_message, args=(msg,), daemon=True).start()
        except Exception as e:
            print("poll error:", e, flush=True)


if __name__ == "__main__":
    info = tg("getMe")
    print("bot:", info.get("result", {}).get("username") if info else "FAIL", flush=True)
    srv = ThreadingHTTPServer(("127.0.0.1", CB_PORT), CallbackHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    poll_loop()