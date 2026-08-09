# AGENTS.md — Panduan Deploy untuk AI Agent

Repo: **QRIS Payment Gateway** — menerima pembayaran QRIS (DANA) via hook notifikasi Android, memproses invoice di Supabase, konfirmasi otomatis via Telegram bot.

Baca dokumen ini sebelum melakukan apa pun. Semua nilai rahasia (`<SECRET>`, `<TOKEN>`, `<PROJECT_REF>`, `<SERVICE_ROLE_KEY>`, `<TG_SECRET_TOKEN>`) **wajib diminta dari pemilik** — tidak pernah ada di repo.

---

## 1. Arsitektur singkat

```
HP Android (DANA + QRIS Hook app) --POST /hook--> Supabase Edge Functions
                                                    ├─ Postgres (invoices, tg_chats, events)
                                                    ├─ Telegram bot (webhook mode)
                                                    └─ pg_cron -> /expiry (tiap menit)
Buyer --scan QR dinamis--> bayar --> notifikasi DANA --> hook --> paid --> konfirmasi bot
```

- Base URL: `https://<PROJECT_REF>.supabase.co/functions/v1/`
- Runtime: Deno/TypeScript (Edge Functions), Postgres, pg_cron + pg_net
- Semua endpoint dilindungi header `X-Webhook-Secret` (kecuali `/bot` yang pakai `X-Telegram-Bot-Api-Secret-Token`; `/qris` pakai token HMAC `&t=`)

## 2. Prasyarat (minta ke pemilik)

| Item | Keterangan |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | token akun Supabase (`sbp_...`) |
| `PROJECT_REF` | id proyek Supabase, region Singapore (contoh: `odnezlijimaobxuxmmvt`) |
| `SERVICE_ROLE_KEY` | dari Dashboard → Project Settings → API Keys |
| `QRIS_HOOK_SECRET` | secret webhook (sama dengan yang diisi di app Android) |
| `QRIS_BOT_TOKEN` | token bot Telegram |
| `TG_SECRET_TOKEN` | string acak untuk verifikasi webhook Telegram |

Pemilik juga harus: punya proyek Supabase (free), akun cron-job.org, HP dengan app QRIS Hook terpasang.

## 3. Deploy

### 3.1 Database

Jalankan `supabase/migrations/0001_init.sql` — via SQL Editor di dashboard, atau Management API:

```bash
curl -s -m 30 "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -X POST -d "{\"query\": \"$(cat supabase/migrations/0001_init.sql | tr '\n' ' ' | sed "s/<PROJECT_REF>/$PROJECT_REF/g; s/<QRIS_HOOK_SECRET>/$QRIS_HOOK_SECRET/g")\"}"
```

Catatan: endpoint `/database/query` kadang menolak request dari library HTTP tertentu dengan 403 — pakai `curl` dengan `-d` JSON murni. Untuk SQL berisi `$net$...$net$`, tulis SQL ke file lalu generate JSON via python (`json.dumps`) dan kirim `--data @file.json`.

### 3.2 Fungsi Edge

```bash
# CLI (pakai registry npmjs jika mirror lokal menolak):
npm install -g supabase --registry=https://registry.npmjs.org
export SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN
cd supabase
supabase link --project-ref $PROJECT_REF
supabase secrets set --env-file .env.local   # buat dari .env.example
supabase functions deploy health invoice qris hook bot expiry --no-verify-jwt
```

`.env.local` (dari `.env.example`, **jangan commit**):
```
SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
QRIS_HOOK_SECRET=<QRIS_HOOK_SECRET>
QRIS_BOT_TOKEN=<QRIS_BOT_TOKEN>
TG_SECRET_TOKEN=<TG_SECRET_TOKEN>
QRIS_PUBLIC_URL=https://<PROJECT_REF>.supabase.co
```
`SUPABASE_URL` di-inject otomatis oleh runtime — tidak perlu di-set.

### 3.3 Webhook Telegram

```bash
curl "https://api.telegram.org/bot$QRIS_BOT_TOKEN/setWebhook?url=https://$PROJECT_REF.supabase.co/functions/v1/bot&secret_token=$TG_SECRET_TOKEN"
```

### 3.4 Aplikasi Android

- APK siap pakai: `release/qrishook-1.2.0-dana.apk` (signed, verifikasi hash di README)
- Setup HP: install → izinkan Notification access → Webhook URL `https://<PROJECT_REF>.supabase.co/functions/v1/hook` → Secret = `QRIS_HOOK_SECRET` → pilih merchant **DANA** → aktifkan QRIS Hook Active. Debug mode harus OFF.
- Untuk build ulang APK (perlu keystore dari pemilik, tidak ada di repo): lihat README.

### 3.5 Anti-pause (wajib untuk free tier)

Supabase free men-pause proyek setelah 7 hari tanpa aktivitas. cron-job.org (akun pemilik) harus mem-ping `https://<PROJECT_REF>.supabase.co/functions/v1/health` minimal tiap 3 hari, method `POST`, custom header `X-Webhook-Secret: <QRIS_HOOK_SECRET>` → harapannya `200`.

## 4. Verifikasi

```bash
BASE=https://$PROJECT_REF.supabase.co/functions/v1
# health
curl -s -H "X-Webhook-Secret: $QRIS_HOOK_SECRET" $BASE/health          # {"ok":true}
# invoice -> qris_payload harus mengandung "010212" (dynamic)
curl -s -X POST $BASE/invoice -H "X-Webhook-Secret: $QRIS_HOOK_SECRET" \
  -H "Content-Type: application/json" -d '{"amount":1000}'
# qris PNG (ambil qris_url dari respons invoice)
curl -s -o /tmp/qr.png "<qris_url>" && file /tmp/qr.png                 # PNG image
# hook simulasi bayar (charged_amount dari respons invoice)
curl -s -X POST $BASE/hook -H "X-Webhook-Secret: $QRIS_HOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"event_id":"test-1","payment":{"amount":<charged_amount>},"notification":{"source_package":"id.dana"}}'
# -> {"ok":true,"matched":"<invoice_id>"} lalu GET status via REST (service_role) atau cek bot
```

## 5. Perilaku sistem (penting diketahui agent)

- **Surcharge**: nominal QR = base + kode unik (maks 5%, cap 50 untuk ≤10.000 / 200 untuk >10.000) — supaya nominal tiap invoice pending unik.
- **Kedaluwarsa**: default 15 menit (`expires_in`); pg_cron tiap menit → `/expiry` → status `expired`, pesan QR dihapus dari chat Telegram, endpoint `/qris` → 404. QR yang ter-screenshot tetap bisa dibayar → alert ⚠️ unmatched.
- **Matching**: hanya nominal sama persis dengan invoice pending yang belum expired; invoice tertua menang.
- **Callback**: `callback_url` di-POST saat lunas, header `X-Callback-Secret`, fire-and-forget tanpa retry. Riwayat lengkap di tabel `events`.
- **Bot**: `/pay <nominal>`, `/status <id>`, `/cancel <id>`; chat terdaftar otomatis di `tg_chats` (untuk alert).
- **RLS aktif** di semua tabel — akses REST hanya via service_role; anon ditolak.

## 6. Troubleshooting

| Gejala | Penyebab/Solusi |
|---|---|
| Deploy fungsi: `Entrypoint path does not exist` | fungsi harus di `supabase/functions/<name>/index.ts`, bukan `functions/` |
| `supabase secrets set` skip `SUPABASE_URL` | normal — di-inject runtime |
| `/database/query` 403 dari python | pakai curl (lihat 3.1) |
| npm `EALLOWREMOTE` | registry mirror menolak → `--registry=https://registry.npmjs.org` |
| Bot tidak menjawab | cek `getWebhookInfo` (pending/last error); jangan pakai polling bersamaan dengan webhook |
| Bot kirim QR gagal / "mati" diam-diam | ubah `_shared/` → **redeploy semua fungsi yang mengimpornya** (mis. `_shared/invoice.ts` dipakai `invoice` + `bot`; shared module di-bundle per fungsi saat deploy) |
| Invoice tidak match | cek status invoice (`expired`?), nominal webhook = `charged_amount` |
| Proyek ter-pause | ping `/health` berhenti → aktifkan kembali lewat dashboard; perbaiki cron-job.org |

## 7. Struktur

```
app/                    Android (fork qrishook + parser DANA)
supabase/
  functions/            Edge Functions + _shared (qris converter, telegram, invoice)
  migrations/           schema + cron
  .env.example          template secrets
gateway/                legacy Python (referensi saja, tidak dipakai)
release/                APK signed
```

## 8. Keamanan

- Jangan pernah commit `.env.local`, keystore, atau nilai secret apa pun.
- `STATIC_PAYLOAD` di `supabase/functions/_shared/qris.ts` = payload QRIS merchant milik pemilik — jangan ubah tanpa izin (QRIS tidak akan berfungsi).
- Repo publik: jangan menambahkan rahasia baru ke README/dokumen.
