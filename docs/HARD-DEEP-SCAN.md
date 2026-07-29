# Hard Deep Scan

Hard Deep Scan برای پیمایش طولانی و قابل Resume کل catalog طراحی شده است.

## چرا نسخه قبلی کند بود؟

نسخه قبلی برای هر IP صبر می‌کرد تا تمام eligibility roundها به‌صورت پشت‌سرهم تمام شوند. با timeout پیش‌فرض 6 ثانیه و سه round، یک IP خاموش می‌توانست حدود 18 ثانیه حرکت به رنج بعدی را متوقف کند. این رفتار با وجود درست بودن ترتیب range round-robin، throughput مناسبی برای catalog بزرگ نداشت.

## pipeline جدید

### 1. انتخاب range round-robin

ترتیب منطقی همچنان حفظ شده است:

1. host اول رنج اول
2. host اول رنج دوم
3. ادامه تا آخرین رنج
4. host دوم رنج اول
5. host دوم رنج دوم
6. و به همین ترتیب

### 2. اجرای parallel batched

IPهای انتخاب‌شده در batchهای محدود و هم‌زمان بررسی می‌شوند:

- Windows/Linux: پیش‌فرض 12 IP هم‌زمان
- Android/Termux: پیش‌فرض 6 IP هم‌زمان
- سقف ایمنی runtime: 64

بنابراین یک IP timeout‌شده دیگر کل traversal را متوقف نمی‌کند؛ IPهای چند رنج دیگر هم‌زمان در حال بررسی هستند. ترتیب cursor و checkpoint همچنان بر اساس همان range round-robin باقی می‌ماند.

### 3. fast screening

sweep اصلی به‌طور پیش‌فرض برای هر IP یک WebSocket eligibility round واقعی اجرا می‌کند. این مرحله فقط برای پیدا کردن candidateهای امیدوارکننده در catalog بزرگ است.

### 4. finalist recheck

قبل از tunnel و QoE نهایی، candidateهای برتر دوباره با تعداد کامل `Eligibility rounds` بررسی می‌شوند:

- Windows/Linux: پیش‌فرض 20 finalist
- Android/Termux: پیش‌فرض 12 finalist

بعد از recheck، مرحله Xray، browsing و streaming روی finalistهای انتخابی اجرا می‌شود. بنابراین سرعت sweep با یک بررسی اولیه بالا می‌رود، اما تصمیم نهایی فقط به همان تک مشاهده اولیه وابسته نمی‌ماند.

### 5. early rejection

اگر کاربر screening round را بیشتر از یک قرار دهد و یک IP دیگر از نظر ریاضی نتواند به success threshold برسد، roundهای بی‌فایده بعدی اجرا نمی‌شوند. برای مثال با سه round و threshold برابر 60٪، بعد از دو شکست متوالی round سوم حذف می‌شود.

## تنظیمات

از مسیر `Scan Settings`:

- `Hard concurrent IPs`: تعداد IPهای هم‌زمان
- `Hard screening rounds`: تعداد roundهای sweep اولیه
- `Hard finalist recheck count`: تعداد candidateهایی که پیش از tunnel مجدداً بررسی می‌شوند
- `Hard-save every N IPs`: فاصله checkpoint
- `Hard live top count`: تعداد نتایج برتر در snapshot زنده
- `Hard final top count`: تعداد candidateهای نگهداری‌شده برای خروجی نهایی

## پیشنهاد تنظیمات

### Windows/Linux متعادل

```text
Hard concurrent IPs: 12
Hard screening rounds: 1
Hard finalist recheck count: 20
```

### Android/Termux متعادل

```text
Hard concurrent IPs: 6
Hard screening rounds: 1
Hard finalist recheck count: 12
```

در گوشی داغ یا ضعیف concurrency را به 3 یا 4 کاهش دهید. روی سیستم و اینترنت قوی می‌توان آن را مرحله‌ای به 16 یا 20 رساند، اما مقدار بالاتر همیشه نتیجه سریع‌تر یا دقیق‌تری نمی‌دهد.

## توقف امن

با `Q` یا `Ctrl+C` شروع batch جدید متوقف می‌شود. batch کوچک جاری تمام می‌شود، سپس cursor و نتایج ذخیره و finalization اجرا می‌شود. با تنظیم پیش‌فرض یک round، انتظار توقف معمولاً بیشتر از timeout همان batch نیست.

checkpointهای قدیمی همچنان با ترتیب legacy Resume می‌شوند، اما اجرای eligibility آن‌ها نیز از workerهای موازی استفاده می‌کند.
