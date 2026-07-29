# CFQoE Scanner

اسکنر حرفه‌ای IPهای کلودفلر بر اساس **کیفیت واقعی تجربه کاربر**؛ نه صرفاً ping، نه TCP connect و نه speedtest چنداتصالی و مصنوعی.

CFQoE Scanner روی **Windows، Linux و Android/Termux** اجرا می‌شود و IPها را با WebSocket واقعی، تونل واقعی Xray، انتقال واقعی HTTP و استریم HLS رتبه‌بندی می‌کند.

از نسخه **0.6.0** این ابزار دیگر یک pipeline خطی نیست؛ یک **سامانه اندازه‌گیری تطبیقی با عدم‌قطعیت آماری** است: هر عدد همراه با بازه اطمینان، برچسب اعتماد و وضعیت کامل/ناقص بودن گزارش می‌شود.

## ویژگی‌ها

- پشتیبانی از Windows، Linux و Android/Termux بدون نیاز به سرور
- پشتیبانی از VLESS + WebSocket
- دانلود خودکار نسخه رسمی و مناسب Xray
- بازه اطمینان Wilson و امتیاز محافظه‌کارانه برای هر IP
- تأیید تطبیقی نتایج با آزمون SPRT (نمونه‌گیری فقط تا رسیدن به تصمیم قطعی)
- کالیبراسیون concurrency قبل از اسکن برای اندازه‌نگرفتن ازدحام خودمان
- تفکیک خطای سخت و نرم + صف retry تأخیری
- ثبت POP کلودفلر (`cf-ray`) و بررسی یکنواختی آن
- استریم با ABR واقعی یا نردبان بیت‌ریت ثابت
- گزارش JSON (schema 6)، رتبه‌بندی متنی و لاگ ساخت‌یافته
- محافظت محلی از URI و حذف اطلاعات حساس از گزارش‌ها

---

# نصب سریع

## Windows

پیش‌نیاز: Node.js 20 یا بالاتر.

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
```

سپس `Start-CFQoE.cmd` را اجرا کنید. Xray در اجرای اول خودکار دانلود می‌شود.

## Linux

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
chmod +x start-cfqoe.sh
./start-cfqoe.sh
```

## Android با Termux — نصب با یک دستور

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
1. Quick Scan            fast screening, low confidence labels
2. Full Scan             wider sample with independent verification
3. Research Scan         slow, high-confidence measurement profile
4. Hard Deep Scan        parallel one-IP-per-range sweep, resumable
5. Resume Hard Scan      continue the last deep sweep
6. VLESS Configuration   import, inspect or remove your config
7. Workload Settings     choose or add transfer and streaming targets
8. System Check          verify Node, Xray and file protection
9. Best IPs              show the latest ranking with confidence
10. Previous Results     list saved reports
11. Diagnostics          summarize the newest log file
12. Scan Settings        edit measurement and verification numbers
0. Exit
```

خروجی هر گزینه زیر همان منو نمایش داده می‌شود و تا زمانی که Enter نزده‌اید پاک نخواهد شد.

---

# تفاوت Quick، Full، Research و Hard

| حالت | تعداد IP | roundها | نمونه استریم | تأیید |
| --- | --- | --- | --- | --- |
| Quick | ۱۶ | ۲ | ۳ | کوتاه‌شده |
| Full | ۱۲۰ | ۳ | ۱۰ | SPRT روی ۲۰ finalist |
| Research | ۲۴۰+ | ۶+ | ۲۹ | SPRT روی ۲۴ finalist تا ۲۴ round |
| Hard | تمام catalog | screening + تأیید | ۱۰ | SPRT + retry تأخیری |

- **Quick** فقط screening است؛ برچسب اعتماد نتایج آن پایین می‌ماند و نباید مبنای تصمیم نهایی باشد.
- **Full** حالت پیش‌فرض روزمره است.
- **Research** برای وقتی است که عدد باید قابل دفاع باشد؛ کند است و P10 واقعی گزارش می‌کند.
- **Hard** کل catalog را breadth-first و range round-robin پیمایش می‌کند، checkpoint می‌سازد و با `Q` یا `Ctrl+C` امن متوقف می‌شود.

Hard Scan همچنین:

- network و broadcast را در subnetهای معمولی کنار می‌گذارد.
- بعد از هر N IP checkpoint می‌سازد.
- خطاهای گذرا را در صف retry تأخیری نگه می‌دارد و بعداً دوباره امتحان می‌کند.
- finalistها را با SPRT تأیید می‌کند.
- با `Resume Hard Scan` از cursor ذخیره‌شده ادامه می‌دهد. checkpointهای نسخه قبل خودکار migrate می‌شوند.

---

# روش اندازه‌گیری

شرح کامل در [docs/MEASUREMENT-ENGINE.md](docs/MEASUREMENT-ENGINE.md) و [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## 1. Eligibility

برای هر IP یک WebSocket Upgrade واقعی با host، path و port کانفیگ کاربر انجام می‌شود. پاسخ HTTP 101، موفقیت roundها، زمان handshake و POP کلودفلر ثبت می‌شوند. TCP connect فقط برای diagnostics است.

موفقیت هر IP به‌صورت بازه اطمینان Wilson گزارش می‌شود:

| مشاهده | برآورد نقطه‌ای | کران پایین Wilson |
| --- | --- | --- |
| 1/1 | ۱۰۰٪ | ≈ ۲۰.۷٪ |
| 3/3 | ۱۰۰٪ | ≈ ۴۳.۹٪ |
| 16/16 | ۱۰۰٪ | ≈ ۸۰.۶٪ |

رتبه‌بندی با `conservative` انجام می‌شود، یعنی با کران پایین؛ پس IP کم‌نمونه به‌صرف خوش‌شانسی بالا نمی‌آید.

## 2. تأیید تطبیقی (SPRT)

`p0 = 0.60`، `p1 = 0.90`، `alpha = 0.05`، `beta = 0.10`. IP واضحاً خوب یا واضحاً بد در چند round تعیین می‌شود و بودجه نمونه‌گیری صرف موارد مبهم می‌شود. تصمیم (`accept` / `reject` / `inconclusive`) در گزارش ذخیره می‌شود.

## 3. Tunnel

برای هر finalist، Xray با همان IP بالا می‌آید، SOCKS محلی ساخته می‌شود، workloadها اجرا می‌شوند و سپس Xray متوقف و فایل موقت حذف می‌شود.

## 4. Web Transfer Score (قبلاً Browsing)

این معیار **کیفیت انتقال HTTP قابل حمل** است، نه QoE مرورگر: DOM، اجرای جاوااسکریپت، رندر و connection pool مرورگر واقعی وجود ندارد و به‌عمد یک socket برای هر host استفاده می‌شود.

- موفقیت منابع: ۴۰٪
- cold load: ۱۵٪
- warm load: ۲۰٪
- TTFB p90: ۱۵٪
- پایداری (MAD): ۱۰٪

## 5. Streaming

manifest واقعی HLS خوانده می‌شود؛ `EXT-X-MAP`، `EXT-X-KEY`، byte range و discontinuity پشتیبانی می‌شوند و زمان آن‌ها در startup delay حساب می‌شود.

- موفقیت segment: ۳۵٪
- startup delay: ۱۵٪
- rebuffer ratio: ۳۰٪
- بیت‌ریت پایدار: ۲۰٪

نکات نسخه ۰.۶:

- فقط segmentهای موفق به بافر قابل پخش اضافه می‌شوند.
- برآورد بیت‌ریت با **میانگین همساز** انجام می‌شود؛ P10 فقط با حداقل ۲۹ نمونه گزارش می‌شود و نام تخمین‌گر همراه عدد ذخیره می‌شود.
- اگر پخش هرگز به بافر شروع نرسد، امتیازی داده نمی‌شود.
- `variantMode = abr` رفتار واقعی ABR را شبیه‌سازی می‌کند؛ `fixed` نردبان بیت‌ریت هدف را انتخاب می‌کند.

## Overall Score

- Web Transfer: ۴۵٪
- Streaming: ۴۰٪
- Reliability: ۱۵٪

اگر مرحله‌ای انجام نشده باشد، وزن‌ها **بازتوزیع نمی‌شوند**؛ نتیجه `null` و وضعیت `incomplete` است. امتیاز خوش‌بینانه برای داده ناقص ساخته نمی‌شود.

## برچسب اعتماد

`provisional`، `low`، `medium`، `high` بر اساس تعداد نمونه و پخش‌شدگی در بلوک‌های زمانی مستقل. برچسب `high` یعنی «این اندازه‌گیری پایدار است»، نه «این IP خوب است».

## رتبه‌بندی run-relative

هر گزارش با `scope: "run-relative"` منتشر می‌شود. مقایسه امتیاز بین دو اجرا، دو دستگاه یا دو ISP در این روش پشتیبانی نمی‌شود.

---

# Workload Settings

### Web Transfer

- `wikipedia` — پیش‌فرض
- `cloudflare-docs`
- `cloudflare-speed`

### Streaming

- `apple-bipbop` — پیش‌فرض
- `bitmovin-sintel`
- `mux-test-hls`

YouTube به‌عنوان workload ثابت استفاده نشده، چون URL عمومی و پایدار `.m3u8` برای benchmark unattended ندارد.

---

# فایل‌های خروجی

```text
data/settings.json              تنظیمات کاربر (version 2)
data/config.secret.uri          کانفیگ محافظت‌شده
results/run-<id>.json           گزارش کامل (schema 6)
results/latest.json             آخرین گزارش
results/best-ips.txt            رتبه‌بندی متنی
results/hard-scan/*             checkpoint، صف retry و partial results
logs/run-<id>.ndjson            لاگ ساخت‌یافته
```

---

# حریم خصوصی و امنیت

- URI و UUID در گزارش‌ها و لاگ‌ها redact می‌شوند.
- داده‌ها فقط روی دستگاه کاربر ذخیره می‌شوند.
- فایل‌های موقت Xray حذف می‌شوند.
- فایل کانفیگ در Linux/Android permission محدود و در Windows ACL محدود دارد.
- Xray از منبع رسمی دانلود و در صورت ارائه digest بررسی می‌شود.

---

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
cfqoe scan --verify-limit 30     # تعداد finalistهای مرحله تأیید
cfqoe scan --no-verify           # غیرفعال کردن SPRT
cfqoe scan --no-retry            # غیرفعال کردن retry تأخیری
cfqoe scan --abr                 # استریم با ABR واقعی
```

---

# دقت نتایج

این روش از ping و burst speedtest به استفاده واقعی نزدیک‌تر است، اما نتیجه همچنان به ISP، Wi-Fi یا اپراتور، ساعت تست، workload و شرایط لحظه‌ای شبکه وابسته است. بهترین کاربرد ابزار، رتبه‌بندی نسبی IPها روی همان دستگاه و همان اتصال در همان بازه زمانی است.

---

# لایسنس

این پروژه تحت **CFQoE Source-Available Attribution Non-Commercial License 1.0** منتشر می‌شود. استفاده و تغییر با ذکر منبع مجاز است؛ فروش، بازفروش و انتشار مجدد به نام شخص دیگر مجاز نیست. متن کامل در [LICENSE](LICENSE) قرار دارد.
