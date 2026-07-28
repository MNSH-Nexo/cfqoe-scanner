# Measurement Methodology

## Eligibility

برای هر IP اتصال مستقیم ساخته و WebSocket Upgrade واقعی روی Host، SNI، Port و Path اجرا می‌شود. فقط پاسخ `101 Switching Protocols` موفق است. TCP connect در ranking استفاده نمی‌شود.

## Browsing

Manifest روی session جدا دریافت می‌شود. سپس Cold و Warm page load با document و assetها اجرا می‌شود. HTTP/2 روی یک TLS session multiplex و HTTP/1.1 روی یک socket محدود می‌شود.

## Streaming

پروفایل‌ها از bitrate پایین به بالا آزمایش می‌شوند. segmentها ترتیبی و روی یک session دریافت می‌شوند.

برای هر segment:

```text
throughput Mbps = bytes × 8 ÷ download seconds ÷ 1,000,000
```

به‌جای میانگین، p10 throughput استفاده می‌شود. پروفایل زمانی sustainable است که:

1. همهٔ segmentها موفق باشند.
2. playback پس از Startup Buffer آغاز شود.
3. rebuffer صفر باشد.
4. throughput p10 حداقل `bitrate × safetyFactor` باشد.

اگر پروفایل sustainable نباشد، پروفایل‌های سنگین‌تر به‌طور پیش‌فرض تست نمی‌شوند.

## Buffer simulation

پیش از شروع playback، segmentها تا رسیدن buffer به `startupBufferSec` دانلود می‌شوند. پس از شروع، زمان دانلود هر segment از buffer کم می‌شود. اگر زمان دانلود بیشتر از buffer باشد، اختلاف آن stall محسوب می‌شود.

```text
rebuffer ratio = total stall seconds ÷ tested video seconds
```

## آمار مقاوم

- Median برای تجربهٔ معمول
- P90 برای شرایط ضعیف‌تر
- P10 برای throughput محافظه‌کارانه
- MAD برای نوسان
- چند Round با ترتیب interleaved

## امتیاز نهایی

```text
Overall = 45% Browsing + 40% Streaming + 15% Eligibility
```

اگر یک workload غیرفعال باشد، وزن metricهای موجود normalize می‌شود. تمام observationها و جزئیات segmentها در JSON و لاگ ساختاریافته حفظ می‌شوند.

## محدودیت تفسیر

نتیجه مخصوص شبکه، ISP، زمان، Candidate IP، Host/SNI، protocol و workload همان اجراست. نتیجهٔ یک اپراتور نباید به همهٔ کاربران تعمیم داده شود.
