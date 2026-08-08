# QRIS Payment Gateway — Notification Hook + Telegram Bot

Sistem payment gateway QRIS yang mengubah HP Android menjadi penerima pembayaran otomatis:

1. **Aplikasi Android** memantau notifikasi pembayaran QRIS masuk (DANA) via `NotificationListenerService`
2. Setiap notifikasi diteruskan sebagai **webhook** ke server
3. Server **mencocokkan nominal** ke invoice pending → tandai `paid` → kirim **konfirmasi otomatis ke Telegram bot**
4. Buyer membayar lewat **QRIS dinamis** — nominal sudah terisi, tinggal scan

Backend berjalan di **Supabase** (Edge Functions + Postgres + pg_cron) — tanpa VPS, tanpa proses berjalan sendiri.

Dibangun dari [suriyadi15/qrishook](https://github.com/suriyadi15/qrishook) (MIT) dengan tambahan parser DANA, QRIS dinamis (port dari [verssache/qris-dinamis](https://github.com/verssache/qris-dinamis), MIT), mesin invoice, dan bot Telegram.

---

## Arsitektur

```
HP Android (wajib nyala — sumber notifikasi)
├── DANA app            : menerima pembayaran QRIS
└── QRIS Hook app       : NotificationListener -> POST webhook
                            │
                            ▼
Supabase (Edge Functions + Postgres)
├── /hook        : terima webhook, cocokkan nominal -> paid
├── /invoice     : buat invoice + payload QRIS dinamis
├── /qris        : gambar QR (hanya saat pending)
├── /bot         : webhook Telegram (perintah /pay /status /cancel)
├── /expiry      : sweep kadaluarsa tiap menit (pg_cron)
└── /health      : ping anti-pause (cron-job.org)

Buyer → scan QR dinamis → bayar → uang masuk DANA → notifikasi → hook → paid → bot konfirmasi ✅
```

**Base URL:** `https://odnezlijimaobxuxmmvt.supabase.co/functions/v1/`

---

## API

Semua endpoint butuh header `X-Webhook-Secret: <SECRET>` kecuali yang ditandai *publik*.

### `POST /invoice` — buat invoice

```json
{
  "amount": 15000,
  "reference": "ORD-001",
  "callback_url": "https://app.kamu/hook",
  "callback_secret": "rahasia",
  "expires_in": 900
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `amount` | ✅ | int, IDR, 100 – 10.000.000 |
| `reference` | ❌ | string bebas |
| `callback_url` | ❌ | dipanggil saat lunas |
| `callback_secret` | ❌ | header `X-Callback-Secret` di callback |
| `expires_in` | ❌ | detik, default 900 (15 menit), `0` = tanpa batas |

Respons `201`:
```json
{
  "invoice_id": "inv_0d64b7bd8993",
  "amount": 15000,
  "charged_amount": 15059,
  "reference": "ORD-001",
  "status": "pending",
  "expires_at": "2026-08-09T07:55:00+00:00",
  "expires_in": 900,
  "qris_payload": "000201010212...",
  "qris_url": "https://odnezlijimaobxuxmmvt.supabase.co/functions/v1/qris?invoice_id=inv_0d64b7bd8993"
}
```

Error: `400` amount tidak valid · `401` secret salah.

### `GET /qris?invoice_id=<id>` — gambar QR dinamis *(publik)*

PNG QR dengan nominal `charged_amount` terisi. Hanya untuk invoice berstatus `pending`; selain itu `404`.

### `POST /hook` — webhook dari aplikasi Android

Mencocokkan `payment.amount` ke invoice pending (yang belum kadaluarsa) dengan nominal sama → `paid` + konfirmasi bot + callback.

Respons: `{"ok": true, "matched": "<invoice_id>"}` — `matched: null` jika tidak ada yang cocok (pembayaran tak dikenal → alert ⚠️ ke bot).

### `POST /bot` — webhook Telegram

Dikenali lewat header `X-Telegram-Bot-Api-Secret-Token`. Perintah:

| Perintah | Fungsi |
|---|---|
| `/start` `/help` | panduan |
| `/pay <nominal>` atau ketik angka | buat invoice → kirim QR + nominal bayar |
| `/status <invoice_id>` | cek status |
| `/cancel <invoice_id>` | batalkan (QR dihapus dari chat) |

Konfirmasi otomatis setelah lunas: `✅ Lunas!` + invoice + nominal.

### `POST /expiry` — sweep kadaluarsa

Dipanggil pg_cron tiap menit (via pg_net). Invoice lewat `expires_at` → `expired`, pesan QR dihapus dari chat, user dikabari.

### `GET /health` — health check *(publik)*

`{"ok": true}` — dipakai cron-job.org agar proyek tidak ter-pause (Supabase free men-pause proyek setelah 7 hari tanpa aktivitas).

---

## Callback saat lunas

`POST` ke `callback_url` dengan header `X-Callback-Secret`:
```json
{
  "invoice_id": "inv_0d64b7bd8993",
  "amount": 15059,
  "base_amount": 15000,
  "reference": "ORD-001",
  "status": "paid",
  "sender_name": null,
  "event_id": "332b98c4-...",
  "paid_at": "2026-08-09T08:02:30+00:00"
}
```

Fire-and-forget (tanpa retry). Riwayat lengkap tersimpan di tabel `events`.

### Alert pembayaran tak dikenal

QR yang sudah `expired`/`cancelled` atau bayar tanpa invoice → webhook masuk tapi tidak match → bot mengirim ke semua chat terdaftar:
> ⚠️ Pembayaran tanpa invoice aktif — Nominal: Rp50.000

---

## Kode unik (surcharge)

Supaya nominal tiap invoice pending unik (matching pasti), nominal QR = `amount + kode unik`:

- Maksimal **5%** dari nominal
- Cap **50** untuk nominal ≤ Rp10.000, cap **200** untuk > Rp10.000

| Nominal | Rentang kode | Beban maks |
|---|---|---|
| Rp100 | 1–5 | 5% |
| Rp1.000 | 1–50 | 5% |
| Rp10.000 | 1–50 | 0,5% |
| Rp100.000 | 1–200 | 0,2% |

Buyer membayar `charged_amount`; lunas hanya jika `payment.amount` sama persis.

---

## Kedaluwarsa

- Default 15 menit per invoice (`expires_in`)
- pg_cron tiap menit → `expiry` → status `expired`
- **Pesan QR di chat dihapus otomatis** + notifikasi kedaluwarsa
- Endpoint `/qris` → `404` untuk invoice non-pending
- Catatan: QR yang sudah ter-screenshot tetap bisa dibayar (standar EMVCo tanpa field expiry) — pembayaran telat itu tidak match dan memicu alert ⚠️

---

## Deploy

1. Buat proyek Supabase (region Singapore), jalankan `supabase/migrations/0001_init.sql`
2. Salin `supabase/.env.example` → `.env.local`, isi nilai → `supabase secrets set --env-file .env.local`
3. Deploy fungsi:
   ```bash
   supabase link --project-ref <REF>
   supabase functions deploy health invoice qris hook bot expiry --no-verify-jwt
   ```
4. Set webhook Telegram:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<REF>.supabase.co/functions/v1/bot&secret_token=<TG_SECRET_TOKEN>
   ```
5. Aplikasi Android: install APK, Notification access, webhook URL `.../functions/v1/hook` + secret
6. cron-job.org: ping `.../functions/v1/health` tiap 1 hari (anti-pause 7 hari)

---

## Struktur repo

```
app/                     # Aplikasi Android (fork + parser DANA)
supabase/
  functions/             # Edge Functions (Deno/TS)
    _shared/             # qris converter, telegram helper, invoice factory, http
    health invoice qris hook bot expiry/
  migrations/            # schema + cron
  .env.example           # template secrets
gateway/                 # implementasi Python lama (referensi/cadangan)
release/                 # APK signed
```

## Verifikasi APK

- APK SHA-256: `458979d8759663348a44114fb7e76f394128b685365304bb8384b9679b5bd3fc`
- Cert SHA-256: `b4de5253ed23dce66e6c580127999604fc0c3d4e91949421574240673b71021b`

Keystore & password tidak masuk repo. Lisensi: MIT (upstream).
