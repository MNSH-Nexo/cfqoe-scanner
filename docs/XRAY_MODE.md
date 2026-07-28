# Real Tunnel / Xray Mode

در حالت عادی، Eligibility مستقیماً Candidate IP را بررسی می‌کند و workloadها می‌توانند مستقیم اجرا شوند. با `xray.enabled=true`، مرحله‌های Browsing و Streaming از داخل همان VLESS واقعی عبور می‌کنند؛ بنابراین امتیاز نهایی رفتار کاربر واقعی را بهتر منعکس می‌کند.

## جریان اجرا

```text
WebSocket Eligibility
        ↓
Temporary Xray for Candidate IP
        ↓
Local SOCKS5 on 127.0.0.1:<dynamic>
        ↓
Browsing + Streaming through VLESS
        ↓
Stop Xray and delete temporary config
        ↓
Schema-v4 report and Overall Score
```

## نصب Xray

Xray Core را از منبع رسمی سیستم‌عامل نصب کنید. CFQoE باینری خارجی دانلود نمی‌کند. ترتیب پیدا کردن باینری:

1. `xray.path` یا `--xray-path`
2. متغیر محیطی `XRAY_PATH`
3. `bin/xray` داخل پروژه
4. دستور `xray` در `PATH`

بررسی:

```bash
xray version
```

## تنظیمات

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

- `limit`: حداکثر Candidateهای واجد شرایط برای تست تونل.
- `rounds`: تعداد Observation واقعی برای هر Candidate.
- `concurrency`: تعداد Xrayهای هم‌زمان؛ برای VPS کوچک 1 یا 2 مناسب است.
- `startupTimeoutMs`: مهلت آماده‌شدن SOCKS.
- `shutdownGraceMs`: فرصت `SIGTERM` پیش از `SIGKILL`.

## اجرای امن

```bash
chmod 600 config.secret.uri
cfqoe scan \
  --config ./config/scanner.json \
  --vless-file ./config.secret.uri \
  --xray \
  --debug
```

حالت Xray بدون `--vless-file` اجرا نمی‌شود. URI کامل در گزارش ذخیره نمی‌شود. UUID فقط در حافظه و config موقت Xray قرار می‌گیرد؛ پوشهٔ موقت `0700` و فایل config `0600` است و در مسیر موفق، خطا یا timeout حذف می‌شود.

## گزارش و لاگ

Report schema v4 شامل metadata غیرحساس Xray و `tunnelObservations` است. eventهای مهم:

```text
xray.start
xray.ready
xray.stop
tunnel.probe.start
tunnel.probe.complete
```

برای تحلیل:

```bash
cfqoe diagnose --log ./out/logs/run-....ndjson
```

## پیشنهاد تست اولیه

برای کم‌کردن مصرف منابع و دیتا:

```bash
cfqoe scan \
  --config ./config/scanner.json \
  --vless-file ./config.secret.uri \
  --max 20 --rounds 2 \
  --xray-limit 3 --xray-rounds 1 \
  --debug
```

پس از تأیید Origin و Xray، limit و rounds را تدریجی افزایش دهید.
