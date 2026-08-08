# QRIS Hook (custom build — DANA)

Native Android app yang memantau notifikasi pembayaran QRIS dan meneruskannya ke webhook milik sendiri.

Fork dari [suriyadi15/qrishook](https://github.com/suriyadi15/qrishook) (MIT), dibuat ulang dengan satu perubahan:

- **Parser DANA (`id.dana`)** ditambahkan — mem-parse notifikasi format:
  `Rp<amount> diterima [dari] <sender>` → amount + senderName.

## Setup

1. Install `release/qrishook-1.2.0-dana.apk` (Android 8+).
2. Izinkan Notification access.
3. Isi Webhook URL (HTTPS) + Secret (dikirim sebagai header `X-Webhook-Secret`).
4. Pilih merchant **DANA** → aktifkan QRIS Hook Active.
5. Test: terima pembayaran QRIS → cek endpoint webhook.

## Build ulang

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

## Verifikasi APK

- SHA-256: `458979d8759663348a44114fb7e76f394128b685365304bb8384b9679b5bd3fc`
- Cert SHA-256: `b4de5253ed23dce66e6c580127999604fc0c3d4e91949421574240673b71021b`

Verifikasi fingerprint cert yang sama di setiap update.

## Catatan

Keystore (`~/qrishook-dana.jks`) & password **tidak** masuk repo.
Hanya digunakan untuk device/akun milik sendiri.

## Gateway & Bot Telegram

Server: `gateway/gateway.py` (tencent2) + `gateway/bot.py` (Telegram @Payyebot).

- Bot: kirim nominal → invoice + QR dinamis → bayar → konfirmasi otomatis.
- Command: `/pay <nominal>`, `/status <id>`, `/cancel <id>`, `/start`.
- Invoice default berlaku 15 menit (`expires_in` detik per invoice, 0 = tanpa batas; status otomatis `expired`).
- Nominal QR = base + kode unik 1-100 → matching pasti.
- Callback ke `callback_url` saat lunas (header `X-Callback-Secret`).