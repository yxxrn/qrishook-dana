# Deploy di HP (Termux) — HP = listener + gateway + bot + tunnel

Arsitektur: semua berjalan di HP Android, VPS tidak perlu nyala.
HP tetap wajib nyala (itu titik wajib sistem — DANA + QRIS Hook ada di sana), jadi
tidak ada dependensi tambahan.

```
HP Android
├── DANA app (terima pembayaran)
├── QRIS Hook app (hook notifikasi -> POST /hook)
└── Termux
    ├── gateway.py   :8080  (HTTP + SQLite, stdlib)
    ├── bot.py       :8081  (Telegram long-polling @Payyebot)
    └── cloudflared         (tunnel -> manhwashorts.masamba.web.id)
```

Webhook URL di app QRIS Hook **tidak berubah** (hostname sama via tunnel).

## Prasyarat (1x)

1. Install dari **F-Droid** (bukan Play Store — versi Play sudah deprecated):
   - [Termux](https://f-droid.org/packages/com.termux/)
   - [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) — start otomatis saat boot
   - [Termux:API](https://f-droid.org/packages/com.termux.api/) — wakelock
2. Buka Termux, update package repo:
   ```
   pkg update
   ```

## Setup

```bash
cd ~
# ambil script setup dari repo (private) — atau salin manual dari repo via laptop
# setelah file phone/setup.sh ada di ~/:
bash setup.sh
nano ~/.qris-env        # isi: QRIS_HOOK_SECRET, QRIS_BOT_TOKEN (lihat chat/README repo)
```

Salin file gateway ke ~/qris/:
```bash
mkdir -p ~/qris
cp ~/gateway.py ~/qris/    # dari repo: gateway/gateway.py
cp ~/bot.py ~/qris/        # dari repo: gateway/bot.py
cp ~/qris.py ~/qris/       # dari repo: gateway/qris.py
```

Jalankan:
```bash
sv-enable qris
sv up qris
termux-wake-lock
```

Cek:
```bash
sv status qris
curl -s http://127.0.0.1:8080/healthz
curl -s http://127.0.0.1:8080/healthz -H "X-Webhook-Secret: <secret>"
```

## Pengaturan baterai (WAJIB, kalau tidak mati saat screen off)

- Settings → Apps → Termux → **Battery → Unrestricted**
- Settings → Battery → exclude Termux dari optimasi (Doze)
- HP dicharge terus (colok listrik)
- `termux-wake-lock` sudah dipanggil di boot script

## Boot otomatis

Termux:Boot → buka sekali setelah install → `~/.termux/boot/start-qris.sh` sudah dibuat
oleh setup.sh → tiap HP restart, gateway + bot + tunnel nyala sendiri.

## Cutover dari VPS

1. Semua jalan di HP + `https://manhwashorts.masamba.web.id/healthz` OK
2. **Matikan tunnel di tencent2** (`sudo systemctl stop cf-qrishook`) — kalau dibiarkan, dua tunnel sama-sama jalan (HA, traffic terbagi — tidak masalah, tapi lebih bersih satu sumber)
3. VPS tencent2 bisa dimatikan

Catatan: database gateway (`~/qris/data/gateway.db`) baru di HP — riwayat invoice lama tidak ikut. Kalau mau dibawa: copy `gateway.db` + `events.jsonl` dari `/opt/qrishook-hook/data/` di tencent2.
