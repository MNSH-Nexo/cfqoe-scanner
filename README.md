# CFQoE Scanner

اسکنر حرفه‌ای IPهای کلودفلر بر اساس **کیفیت واقعی تجربه کاربر**؛ نه صرفاً ping، نه TCP connect و نه speedtest چنداتصالی و مصنوعی.

CFQoE Scanner روی **Windows، Linux و Android/Termux** اجرا می‌شود و IPها را با WebSocket واقعی، تونل واقعی Xray، انتقال واقعی HTTP و استریم HLS رتبه‌بندی می‌کند.

از نسخه **0.7.0** هر کاندید با **چند ده مگابایت ترافیک واقعی** سنجیده می‌شود (نه چند صد کیلوبایت) و امتیازها با **گیت‌های مطلق** سقف‌گزاری می‌شوند؛ IP‌ای که زیر بار واقعی خفه شود، دیگر نمی‌تواند ۹۰ بگیرد.

از نسخه **0.6.0** این ابزار دیگر یک pipeline خطی نیست؛ یک **سامانه اندازه‌گیری تطبیقی با عدم‌قطعیت آماری** است: هر عدد همراه با بازه اطمینان، برچسب اعتماد و وضعیت کامل/ناقص بودن گزارش می‌شود.

## ویژگی‌ها

- پشتیبانی از Windows، Linux و Android/Termux بدون نیاز به سرور
- پشتیبانی از VLESS + WebSocket
- دانلود خودکار نسخه رسمی و مناسب Xray
- بازه اطمینان Wilson و امتیاز محافظه‌کارانه برای هر IP
- تأیید تطبیقی نتایج با آزمون SPRT
- کالیبراسیون concurrency قبل از اسکن
- مرحله Real Load برای سنجش shaping، latency زیر بار، fan-out و آپ‌لینک
- سقف‌گزاری امتیاز با گیت‌های مطلق و برچسب نهایی `verdict`
- تفکیک خطای سخت و نرم + صف retry تأخیری
- ثبت POP کلودفلر (`cf-ray`)
- استریم با rendition ثابت هدف یا حالت محافظه‌کارانه `lowest` (بدون ادعای ABR کامل)
- گزارش JSON (schema 9)، رتبه‌بندی متنی و لاگ ساخت‌یافته
- محافظت محلی از URI و حذف اطلاعات حساس از گزارش‌ها

---

# نصب سریع

## Windows

پیش‌نیاز: Node.js 20 یا بالاتر.

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
```

سپس `Start-CFQoE.cmd` را اجرا کنید.

## Linux

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
chmod +x start-cfqoe.sh
./start-cfqoe.sh
```

## Android با Termux

> پروژه را داخل Home ترموکس نگه دارید، نه Download یا `/sdcard`.

```bash
pkg update -y && pkg install -y git && git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git && cd cfqoe-scanner && bash install-termux.sh
```

اجرای دفعات بعد:

```bash
cd ~/cfqoe-scanner
./start-cfqoe.sh
```

راهنمای کامل: [docs/ANDROID-TERMUX.md](docs/ANDROID-TERMUX.md)

---

# شروع کار

1. برنامه را با لانچر سیستم‌عامل اجرا کنید.
2. وارد `VLESS Configuration` شوید و URI را وارد کنید.
3. `System Check` را اجرا کنید.
4. ابتدا `Quick Scan` بزنید.
5. نتیجه را از `Best IPs` ببینید.
6. برای پوشش وسیع‌تر Full Scan، برای عدد قابل دفاع Research Scan و برای جست‌وجوی طولانی Hard Deep Scan را اجرا کنید.

## منوی اصلی

```text
1. Quick Scan
2. Full Scan
3. Research Scan
4. Hard Deep Scan
5. Resume Hard Scan
6. VLESS Configuration
7. Workload Settings
8. System Check
9. Best IPs
10. Previous Results
11. Diagnostics
12. Scan Settings
0. Exit
```

در نسخه 0.8.3 ورود کانفیگ در مسیر گزینه 6 → 1، artefactهای clipboard ترموکس شامل bidi/zero-width، bracketed paste و wrapperهای نقل‌قول را پاک می‌کند. ورودی نامعتبر در همان مسیر دوباره درخواست می‌شود و فایل پس از ذخیره مجدداً خوانده و اعتبارسنجی می‌شود.

---

# تفاوت Quick، Full، Research و Hard

| حالت | تعداد IP | roundها | نمونه استریم | تأیید |
| --- | --- | --- | --- | --- |
| Quick | ۱۶ | ۲ | ۲ | کوتاه‌شده |
| Full | ۱۲۰ | ۳ | ۴ | SPRT روی ۲۰ finalist |
| Research | ۲۴۰+ | ۶+ | ۶ | SPRT روی ۲۴ finalist تا ۲۴ round |
| Hard | تمام catalog | screening + تأیید | ۴ پیش‌فرض | SPRT + retry تأخیری |

- **Quick** فقط screening است.
- **Full** حالت پیش‌فرض روزمره است.
- **Research** برای اندازه‌گیری دقیق‌تر و طولانی‌تر است.
- **Hard** کل catalog را range round-robin پیمایش می‌کند، checkpoint می‌سازد و با `Q` یا `Ctrl+C` امن متوقف می‌شود.

Hard Scan همچنین خطاهای گذرا را در صف retry نگه می‌دارد، finalistها را با SPRT تأیید می‌کند و از checkpoint قبلی ادامه می‌دهد.

---

# روش اندازه‌گیری

شرح کامل در [docs/MEASUREMENT-ENGINE.md](docs/MEASUREMENT-ENGINE.md) و [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Eligibility

برای هر IP یک WebSocket Upgrade واقعی با host، path و port کانفیگ کاربر انجام می‌شود. علاوه بر HTTP 101، هدرهای `Connection: Upgrade` و `Sec-WebSocket-Accept` اعتبارسنجی می‌شوند. TCP connect فقط برای diagnostics است.

## تأیید تطبیقی

`p0 = 0.60`، `p1 = 0.90`، `alpha = 0.05`، `beta = 0.10`. تصمیم `accept`، `reject` یا `inconclusive` در گزارش ذخیره می‌شود.

## Web Transfer Score

این معیار کیفیت انتقال HTTP قابل حمل است، نه QoE مرورگر. DOM، اجرای جاوااسکریپت و رندر وجود ندارد و یک socket برای هر host استفاده می‌شود.

در نسخه 0.8.3 سقف انتقال هر مشاهده واقعاً در runtime اعمال می‌شود: دسکتاپ ۱۰ asset و ۵ MiB؛ اندروید ۸ asset و ۳ MiB.

## Streaming

manifest واقعی HLS خوانده می‌شود و `EXT-X-MAP`، `EXT-X-KEY`، byte range و discontinuity پشتیبانی می‌شوند.

- نسخه 0.8.3 به‌صورت پیش‌فرض ۴ segment روی دسکتاپ و ۳ segment روی Android می‌سنجد.
- سقف بایت Streaming دسکتاپ ۱۲ MiB و اندروید ۸ MiB است.
- فقط segmentهای موفق به بافر قابل پخش اضافه می‌شوند.
- P10 فقط با حداقل ۲۹ نمونه گزارش می‌شود.
- `fixed` rendition نزدیک bitrate هدف و `lowest` پایین‌ترین rendition را انتخاب می‌کند.

## Real Load

مرحله Real Load دانلود و آپلود واقعی، latency زیر بار، fan-out، shaping و RPM را اندازه می‌گیرد. سقف دانلود دسکتاپ ۲۴ MiB و Android ۱۲ MiB است.

متریک‌های خروجی شامل `sustainedMbps`، `shapingRatio`، `idleRttMs`، `loadedRttMs`، `rpm`، `jitterMs`، `lossRate`، `fanoutSuccess` و `uplinkMbps` هستند.

## Overall Score

با فعال بودن Real Load:

- Web Transfer: ۳۰٪
- Streaming: ۳۰٪
- Real Load: ۲۵٪
- Reliability: ۱۵٪

اگر بخشی ناقص باشد، نتیجه `partial` و امتیاز آن حداکثر ۷۰ است. ردیف‌های کامل همیشه پیش از partial رتبه می‌گیرند؛ eligibility-only امتیاز QoE دریافت نمی‌کند.

## رتبه‌بندی run-relative

هر گزارش با `scope: "run-relative"` منتشر می‌شود. مقایسه امتیاز بین دو اجرا، دو دستگاه یا دو ISP پشتیبانی نمی‌شود.

---

# فایل‌های خروجی

```text
data/settings.json              تنظیمات کاربر (version 6)
data/config.secret.uri          کانفیگ محافظت‌شده
results/run-<id>.json           گزارش کامل (schema 9)
results/latest.json             آخرین گزارش
results/best-ips.txt            رتبه‌بندی متنی
results/hard-scan/*             checkpoint، صف retry و partial results
logs/run-<id>.ndjson            لاگ ساخت‌یافته
```

# حریم خصوصی و امنیت

- URI و UUID در گزارش‌ها و لاگ‌ها redact می‌شوند.
- داده‌ها فقط روی دستگاه کاربر ذخیره می‌شوند.
- فایل‌های موقت Xray حذف می‌شوند.
- فایل کانفیگ در Linux/Android permission محدود و در Windows ACL محدود دارد.
- نصب Xray بدون SHA-256 معتبر متوقف می‌شود.

# خط فرمان

```bash
cfqoe quick
cfqoe scan
cfqoe research
cfqoe hard
cfqoe resume
cfqoe check
cfqoe results
cfqoe diagnose
npm run xray:install
npm test
```

فلگ‌های مفید:

```bash
cfqoe scan --verify-limit 30
cfqoe scan --no-verify
cfqoe scan --no-retry
cfqoe scan --lowest-variant
cfqoe scan --no-load
cfqoe scan --load-duration 40
cfqoe scan --load-chunk-mb 4
```

# دقت نتایج

نتیجه به ISP، Wi-Fi یا اپراتور، ساعت تست، workload و شرایط لحظه‌ای شبکه وابسته است. بهترین کاربرد ابزار، رتبه‌بندی نسبی IPها روی همان دستگاه و همان اتصال در همان بازه زمانی است.

# لایسنس

این پروژه تحت **CFQoE Source-Available Attribution Non-Commercial License 1.0** منتشر می‌شود. متن کامل در [LICENSE](LICENSE) قرار دارد.
