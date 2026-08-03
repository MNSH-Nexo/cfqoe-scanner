# Changelog

## 0.8.4

### Fixed
- Full Scan دیگر بودجه سنگین Research را برای هر finalist اجرا نمی‌کند. Real Load دسکتاپ به ۱۲ MiB/۸ ثانیه و Android به ۸ MiB/۶ ثانیه محدود شده است.
- timeout نمونه latency زیر بار حداکثر ۳ ثانیه است؛ ping معلق دیگر پایان Tunnel را تا timeout کامل عقب نمی‌اندازد.
- `load.partial` که به معنی ناکافی‌بودن نمونه برای shaping یا uplink است دیگر warning تعاملی چاپ نمی‌کند و فقط در debug log ثبت می‌شود. شکست واقعی downlink همچنان `load.failed` است.
- نوار Tunnel زیرمرحله فعلی Web Transfer، Streaming یا Real Load را نمایش می‌دهد.
- تنظیمات نسخه ۶ با مقادیر پیش‌فرض سنگین، خودکار به تنظیمات سریع‌تر نسخه ۷ مهاجرت می‌کنند؛ مقادیر سفارشی کاربر حفظ می‌شوند.

### Changed
- Research Scan همچنان بودجه عمیق ۲۴ MiB/۱۲ ثانیه و شش flow را حفظ می‌کند.
- منوی Streaming نام صحیح `lowest` را نمایش می‌دهد.

## 0.8.3

- رفع ورود کانفیگ VLESS در Termux، اعمال calibration و traffic caps، اعتبارسنجی WebSocket و report schema 9.

## 0.7.0

- Real Load، absolute gates، shaping و latency-under-load.

## 0.6.0

- Wilson intervals، SPRT، calibration، delayed retry و run-relative ranking.
