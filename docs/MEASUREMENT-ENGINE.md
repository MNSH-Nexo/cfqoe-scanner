# Measurement Engine (0.8.3)

این سند توضیح می‌دهد CFQoE چقدر اندازه می‌گیرد، چه زمانی متوقف می‌شود و چطور میزان اعتماد به نتیجه را گزارش می‌کند.

## 1. عدم‌قطعیت

برای موفقیت‌های `s` از `n` تلاش، بازه Wilson 95% در `eligibility.confidence95` ذخیره می‌شود. رتبه‌بندی محافظه‌کارانه از کران پایین استفاده می‌کند تا نمونه‌های کم به‌خاطر شانس بالا نیایند.

## 2. Confidence labels

هر کاندید بر اساس تعداد نمونه و پراکندگی زمانی برچسب `provisional`، `low`، `medium` یا `high` می‌گیرد. برچسب high به معنی پایداری اندازه‌گیری است، نه خوب بودن IP.

## 3. Adaptive verification

Finalistها با SPRT و مقادیر پیش‌فرض `p0=0.60`، `p1=0.90`، `alpha=0.05` و `beta=0.10` تأیید می‌شوند. تصمیم‌های `accept`، `reject` و `inconclusive` همراه تعداد roundها ذخیره می‌شوند.

## 4. Hard/soft failures

خطاهای endpoint مثل 403، TLS و protocol failure سخت‌اند. timeout، reset و خطاهای موقت transport retryable هستند و به صف delayed retry می‌روند.

## 5. Concurrency calibration

قبل از sweep، یک control سالم انتخاب و همان target در concurrencyهای افزایشی اندازه‌گیری می‌شود. محدودیت‌ها شامل inflation ده درصدی latency، افزایش دو درصدی failure rate و event-loop lag پنجاه میلی‌ثانیه دسکتاپ/هشتاد میلی‌ثانیه Android هستند.

## 6. Streaming

- پیش‌فرض Full: چهار segment دسکتاپ و سه segment Android.
- Research: شش segment؛ P10 فقط با حداقل 29 نمونه.
- harmonic mean برای نمونه‌های کم.
- فقط segment موفق وارد playable buffer می‌شود.
- startup شامل manifest، variant، init segment و key است.
- `fixed` rendition نزدیک bitrate هدف و `lowest` پایین‌ترین rendition را انتخاب می‌کند؛ شبیه‌سازی ABR کامل ادعا نمی‌شود.
- سقف runtime: 12 MiB دسکتاپ و 8 MiB Android.

## 7. Web Transfer

این مرحله معیار انتقال HTTP است، نه مرورگر کامل. پیش‌فرض یک socket برای هر host و سقف runtime پنج MiB دسکتاپ/سه MiB Android است.

## 8. Real Load

مرحله بار، دانلود و آپلود واقعی، latency زیر بار، shaping، fan-out و RPM را اندازه می‌گیرد. سقف دانلود 24 MiB دسکتاپ و 12 MiB Android است. flow، upload flow و control stage در Full و Hard Scan به probe منتقل می‌شوند.

## 9. Partial evidence

ردیف eligibility-only بدون امتیاز QoE می‌ماند. اگر حداقل یک مؤلفه واقعی اندازه‌گیری شده ولی همه مراحل کامل نباشند، نتیجه `partial`، مؤلفه‌های گمشده و امتیاز حداکثر 70 دارد. نتایج complete همیشه بالاتر رتبه می‌گیرند.

## 10. Profiles

| Profile | Candidates | Rounds | Streaming samples | Verification |
| --- | --- | --- | --- | --- |
| Quick | 16 | 2 | 2 | shortened |
| Full | 120 | 3 | 4 | SPRT, 20 finalists |
| Research | 240+ | 6+ | 6 | SPRT, 24 finalists |
| Hard | catalog | screening + verification | 4 default | SPRT + delayed retry |

## 11. Traffic accounting

`estimateTrafficBytes(settings)` از سقف‌های واقعی استفاده می‌کند. `measurement.bytesMeasured` مصرف هر کاندید و `totals.bytesMeasured` مصرف run را ثبت می‌کنند.

## 12. Run-relative scope

گزارش‌ها `scope: "run-relative"` دارند. مقایسه امتیاز میان دستگاه، ISP یا زمان‌های متفاوت جزو ادعای روش نیست.
