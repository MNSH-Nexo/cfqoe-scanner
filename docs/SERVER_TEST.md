# Server Test Checklist

## نقش سرور و کلاینت

- **Origin** روی سرور اجرا می‌شود.
- **Scanner** برای نتیجهٔ واقعی باید روی دستگاه یا شبکهٔ کاربر اجرا شود.

اجرای Scanner روی همان VPS فقط صحت فنی را تأیید می‌کند؛ نتیجهٔ آن مسیر دیتاسنتر تا Cloudflare است و کیفیت ISP کاربر را نشان نمی‌دهد.

## 1. بررسی بسته روی سرور

```bash
unzip CFQoE-Scanner-v0.4.0.zip
cd cfqoe-scanner
bash scripts/preflight.sh
sudo bash scripts/install.sh

# برای حالت Real Tunnel، Xray Core را نصب و بررسی کنید:
xray version
```

## 2. اجرای Origin آزمایشی

برای تست ساده بدون Nginx، از پورت Proxy‌شوندهٔ `8080` استفاده کنید:

```bash
nohup cfqoe-origin --host 0.0.0.0 --port 8080 > /var/log/cfqoe-origin.log 2>&1 &
```

در فایروال:

```bash
ufw allow 8080/tcp
```

بررسی محلی:

```bash
curl -i http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/cfqoe/stream/manifest.json
```

بررسی از بیرون با hostname دارای ابر نارنجی:

```bash
curl -i http://YOUR_DOMAIN:8080/healthz
```

## 3. تنظیم Scanner روی دستگاه کاربر

```bash
cp config/scanner.example.json config/scanner.json
nano config/scanner.json
```

برای تست اولیه، Browsing و Streaming را روی این مشخصات قرار دهید:

```json
{
  "host": "YOUR_DOMAIN",
  "port": 8080,
  "security": "none",
  "protocol": "h1"
}
```

بخش `target` همچنان باید Port و Path واقعی WebSocket کانفیگ VLESS را داشته باشد.

برای تست واقعی VLESS، `xray.enabled` را `true` کنید و مسیر باینری را `auto` یا مسیر صریح قرار دهید. سپس فایل خصوصی را کنترل کنید:

```bash
chmod 600 config.secret.uri
bash scripts/preflight.sh ./config/scanner.json ./config.secret.uri
```

## 4. تست کم‌مصرف اولیه

```bash
cfqoe scan \
  --config ./config/scanner.json \
  --vless-file ./config.secret.uri \
  --max 20 \
  --per-range 2 \
  --rounds 2 \
  --browsing-limit 5 \
  --browsing-rounds 1 \
  --streaming-limit 3 \
  --streaming-rounds 1 \
  --xray \
  --xray-limit 3 \
  --xray-rounds 1 \
  --debug
```

## 5. بررسی خروجی

```bash
cfqoe diagnose --log ./out/logs/run-....ndjson
cat ./out/latest.json
cat ./out/*.top.txt
```

در صورت خطا، این فایل‌ها برای Debug کافی‌اند:

```text
out/latest.json
out/logs/run-....ndjson
/var/log/cfqoe-origin.log
```

قبل از اشتراک عمومی، Hostname و IPهای خصوصی را دستی بررسی کنید؛ credentialها خودکار redacted می‌شوند.
