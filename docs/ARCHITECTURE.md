# Architecture

## Pipeline

```text
CIDR ranges
   ▼
Stratified candidate sampling
   ▼
Interleaved WebSocket eligibility
   ▼
Hard reliability gate
   ▼
Cold/Warm page workload
   ▼
Segment streaming + buffer simulation
   ▼
Browsing / Streaming / Overall scores
   ▼
JSON + CSV + Top IPs + NDJSON diagnostics
```

## ماژول‌ها

- `candidate`: parsing و نمونه‌برداری کم‌حافظه IPv4
- `scheduler`: Roundهای interleaved و concurrency محدود
- `probe`: WebSocket eligibility
- `browsing`: H1/H2 client و page workload
- `streaming`: segment probe، buffer model و scoring
- `origin`: workload کنترل‌شدهٔ page و streaming
- `logging`: logger ساختاریافته، redaction و diagnostics
- `stats`: median، p90، p10 و MAD
- `report`: schema v3، CSV و top IPs
- `config`: استخراج metadata بدون انتشار credential
- `ui`: خروجی ترمینال

## اتصال‌ها

### HTTP/1.1

`maxSockets=1` است. درخواست‌های هم‌زمان منطقی روی یک socket صف می‌شوند تا throughput چندکانکشنی مصنوعی ساخته نشود.

### HTTP/2

یک TLS connection مستقیم به Candidate IP با SNI واقعی ساخته می‌شود. assetها و segmentها روی همان session multiplex یا به‌صورت ترتیبی دریافت می‌شوند.

## Streaming

پروفایل‌ها از سبک به سنگین اجرا می‌شوند. هر پروفایل چهار segment دارد. Buffer model پس از جمع‌شدن Startup Buffer، مصرف زمان playback را از buffer کم می‌کند و stall را ثبت می‌کند.

## Observability

هر Run یک شناسه و NDJSON اختصاصی دارد. Context در لایه‌های زیر افزوده می‌شود:

```text
run → stage → round → candidate → profile → segment
```

Info eventها برای جریان عادی کافی‌اند. Debug eventها جزئیات resource و segment را ثبت می‌کنند. Errorها به شکل ساختاریافته شامل name، message، code و stack هستند.

Logger مستقل از UI است؛ خاموش‌کردن رنگ یا تغییر ظاهر ترمینال روی قابلیت عیب‌یابی اثر ندارد.

## حفاظت داده

Credential فقط برای parse ورودی در حافظه استفاده می‌شود. target metadata وارد pipeline می‌شود، نه URI کامل. Logger نیز پیش از serialization یک redaction بازگشتی اجرا می‌کند.
