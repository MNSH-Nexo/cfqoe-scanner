# CFQoE Scanner

> سنجش واقعی کیفیت Cloudflare با WebSocket، بارگذاری صفحه و streaming — بدون رتبه‌بندی بر اساس TCP ping یا speed-test چندکانکشنی.

نسخهٔ **0.4.0** چهار مرحلهٔ کاربردی دارد و می‌تواند Browsing و Streaming را از داخل تونل واقعی VLESS اجرا کند:

```text
Eligibility → Xray/VLESS Tunnel → Browsing + Streaming → Overall Score
```

## قابلیت‌ها

### Eligibility

- WebSocket Upgrade واقعی روی Candidate IP با Host، SNI و Path کانفیگ
- Roundهای interleaved با ترتیب تصادفی
- success rate، median، p90 و MAD
- TCP connect فقط diagnostic است و در ranking دخالت ندارد

### Browsing

- Cold و Warm page load
- document و هشت asset کوچک/متوسط
- یک socket در HTTP/1.1
- multiplex روی یک TLS session در HTTP/2
- Browsing Score بر اساس success، cold، warm، TTFB p90 و MAD

### Streaming

- segmentهای چهارضانیه‌ای در پروفایل‌های 360p، 720p و 1080p
- دانلود ترتیبی روی یک session
- throughput هر segment و p10
- startup delay
- buffer simulation و rebuffer ratio
- safety factor برای sustainable bitrate
- توقف خودکار پس از پروفایل ناپایدار برای کاهش مصرف دیتا
- Streaming Score و Overall Score

### Logging و Debugging

- یک فایل NDJSON مستقل برای هر Run
- Run ID یکتا
- Levelهای debug، info، warn و error
- eventهای مرحله، Round، Candidate، Resource، Segment و Report
- redaction خودکار UUID، credential، password، token و VLESS URI
- فرمان `cfqoe diagnose` برای خلاصهٔ خطاها و کندترین eventها
- mode برابر `0600` برای لاگ و گزارش

### Real Tunnel / Xray

- یک Xray موقت برای هر Candidate و Observation
- SOCKS5 محلی روی `127.0.0.1` با پورت پویا
- اجرای Browsing و Streaming از همان تونل VLESS
- حذف قطعی config موقت در success و failure
- نگه‌داری UUID فقط در حافظه و redaction کامل لاگ/گزارش

## نیازمندی

- Node.js 20 یا جدیدتر
- Linux، macOS یا Termux
- بدون dependency زمان اجرا
- Xray Core فقط برای حالت `xray.enabled=true`

## نصب

```bash
unzip CFQoE-Scanner-v0.4.0.zip
cd cfqoe-scanner
npm test
sudo bash scripts/install.sh
cfqoe help
```

## نصب سریع روی سرور

> Repository عمومی است و Clone از طریق HTTPS بدون SSH Key انجام می‌شود.

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git \
  && cd cfqoe-scanner \
  && bash scripts/preflight.sh \
  && bash scripts/install.sh \
  && cfqoe help
```

برای حالت Real Tunnel، پس از نصب Xray Core:

```bash
cp config/scanner.example.json config/scanner.json
nano config/scanner.json
nano config.secret.uri
chmod 600 config.secret.uri
cfqoe scan --config ./config/scanner.json --vless-file ./config.secret.uri --xray --debug
```

## تنظیم اولیه

```bash
cp config/scanner.example.json config/scanner.json
nano config/scanner.json
```

کانفیگ VLESS را داخل فایل خصوصی قرار بده:

```bash
nano config.secret.uri
chmod 600 config.secret.uri
```

اجرا:

```bash
cfqoe scan \
  --config ./config/scanner.json \
  --vless-file ./config.secret.uri
```

فایل‌های `*.uri` و `*.secret.json` در `.gitignore` هستند و credential وارد گزارش یا لاگ نمی‌شود.

## حالت Real Tunnel

در `config/scanner.json` فعال کن:

```json
{
  "xray": {
    "enabled": true,
    "path": "auto",
    "limit": 8,
    "rounds": 2,
    "concurrency": 2,
    "startupTimeoutMs": 6000,
    "shutdownGraceMs": 1500
  }
}
```

سپس Xray باید در `PATH`، متغیر `XRAY_PATH`، مسیر صریح `xray.path` یا `bin/xray` موجود باشد. اجرای حالت تونل بدون `--vless-file` رد می‌شود.

```bash
cfqoe scan --config ./config/scanner.json --vless-file ./config.secret.uri --xray
```

راهنمای کامل: [Real Tunnel / Xray](docs/XRAY_MODE.md)

## Controlled Origin

```bash
cfqoe-origin --host 127.0.0.1 --port 8080
```

Endpointها:

```text
/healthz
/cfqoe/manifest.json
/cfqoe/page.html
/cfqoe/assets/*
/cfqoe/stream/manifest.json
/cfqoe/stream/<quality>/segment-<n>.bin
```

این مسیرها را با reverse proxy پشت یک hostname دارای Proxy روشن Cloudflare قرار بده. راهنما در [Origin Deployment](docs/ORIGIN_DEPLOYMENT.md) است.

## Streaming config

```json
{
  "streaming": {
    "enabled": true,
    "host": "probe.example.com",
    "port": 443,
    "security": "tls",
    "protocol": "h2",
    "manifestPath": "/cfqoe/stream/manifest.json",
    "profiles": ["360p", "720p", "1080p"],
    "limit": 10,
    "rounds": 2,
    "startupBufferSec": 8,
    "safetyFactor": 1.25,
    "stopOnUnsustainable": true,
    "timeoutMs": 20000
  }
}
```

## Logging

```bash
# لاگ استاندارد
cfqoe scan --config ./config/scanner.json

# دیباگ کامل resource و segment
cfqoe scan --config ./config/scanner.json --debug

# تشخیص خودکار
cfqoe diagnose --log ./out/logs/run-....ndjson
```

راهنمای کامل: [Logging & Diagnostics](docs/LOGGING.md)

## امتیازها

### Browsing Score

| مؤلفه | وزن |
|---|---:|
| موفقیت resource | 40% |
| Cold page | 15% |
| Warm page | 20% |
| TTFB p90 | 15% |
| Page MAD | 10% |

### Streaming Score

| مؤلفه | وزن |
|---|---:|
| موفقیت segment | 35% |
| Startup delay | 15% |
| Rebuffer ratio | 30% |
| Sustainable bitrate | 20% |

### Overall Score

```text
45% Browsing + 40% Streaming + 15% Eligibility reliability
```

فقط metricهای موجود وارد وزن نهایی می‌شوند و دادهٔ خام برای ممیزی حفظ می‌شود.

## تست

```bash
npm run check
npm test
```

## مستندات

- [Architecture](docs/ARCHITECTURE.md)
- [Methodology](docs/METHODOLOGY.md)
- [Origin Deployment](docs/ORIGIN_DEPLOYMENT.md)
- [Logging & Diagnostics](docs/LOGGING.md)
- [Security](docs/SECURITY.md)
- [Real Tunnel / Xray](docs/XRAY_MODE.md)
- [Server Test Checklist](docs/SERVER_TEST.md)

## مجوز

MIT
