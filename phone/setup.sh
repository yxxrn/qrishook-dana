#!/data/data/com.termux/files/usr/bin/bash
# Setup QRIS gateway di Termux. Jalankan: bash setup.sh
set -e
pkg update -y
pkg install -y python cloudflared termux-services termux-api openssh
pip install --upgrade pip
pip install qrcode pillow

mkdir -p "$HOME/qris/data" "$HOME/.cloudflared" "$HOME/.termux/boot"

# env template
if [ ! -f "$HOME/.qris-env" ]; then
  cat > "$HOME/.qris-env" <<'ENV'
QRIS_HOOK_SECRET=GANTI_SECRET
QRIS_HOOK_DATA=/data/data/com.termux/files/home/qris/data
QRIS_HOOK_PORT=8080
QRIS_ALERT_URL=http://127.0.0.1:8081/cb-bot
QRIS_BOT_TOKEN=GANTI_TOKEN
GATEWAY_SECRET=GANTI_SECRET
GATEWAY_URL=http://127.0.0.1:8080
QRIS_PUBLIC_URL=https://manhwashorts.masamba.web.id
CALLBACK_PORT=8081
ENV
  chmod 600 "$HOME/.qris-env"
  echo "EDIT dulu: nano ~/.qris-env (isi secret & token)"
fi

# tunnel credentials template
if [ ! -f "$HOME/.cloudflared/c25233a9-92b4-4b2b-892b-8f3c79c70ef3.json" ]; then
  cat > "$HOME/.cloudflared/c25233a9-92b4-4b2b-892b-8f3c79c70ef3.json" <<'CFG'
{"AccountTag": "da8b3d9cbfe2040a44deb14ba5477051", "TunnelSecret": "Pv4mZxQk5lW5cF4QeVBGDtmBDjjUr9kQWIYu0nnXe30=", "TunnelID": "c25233a9-92b4-4b2b-892b-8f3c79c70ef3"}
CFG
  chmod 600 "$HOME/.cloudflared/c25233a9-92b4-4b2b-892b-8f3c79c70ef3.json"
  echo "Tunnel credentials ditulis (rahasia! jangan dishare)"
fi

cat > "$HOME/.cloudflared/config.yml" <<'YML'
tunnel: c25233a9-92b4-4b2b-892b-8f3c79c70ef3
credentials-file: /data/data/com.termux/files/home/.cloudflared/c25233a9-92b4-4b2b-892b-8f3c79c70ef3.json
no-autoupdate: true

ingress:
  - hostname: manhwashorts.masamba.web.id
    service: http://127.0.0.1:8080
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
YML

# service runit
SVC="$PREFIX/var/service/qris"
mkdir -p "$SVC"
cat > "$SVC/run" <<'RUN'
#!/data/data/com.termux/files/usr/bin/bash
source "$HOME/.qris-env"
cd "$HOME/qris"
python gateway.py &
python bot.py &
cloudflared tunnel --no-autoupdate --config "$HOME/.cloudflared/config.yml" run c25233a9-92b4-4b2b-892b-8f3c79c70ef3 &
wait
RUN
chmod +x "$SVC/run"

# auto start saat boot (butuh Termux:Boot)
cat > "$HOME/.termux/boot/start-qris.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
sv-enable qris
sv up qris
BOOT
chmod +x "$HOME/.termux/boot/start-qris.sh"

echo "SELESAI. Langkah berikutnya:"
echo "1. nano ~/.qris-env      -> isi secret & bot token"
echo "2. cp gateway.py bot.py qris.py ke ~/qris/  (dari folder gateway/ repo ini)"
echo "3. sv-enable qris && sv up qris"
echo "4. termux-wake-lock"
echo "5. Matikan battery optimization untuk Termux"
