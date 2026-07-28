# Structured Logging & Diagnostics

CFQoE برای هر scan یک فایل NDJSON مستقل می‌سازد. نسخهٔ 0.3.1 این لاگ را در تست سرتاسری کامل نیز اعتبارسنجی می‌کند. هر خط یک JSON معتبر است و می‌تواند با `jq`، Loki، Vector یا ابزارهای سادهٔ خط فرمان تحلیل شود.

## محل و سطح لاگ

```json
{
  "logging": {
    "level": "info",
    "directory": "../out/logs"
  }
}
```

سطح‌ها:

- `debug`: شروع/پایان taskها، segmentها و resourceهای صفحه
- `info`: تغییر مرحله، خلاصهٔ probeها، Roundها و گزارش‌ها
- `warn`: timeout، پاسخ نامعتبر و رد candidate
- `error`: خطاهای مرحله‌ای و توقف scan

برای بازتولید مشکل:

```bash
cfqoe scan --config ./config/scanner.json --debug
```

یا:

```bash
cfqoe scan --config ./config/scanner.json \
  --log-level debug \
  --log-directory ./debug-logs
```

## ساختار event

```json
{
  "ts": "2026-07-28T17:00:00.000Z",
  "level": "info",
  "runId": "20260728170000-a1b2c3",
  "event": "stream.profile.complete",
  "component": "streaming",
  "ip": "104.16.0.1",
  "profile": "1080p",
  "durationMs": 1200
}
```

Eventهای کلیدی:

```text
scan.start / scan.target / scan.error
candidate.generated
scheduler.start / scheduler.round.start / scheduler.round.complete
ws.probe.complete / ws.probe.failed
page.manifest.ok / page.cold.complete / page.warm.complete / page.probe.error
stream.manifest.ok / stream.segment.complete / stream.profile.complete / stream.probe.error
report.written
```

## عیب‌یابی خودکار

```bash
cfqoe diagnose --log ./out/logs/run-....ndjson
```

خروجی شامل این موارد است:

- تعداد eventها بر اساس Level
- خطاها بر اساس error code
- خطوط خراب NDJSON
- کندترین eventها و IP مرتبط
- محدودهٔ زمانی و Run ID

خروجی JSON:

```bash
cfqoe diagnose --log ./out/logs/run-....ndjson --json
```

## حفاظت از اطلاعات حساس

Logger قبل از نوشتن، داده را recursively پاک‌سازی می‌کند:

- UUID و credential
- password و token
- authorization headers
- private keys
- URIهای VLESS
- Bufferهای باینری
- objectهای circular

رشته‌های بسیار بلند truncate می‌شوند. فایل لاگ با mode برابر `0600` و پوشه با `0700` ساخته می‌شود.

هنگام گزارش باگ، فایل NDJSON برای تشخیص مناسب است؛ با این حال قبل از انتشار عمومی، Hostnameها و IPهای خصوصی را نیز دستی بررسی کنید.
