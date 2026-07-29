# CFQoE Scanner

اسکنر حرفه‌ای IPهای کلودفلر بر اساس **کیفیت واقعی تجربه کاربر**؛ نه صرفاً ping، نه TCP connect و نه speedtest چنداتصالی و مصنوعی.

CFQoE Scanner روی **Windows، Linux و Android/Termux** اجرا می‌شود و IPها را با WebSocket واقعی، تونل واقعی Xray، بارگذاری صفحه وب و استریم HLS رتبه‌بندی می‌کند.

## ویژگی‌ها

- پشتیبانی از Windows، Linux و Android/Termux بدون نیاز به سرور
- پشتیبانی از VLESS + WebSocket
- دانلود خودکار نسخه رسمی و مناسب Xray
- نمونه تصادفی تازه در هر اجرای Quick و Full Scan
- Hard Scan به‌صورت range round-robin، checkpointed و قابل Resume
- توقف امن با `Q` یا `Ctrl+C` و نهایی‌سازی نتایج موجود
- اندازه‌گیری واقعی browsing و streaming
- گزارش JSON، رتبه‌بندی متنی و لاگ ساخت‌یافته
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
6. برای پوشش وسیع‌تر Full Scan و برای جست‌وجوی طولانی Hard Deep Scan را اجرا کنید.

## منوی اصلی

```text
1. Quick Scan            fresh random sample, small and fast
2. Full Scan             fresh wider sample and more rounds
3. Hard Deep Scan        one IP per range per pass, resumable
4. Resume Hard Scan      continue the last deep sweep
5. VLESS Configuration   import, inspect or remove your config
6. Workload Settings     choose or add browsing and streaming targets
7. System Check          verify Node, Xray and file protection
8. Best IPs              show the latest ranking
9. Previous Results      list saved reports
10. Diagnostics          summarize the newest log file
11. Scan Settings        edit numbers with a friendly picker
0. Exit
```

خروجی هر گزینه زیر همان منو نمایش داده می‌شود و تا زمانی که Enter نزده‌اید پاک نخواهد شد. این رفتار باعث می‌شود نتیجه اسکن، Previous Results و Diagnostics روی Termux هم قابل مشاهده بمانند.

---

# تفاوت Quick، Full و Hard

## Quick Scan

- به‌طور پیش‌فرض فقط **16 IP** را بررسی می‌کند.
- برای هر اجرا یک seed تصادفی تازه می‌سازد.
- رنج‌ها و IPهای انتخابی هر اجرا باید با اجرای قبل متفاوت باشند.
- برای تست سریع pipeline و گرفتن چند نتیجه اولیه طراحی شده است.

## Full Scan

- به‌طور پیش‌فرض **120 IP** را بررسی می‌کند.
- تعداد آن از `Scan Settings → Max candidates` قابل تغییر است.
- در هر اجرا seed تازه تولید می‌کند.
- رنج‌ها با shuffled round-robin پخش می‌شوند تا انتخاب فقط از ابتدای فایل نباشد.
- seed واقعی داخل لاگ و گزارش ذخیره می‌شود تا همان اجرا قابل دیباگ باشد.

وجود حدود دو میلیون IP در catalog به این معنی نیست که Quick یا Full همه آن‌ها را در یک اجرا تست می‌کنند؛ چنین کاری بسیار طولانی خواهد بود. Quick و Full **sampled scans** هستند. برای پیمایش کامل و قابل ادامه باید از Hard Deep Scan استفاده شود.

## Hard Deep Scan

Hard Scan جدید breadth-first یا **range round-robin** است:

1. اولین usable IP از رنج اول
2. اولین usable IP از رنج دوم
3. ادامه تا آخرین رنج
4. دومین usable IP از رنج اول
5. دومین usable IP از رنج دوم
6. و به همین ترتیب تا پایان

این روش باعث می‌شود در همان مراحل ابتدایی از تمام رنج‌ها پوشش بگیریم و اسکن ساعت‌ها داخل یک رنج بزرگ گیر نکند. رنج‌های کوچک پس از تمام شدن usable hostهایشان خودکار کنار گذاشته می‌شوند.

Hard Scan همچنین:

- network و broadcast را در subnetهای معمولی کنار می‌گذارد.
- بعد از هر N IP checkpoint می‌سازد.
- تعداد IPهای موفق و ناموفق را زنده نمایش می‌دهد.
- با `Q` یا `Ctrl+C` امن متوقف می‌شود.
- بعد از توقف، بهترین یافته‌ها را با tunnel/browsing/streaming نهایی می‌کند.
- با `Resume Hard Scan` از cursor ذخیره‌شده ادامه می‌دهد.

### سازگاری checkpoint قدیمی

checkpointهایی که قبل از این تغییر ساخته شده‌اند از بین نمی‌روند و همچنان Resume می‌شوند، اما برای جلوگیری از تکرار یا جا افتادن IP، همان ترتیب قدیمی را تا پایان ادامه می‌دهند. هر Hard Scan جدید از روش range round-robin استفاده می‌کند.

---

# روش اندازه‌گیری

## 1. Eligibility

برای هر IP یک WebSocket Upgrade واقعی با host، path و port کانفیگ کاربر انجام می‌شود. پاسخ HTTP 101، موفقیت roundها و زمان handshake ثبت می‌شوند. TCP connect فقط برای diagnostics است و به‌تنهایی معیار رتبه‌بندی نیست.

## 2. Tunnel

از میان IPهای eligible چند finalist انتخاب می‌شوند. برای هر finalist:

1. Xray با همان IP بالا می‌آید.
2. SOCKS محلی روی `127.0.0.1` ایجاد می‌شود.
3. browsing workload اجرا می‌شود.
4. streaming workload اجرا می‌شود.
5. Xray متوقف و فایل موقت حذف می‌شود.

اگر `tunnel.limit = 5` و `tunnel.rounds = 1` باشد، progress پنج‌مرحله‌ای یعنی پنج IP منتخب، نه پنج نوع تست.

## 3. Browsing

- cold page load
- warm page load
- TTFB p90
- موفقیت منابع صفحه
- پایداری زمانی (MAD)

وزن داخلی:

- موفقیت منابع: 40٪
- cold load: 15٪
- warm load: 20٪
- TTFB p90: 15٪
- پایداری: 10٪

## 4. Streaming

manifest واقعی HLS خوانده می‌شود و segmentها به‌صورت ترتیبی دانلود می‌شوند.

- segment success rate
- startup delay
- rebuffer ratio
- P10 sustainable bitrate

وزن داخلی:

- موفقیت: 35٪
- startup delay: 15٪
- rebuffer: 30٪
- bitrate پایدار: 20٪

## Overall Score

- Browsing: 45٪
- Streaming: 40٪
- Reliability: 15٪

IPهایی که فقط eligibility دارند ولی browsing/streaming واقعی ندارند، overall score گمراه‌کننده دریافت نمی‌کنند.

---

# Workload Settings

### Browsing

- `wikipedia` — پیش‌فرض
- `cloudflare-docs`
- `cloudflare-speed`

### Streaming

- `apple-bipbop` — پیش‌فرض
- `bitmovin-sintel`
- `mux-test-hls`

YouTube به‌عنوان workload ثابت استفاده نشده، چون URL عمومی و پایدار `.m3u8` برای benchmark unattended ندارد و لینک‌های آن معمولاً token/expiry دارند.

---

# Previous Results و Diagnostics

## گزینه 9 — Previous Results

تا 15 گزارش آخر را نمایش می‌دهد. روی ترمینال باریک Termux به‌جای جدول عریض، نمایش موبایل و چندخطی استفاده می‌شود.

## گزینه 10 — Diagnostics

جدیدترین فایل NDJSON را پیدا می‌کند و تعداد eventها، warningها و errorها را نشان می‌دهد. خطاها روی Termux به‌شکل فهرست باریک چاپ می‌شوند.

پس از نمایش هرکدام، برنامه منتظر Enter می‌ماند تا خروجی فوراً زیر منوی بعدی گم نشود.

---

# نکات Android/Termux

- root لازم نیست.
- برای اکثر گوشی‌ها `Xray-android-arm64-v8a` نصب می‌شود.
- لانچر هنگام اجرا wake lock می‌گیرد و هنگام خروج آزاد می‌کند.
- برای اسکن طولانی Battery Optimization مربوط به Termux را غیرفعال کنید.
- پروژه را از shared storage اجرا نکنید.
- در نصب تازه Android، concurrency کمتر و checkpointها پرتکرارتر هستند.

---

# فایل‌های خروجی

```text
data/settings.json              تنظیمات کاربر
data/config.secret.uri          کانفیگ محافظت‌شده
results/run-<id>.json           گزارش کامل
results/latest.json             آخرین گزارش
results/best-ips.txt            رتبه‌بندی متنی
results/hard-scan/*             checkpoint و partial results
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
cfqoe hard
cfqoe resume
cfqoe check
cfqoe results
cfqoe diagnose
npm run xray:install
npm test
```

---

# دقت نتایج

این روش از ping و burst speedtest به استفاده واقعی نزدیک‌تر است، اما نتیجه همچنان به ISP، Wi-Fi یا اپراتور، ساعت تست، workload و شرایط لحظه‌ای شبکه وابسته است. بهترین کاربرد ابزار، رتبه‌بندی نسبی IPها روی همان دستگاه و همان اتصال است.

---

# لایسنس

این پروژه تحت **CFQoE Source-Available Attribution Non-Commercial License 1.0** منتشر می‌شود. استفاده و تغییر با ذکر منبع مجاز است؛ فروش، بازفروش و انتشار مجدد به نام شخص دیگر مجاز نیست. متن کامل در [LICENSE](LICENSE) قرار دارد.
