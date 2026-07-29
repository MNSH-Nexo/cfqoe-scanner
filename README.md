# CFQoE Scanner

اسکنر حرفه‌ای IPهای کلودفلر بر اساس **کیفیت واقعی تجربه کاربر**؛ نه صرفاً ping، نه TCP connect و نه speedtest چنداتصالی و مصنوعی.

CFQoE Scanner روی **Windows، Linux و Android/Termux** اجرا می‌شود و IPها را با WebSocket واقعی، تونل واقعی Xray، بارگذاری صفحه وب و استریم HLS رتبه‌بندی می‌کند.

## ویژگی‌ها

- پشتیبانی از Windows، Linux و Android/Termux بدون نیاز به سرور
- پشتیبانی از VLESS + WebSocket
- دانلود خودکار نسخه رسمی و مناسب Xray برای هر پلتفرم
- Quick Scan، Full Scan و Hard Deep Scan
- Hard Scan ترتیبی، checkpointed و قابل Resume
- توقف امن با `Q` یا `Ctrl+C` و نهایی‌سازی نتایج موجود
- اندازه‌گیری واقعی browsing و streaming
- workloadهای داخلی و امکان افزودن صفحه یا HLS دلخواه
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

سپس فایل زیر را دوبار کلیک کنید:

```text
Start-CFQoE.cmd
```

Xray در اجرای اول به‌صورت خودکار دانلود می‌شود.

## Linux

```bash
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
chmod +x start-cfqoe.sh
./start-cfqoe.sh
```

Node.js 20 یا بالاتر و یکی از ابزارهای `python3` یا `unzip` لازم است.

## Android با Termux — نصب با یک دستور

> Termux را ترجیحاً از F-Droid یا GitHub رسمی Termux نصب کنید. پروژه را داخل Home ترموکس نگه دارید، نه Download یا `/sdcard`.

این دستور را کامل داخل Termux paste کنید:

```bash
pkg update -y && pkg install -y git && git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git && cd cfqoe-scanner && bash install-termux.sh
```

این دستور پیش‌نیازها را نصب می‌کند، معماری گوشی را تشخیص می‌دهد، **Xray رسمی Android** را دانلود و بررسی می‌کند و سپس منو را باز می‌کند.

اجرای دفعات بعد:

```bash
cd ~/cfqoe-scanner
./start-cfqoe.sh
```

راهنمای کامل Android، مصرف باتری، به‌روزرسانی و رفع خطا: [docs/ANDROID-TERMUX.md](docs/ANDROID-TERMUX.md)

---

## Xray چگونه آماده می‌شود؟

اگر Xray وجود نداشته باشد یا باینری اشتباه/خراب باشد، لانچر نسخه مناسب را از Releases رسمی `XTLS/Xray-core` دریافت می‌کند:

- Windows x64/arm64
- Linux x64/arm64
- Android arm64/x64

در صورت وجود SHA-256 digest در metadata انتشار، آرشیو قبل از نصب بررسی می‌شود. باینری نصب‌شده نیز با اجرای `xray version` آزمایش می‌شود.

نصب دستی:

```bash
npm run xray:install
```

---

# شروع کار

1. برنامه را با لانچر سیستم‌عامل خود اجرا کنید.
2. وارد `VLESS Configuration` شوید و URI را وارد کنید.
3. `System Check` را اجرا کنید.
4. ابتدا `Quick Scan` بزنید.
5. نتیجه را از `Best IPs` ببینید.
6. برای بررسی وسیع‌تر از Full Scan و برای شرایط دشوار از Hard Deep Scan استفاده کنید.

## منوی اصلی

```text
1. Quick Scan            fast check with a small candidate set
2. Full Scan             wider sampling and more rounds
3. Hard Deep Scan        sequential, checkpointed, resumable sweep
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

---

# حالت‌های اسکن

## Quick Scan

مجموعه کوچک‌تری از IPها را با تنظیمات سبک‌تر بررسی می‌کند. برای اولین اجرا و کنترل سلامت pipeline مناسب است.

## Full Scan

نمونه‌برداری وسیع‌تر، rounds بیشتر و مقایسه دقیق‌تری انجام می‌دهد. IPها از رنج‌های مختلف با shuffled round-robin انتخاب می‌شوند تا رنج‌های پایین فایل نادیده گرفته نشوند.

## Hard Deep Scan

- رنج‌ها را به‌صورت ترتیبی و بدون انتخاب تصادفی جلو می‌برد.
- تعداد IPهای هر CIDR را از خود CIDR محاسبه می‌کند.
- در رنج‌های معمولی network و broadcast را کنار می‌گذارد و usable hostها را اسکن می‌کند.
- بعد از هر تعداد مشخص IP checkpoint و snapshot می‌سازد.
- تعداد IPهای موفق و ناموفق را زنده نشان می‌دهد.
- با `Q` یا `Ctrl+C` امن متوقف می‌شود.
- بعد از توقف، بهترین یافته‌های فعلی وارد مرحله `hard-finalize` می‌شوند؛ این مرحله همان ارزیابی واقعی tunnel/browsing/streaming است.
- با `Resume Hard Scan` از cursor ذخیره‌شده ادامه می‌دهد.

در نصب تازه Android، concurrency پیش‌فرض کمتر و فاصله checkpoint کوتاه‌تر است تا حرارت و احتمال از دست رفتن پیشرفت کاهش یابد.

---

# روش اندازه‌گیری

## 1. Eligibility

برای هر IP یک WebSocket Upgrade واقعی با host، path و port کانفیگ کاربر انجام می‌شود. مواردی مثل پاسخ HTTP 101، موفقیت roundها و زمان handshake ثبت می‌شوند.

TCP connect فقط برای diagnostics ثبت می‌شود و به‌تنهایی معیار انتخاب بهترین IP نیست.

## 2. Tunnel

از میان IPهای eligible، تعداد مشخصی finalist انتخاب می‌شوند. برای هر finalist:

1. Xray با همان IP بالا می‌آید.
2. یک SOCKS محلی روی `127.0.0.1` ایجاد می‌شود.
3. browsing workloads از داخل تونل اجرا می‌شوند.
4. streaming workloads از داخل تونل اجرا می‌شوند.
5. Xray متوقف و فایل موقت آن حذف می‌شود.

اگر `tunnel.limit = 5` و `tunnel.rounds = 1` باشد، progress این بخش 5 مرحله دارد؛ یعنی 5 IP منتخب، نه 5 نوع تست متفاوت.

## 3. Browsing

معیارهای اصلی:

- cold page load
- warm page load
- TTFB p90
- موفقیت منابع صفحه
- پایداری زمانی (MAD)

وزن داخلی browsing:

- موفقیت منابع: 40٪
- cold load: 15٪
- warm load: 20٪
- TTFB p90: 15٪
- پایداری: 10٪

## 4. Streaming

manifest واقعی HLS خوانده می‌شود و segmentها به‌صورت **ترتیبی** دانلود می‌شوند تا رفتار player طبیعی‌تر شبیه‌سازی شود.

معیارها:

- segment success rate
- startup delay
- rebuffer ratio
- P10 sustainable bitrate با safety factor

وزن داخلی streaming:

- موفقیت: 35٪
- startup delay: 15٪
- rebuffer: 30٪
- bitrate پایدار: 20٪

## Overall Score

- Browsing: 45٪
- Streaming: 40٪
- Reliability: 15٪

IPهایی که فقط eligibility دارند ولی browsing/streaming واقعی تولید نکرده‌اند، overall QoE گمراه‌کننده دریافت نمی‌کنند.

---

# Workload Settings

پیش‌فرض‌ها عمداً فقط متکی به Cloudflare نیستند:

### Browsing

- `wikipedia` — پیش‌فرض
- `cloudflare-docs`
- `cloudflare-speed`

### Streaming

- `apple-bipbop` — پیش‌فرض
- `bitmovin-sintel`
- `mux-test-hls`

YouTube به‌عنوان workload ثابت استفاده نشده، چون URL عمومی و پایدار `.m3u8` برای benchmark unattended ارائه نمی‌کند و لینک‌های آن معمولاً token/expiry دارند.

هر کاربر می‌تواند صفحه وب یا HLS دلخواه خود را اضافه کند. هرچه workload به مصرف واقعی کاربر نزدیک‌تر باشد، رتبه‌بندی کاربردی‌تر است.

---

# نکات مهم Android/Termux

- root لازم نیست.
- باینری `Xray-android-arm64-v8a` برای اکثر گوشی‌های جدید استفاده می‌شود.
- `start-cfqoe.sh` هنگام اجرا wake lock می‌گیرد و هنگام خروج آزاد می‌کند.
- برای اسکن طولانی، Battery Optimization مربوط به Termux را غیرفعال کنید.
- اجرای پروژه از shared storage ممنوع است؛ Xray باید در Home ترموکس باشد.
- progress bar با عرض صفحه موبایل تطبیق پیدا می‌کند.
- Quick/Full/Hard Scan روی اینترنت همان گوشی اندازه‌گیری می‌شوند، بنابراین نتیجه نشان‌دهنده مسیر واقعی همان اپراتور یا Wi-Fi است.

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
- فایل‌های موقت Xray بعد از هر candidate حذف می‌شوند.
- فایل کانفیگ در Linux/Android با permission محدود ذخیره می‌شود و در Windows ACL محدود دریافت می‌کند.
- Xray از منبع رسمی دانلود و در صورت امکان checksum آن بررسی می‌شود.

اگر URI واقعی را در فضای عمومی منتشر کرده‌اید، UUID/کانفیگ را rotate کنید.

---

# خط فرمان

```bash
cfqoe                       # منوی تعاملی
cfqoe import "vless://..."  # وارد کردن کانفیگ
cfqoe quick                 # اسکن سریع
cfqoe scan                  # اسکن کامل
cfqoe hard                  # اسکن ترتیبی و قابل ادامه
cfqoe resume                # ادامه Hard Scan
cfqoe check                 # بررسی سیستم
cfqoe results               # آخرین رتبه‌بندی
cfqoe diagnose              # خلاصه آخرین لاگ
npm run xray:install        # نصب/اصلاح Xray
npm test                    # اجرای تست‌ها
```

در Windows به‌جای `cfqoe` می‌توان از `node bin\\cfqoe.js` استفاده کرد.

---

# دقت نتایج

این روش از ping و burst speedtest به استفاده واقعی نزدیک‌تر است، چون WebSocket، Xray، HTTP و HLS واقعی را آزمایش می‌کند. با این حال نتیجه به ISP، Wi-Fi یا اپراتور، ساعت تست، workload و شرایط لحظه‌ای شبکه وابسته است. بهترین کاربرد ابزار، **رتبه‌بندی نسبی IPها روی همان دستگاه و همان اتصال در همان بازه زمانی** است.

---

# لایسنس

این پروژه تحت **CFQoE Source-Available Attribution Non-Commercial License 1.0** منتشر می‌شود:

- استفاده، مطالعه و تغییر کد مجاز است.
- استفاده از کد با ذکر منبع و حفظ attribution مجاز است.
- فروش، بازفروش، sublicensing و انتشار مجدد به نام شخص دیگر مجاز نیست.

متن کامل و الزام‌آور در فایل [LICENSE](LICENSE) قرار دارد.
