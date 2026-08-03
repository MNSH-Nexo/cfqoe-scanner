# Changelog

## 0.8.3

### Fixed
- ورودی گزینه 6 → 1 در Termux و سایر ترمینال‌ها اکنون نشانه‌های bidi/zero-width، bracketed paste و wrapperهای نقل‌قول را پاک‌سازی می‌کند، ورودی نامعتبر را در همان صفحه دوباره می‌پرسد و فایل ذخیره‌شده را مجدداً می‌خواند و اعتبارسنجی می‌کند.
- `scan.rounds` دوباره روی اسکن عادی اعمال می‌شود و calibration واقعی concurrency پیش از اسکن اجرا می‌شود.
- سقف بایت Web Transfer، Streaming و Real Load و همچنین flow/controlهای Hard Scan اکنون به probeها منتقل می‌شوند.
- entry point سرور probe با پیاده‌سازی `src/origin/server.js` دوباره قابل اجرا است.
- WebSocket 101 اکنون `Connection` و `Sec-WebSocket-Accept` را نیز اعتبارسنجی می‌کند.
- بررسی حفاظت فایل در Windows دیگر همیشه موفق گزارش نمی‌شود و ACL واقعی را می‌خواند.

### Changed
- نسخه تنظیمات 6 و نسخه برنامه 0.8.3 است.
- حالت گمراه‌کننده `abr` به `lowest` تغییر نام داده؛ alias قدیمی فقط برای سازگاری باقی مانده است.
- نصب خودکار Xray در نبود SHA-256 معتبر متوقف می‌شود.
- مجموعه تست‌ها به 137 تست افزایش یافت.

## 0.7.0

نسخه 0.6.0 آماری بود اما حجم اندازه‌گیری کوچک بود. 0.7.0 مرحله Real Load، گیت‌های مطلق، متریک‌های shaping و latency زیر بار، fan-out و uplink را اضافه کرد.

### Added
- مرحله Real Load و متریک‌های `sustainedMbps`، `shapingRatio`، `loadedRttMs`، `rpm`، `jitterMs`، `lossRate`، `fanoutSuccess` و `uplinkMbps`.
- گیت‌های مطلق و برچسب‌های verdict.
- تنظیمات بودجه و تخمین ترافیک.

## 0.6.0

- Wilson confidence intervals، امتیاز محافظه‌کارانه و برچسب اعتماد.
- تأیید تطبیقی SPRT، calibration، delayed retry و POP summaries.
- HLS prerequisites، buffer simulation و run-relative ranking.

## 0.5.0

- بازنویسی به ابزار دسکتاپ با منوی تعاملی، Windows، Android/Termux، browsing و streaming workloads.

## 0.4.0

- نسخه سرورمحور با VLESS tunnel probing و process management.
