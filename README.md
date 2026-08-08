# QRIS Hook — Payment Gateway via Notification Hook + Telegram Bot

Payment gateway QRIS berbasis **notification hook**: aplikasi Android memantau notifikasi pembayaran QRIS masuk (DANA), meneruskannya ke webhook server, lalu server mencocokkan ke invoice, mengonfirmasi pembayaran, dan memberi tahu pelanggan lewat **Telegram bot**.

Dibangun dari fork [suriyadi15/qrishook](https://github.com/suriyadi15/qrishook) (MIT) dengan tambahan:
- Parser notifikasi **DANA** (`id.dana`)
- **QRIS dinamis** — nominal otomatis terisi saat discan (port dari [verssache/qris-dinamis](https://github.com/verssache/qris-dinamis))
- **Mesin invoice** (SQLite) + matching otomatis + callback
- **Telegram bot** — buat invoice, tampilkan QR, konfirmasi otomatis

---

## Arsitektur

```
                     ┌─────────────────────────────────────────────┐
                     │               HP Merchant (yxrn)             │
                     │  DANA app (terima notifikasi)               │
                     │  QRIS Hook app (NotificationListener)       │
                     └──────────────────┬──────────────────────────┘
                                        │ POST /hook (webhook)
                                        ▼
                     ┌─────────────────────────────────────────────┐
                     │          tencent2 (VPS worker)               │
                     │  gateway.py  :8080  (HTTP + SQLite)          │
                     │  bot.py      :8081  (Telegram long-polling)  │
                     │  qris.py     (static→dynamic converter)      │
                     └─────────┬───────────────┬────────────────────┘
                               │               │ callback (lunas)
                               ▼               ▼
                     ┌──────────────┐   ┌──────────────┐
                     │  Buyer HP    │   │ Telegram Bot │
                     │  scan QR     │   │ @Payyebot    │
                     └──────────────┘   └──────────────┘
```

**Alur pembayaran:**

1. Buyer meminta nominal → sistem membuat invoice (`POST /invoice`)
2. Sistem menampilkan QR dinamis (`GET /qris/<invoice_id>.png`) — nominal sudah terisi di QR
3. Buyer scan & bayar dengan app QRIS apa pun (DANA, GoPay, OVO, bank, dst.)
4. Notifikasi "Pembayaran Masuk" muncul di HP merchant → ditangkap app QRIS Hook
5. App mengirim payload ke `POST /hook` → gateway mencocokkan nominal ke invoice pending
6. Invoice → `paid`, callback dikirim ke `callback_url` + bot Telegram mengonfirmasi otomatis

**Akses publik:** https://manhwashorts.masamba.web.id (Cloudflare Tunnel, HTTPS otomatis — tanpa buka port inbound)

---

## API Gateway

Base URL: `https://manhwashorts.masamba.web.id`
Semua endpoint **wajib header** `X-Webhook-Secret: <SECRET>` kecuali yang ditandai *publik*.

### `POST /invoice` — buat invoice

Body:
```json
{
  "amount": 15000,              // wajib, int, IDR (100 - 10.000.000)
  "reference": "ORD-001",       // opsional, string bebas
  "callback_url": "https://app.kamu/hook",  // opsional, dipanggil saat lunas
  "callback_secret": "rahasia", // opsional, dikirim sbg header X-Callback-Secret
  "expires_in": 900             // opsional, detik (default 900 = 15 menit, 0 = tanpa batas)
}
```

Respons `201`:
```json
{
  "invoice_id": "inv_0d64b7bd8993",
  "amount": 15000,              // nominal asli
  "charged_amount": 15059,      // nominal QR = amount + kode unik
  "reference": "ORD-001",
  "status": "pending",
  "expires_at": "2026-08-08T07:55:00+00:00",
  "expires_in": 900,
  "qris_payload": "000201010212...",   // string EMV dinamis (nominal terisi)
  "qris_url": "/qris/inv_0d64b7bd8993.png"
}
```

Error: `400` amount tidak valid · `401` secret salah.

### `GET /qris/<invoice_id>.png` — gambar QR dinamis *(publik)*

PNG QR untuk ditampilkan ke buyer. Nominal `charged_amount` sudah tertanam — buyer scan langsung bisa bayar tanpa memasukkan nominal. `404` jika invoice tidak ada.

### `POST /hook` — webhook dari app QRIS Hook

Dipanggil app Android. Body = payload notifikasi (lihat format di bawah). Gateway mencocokkan `payment.amount` ke invoice pending dengan nominal sama → `paid` + callback.

Respons: `{"ok": true, "matched": "<invoice_id>"}` — `matched: null` jika tidak ada invoice cocok (pembayaran tak dikenal → alert ke bot).

### `GET /invoice/<invoice_id>` — cek status invoice

Respons:
```json
{
  "id": "inv_0d64b7bd8993",
  "amount": 15059,              // nominal dibayar (termasuk kode unik)
  "base_amount": 15000,         // nominal asli
  "reference": "ORD-001",
  "status": "paid",             // pending | paid | expired | cancelled
  "sender_name": "Budi",
  "event_id": "332b98c4-...",
  "paid_at": "2026-08-08T08:02:30+00:00",
  "expires_at": "2026-08-08T07:55:00+00:00",
  "created_at": "2026-08-08T07:40:27+00:00"
}
```

### `POST /invoice/<invoice_id>/cancel` — batalkan invoice

Hanya berlaku untuk status `pending`. `200` berhasil, `404` jika tidak ada/ tidak pending.

### `GET /invoices?status=pending` — daftar invoice

Filter opsional `status`: `pending | paid | expired | cancelled`. Maks 50 terbaru.

### `GET /recent` — log event webhook mentah

32 event terakhir (rekonsiliasi manual). Setiap pembayaran tercatat di sini meskipun tidak match invoice.

### `GET /healthz` — health check *(publik)*

`{"ok": true}`

---

## Callback (saat lunas)

`POST` ke `callback_url` invoice dengan header `X-Callback-Secret` (jika diset):
```json
{
  "invoice_id": "inv_0d64b7bd8993",
  "amount": 15059,
  "base_amount": 15000,
  "reference": "ORD-001",
  "status": "paid",
  "sender_name": "Budi",
  "event_id": "332b98c4-...",
  "paid_at": "2026-08-08T08:02:30+00:00"
}
```

**Catatan:** callback one-shot (tanpa retry). Kalau endpoint down, event tetap bisa dicek via `GET /recent`.

### Alert pembayaran tak dikenal

QRIS dinamis tidak memiliki mekanisme kedaluwarsa teknis (standar EMVCo) — QR yang sudah `expired`/`cancelled` **tetap bisa discan & dibayar**, uang masuk ke rekening merchant. Gateway mengirim alert ke bot:
```json
{"status": "unmatched", "amount": 12345, "sender_name": "X", "event_id": "..."}
```
Bot membalas ke semua chat terdaftar: ⚠️ pembayaran tanpa invoice aktif.

---

## Kode unik (surcharge)

Supaya nominal tiap invoice pending unik (matching pasti), nominal QR = `amount + kode unik`:

- Maksimal **5%** dari nominal
- Cap **50** untuk nominal ≤ Rp10.000
- Cap **200** untuk nominal > Rp10.000

| Nominal | Rentang kode | Beban maks |
|---|---|---|
| Rp100 | 1–5 | 5% |
| Rp1.000 | 1–50 | 5% |
| Rp10.000 | 1–50 | 0,5% |
| Rp100.000 | 1–200 | 0,2% |

Buyer membayar `charged_amount`; sistem hanya menganggap lunas jika `payment.amount` sama persis.

---

## Telegram Bot (@Payyebot)

| Perintah | Fungsi |
|---|---|
| `/start` `/help` | Info & panduan |
| `/pay 15000` atau ketik `15000` | Buat invoice → kirim QR dinamis + nominal bayar |
| `/status <invoice_id>` | Cek status invoice |
| `/cancel <invoice_id>` | Batalkan invoice |

Alur di bot: kirim nominal → bot balas QR + `Rp15.059 (= Rp15.000 + kode 59)` + berlaku 15 menit → buyer bayar → bot konfirmasi otomatis ✅ (beserta nama pengirim).

Chat yang pernah memakai bot terdaftar otomatis (`chats.json`) dan menerima alert pembayaran tak dikenal.

---

## Payload webhook (dari app)

Contoh (disensor):
```json
{
  "event_id": "332b98c4-...",
  "type": "qris_payment",
  "merchant_id": "dana",
  "notification": {
    "source_package": "id.dana",
    "source_app": "DANA",
    "title": "Pembayaran Masuk",
    "text": "Rp169 diterima DANA Bisnis.",
    "big_text": "...",
    "received_at": "..."
  },
  "payment": {
    "amount": 169,
    "currency": "IDR",
    "sender_name": "DANA Bisnis",
    "payment_source": null
  },
  "raw": { "...": "..." }
}
```

---

## QRIS Dinamis

`gateway/qris.py` — konversi QRIS statis → dinamis (port dari verssache/qris-dinamis, MIT):

1. `010211` → `010212` (Point of Initiation: static → dynamic)
2. Sisipkan tag `54` (Transaction Amount) sebelum tag `58` (Country Code)
3. Hitung ulang CRC16-CCITT (polinomial `0x1021`, init `0xFFFF`) pada tag `63`

Payload statis milik merchant disimpan sebagai `STATIC_PAYLOAD` di `qris.py`. Tiap invoice menghasilkan payload baru dengan nominal `charged_amount`. Terverifikasi identik dengan implementasi TypeScript asli.

---

## Deploy

### 1. Android (app QRIS Hook)

Build APK custom:
```bash
export ANDROID_HOME=/opt/android-sdk
export ANDROID_KEYSTORE_PATH=~/qrishook-dana.jks
export ANDROID_KEYSTORE_PASSWORD=<password>
export ANDROID_KEY_ALIAS=qrishook
export ANDROID_KEY_PASSWORD=<password>
export ANDROID_VERSION_CODE=30 ANDROID_VERSION_NAME=1.2.0-dana
./gradlew test assembleRelease
# output: app/build/outputs/apk/release/app-release.apk
```

Setup di HP: install APK → izinkan Notification access → isi Webhook URL `https://manhwashorts.masamba.web.id/hook` + Secret → pilih merchant **DANA** → aktifkan QRIS Hook Active (+ ignore battery optimization).

### 2. Gateway (`gateway/gateway.py`) + Bot (`gateway/bot.py`)

Env gateway (`/etc/qrishook-hook.env`):
```
QRIS_HOOK_SECRET=<secret>
QRIS_HOOK_DATA=/opt/qrishook-hook/data
QRIS_HOOK_PORT=8080
QRIS_ALERT_URL=http://127.0.0.1:8081/cb-bot
```

Env bot (`/etc/qrishook-bot.env`):
```
QRIS_BOT_TOKEN=<bot token>
GATEWAY_SECRET=<secret>
GATEWAY_URL=http://127.0.0.1:8080
QRIS_PUBLIC_URL=https://manhwashorts.masamba.web.id
CALLBACK_PORT=8081
```

Systemd: `qrishook-hook.service` (gateway) + `qris-bot.service` (bot). Akses publik via Cloudflare Tunnel (`cf-qrishook.service`) — hostname ke `127.0.0.1:8080`, tanpa membuka port di security group.

---

## Keamanan & batasan

- **Matching by nominal** — kode unik 1–200 membuat nominal tiap invoice pending unik; jika tetap bentrok (sangat jarang), invoice tertua yang kena.
- **QR expired tetap bisa dibayar** (standar EMVCo) — ditangani via alert ⚠️ + log `/recent`; di sisi aplikasi sebaiknya jangan tampilkan QR setelah `expires_at`.
- Callback one-shot tanpa retry.
- Secret webhook/callback dikirim sebagai header — pastikan HTTPS (sudah via Cloudflare Tunnel).
- Penggunaan sesuai ToS masing-masing penyedia QRIS; untuk usaha sendiri.

---

## Struktur repo

```
app/                    # Aplikasi Android (fork qrishook + parser DANA)
gateway/
  gateway.py            # Mesin invoice + API + matching (stdlib, SQLite)
  bot.py                # Telegram bot @Payyebot (long-polling + callback HTTP)
  qris.py               # Converter QRIS statis → dinamis (CRC16)
release/
  qrishook-1.2.0-dana.apk
```

## Verifikasi APK

- APK SHA-256: `458979d8759663348a44114fb7e76f394128b685365304bb8384b9679b5bd3fc`
- Cert SHA-256: `b4de5253ed23dce66e6c580127999604fc0c3d4e91949421574240673b71021b` — verifikasi fingerprint sama di tiap update.

Keystore & password tidak masuk repo. Lisensi: MIT (upstream).
