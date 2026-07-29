# اجرای CFQoE Scanner روی Android با Termux

این نسخه به‌صورت مستقیم از **Android/Termux روی arm64** و محیط‌های Android x64 پشتیبانی می‌کند. برای اجرای اسکن نیازی به root نیست.

## قبل از شروع

- پیشنهاد می‌شود Termux را از **F-Droid یا صفحه رسمی GitHub پروژه Termux** دریافت کنید.
- پروژه را داخل فضای خانگی Termux (`$HOME`) نگه دارید.
- پروژه را داخل `/sdcard`، `/storage` یا پوشه Download اجرا نکنید؛ Android اجازه اجرای مطمئن باینری Xray از shared storage را نمی‌دهد.
- برای Hard Deep Scan، Battery Optimization مربوط به Termux را در تنظیمات Android غیرفعال کنید.

## نصب با یک دستور

این دستور را کامل داخل Termux paste کنید:

```bash
pkg update -y && pkg install -y git && git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git && cd cfqoe-scanner && bash install-termux.sh
```

نصب‌کننده این کارها را انجام می‌دهد:

1. نصب Node.js LTS، Git، Python و unzip؛
2. تشخیص معماری گوشی؛
3. دانلود نسخه رسمی Xray مخصوص Android؛
4. بررسی SHA-256 آرشیو در صورت ارائه digest توسط GitHub؛
5. آزمایش قابل اجرا بودن باینری Xray؛
6. ساخت پوشه‌های خصوصی داده، لاگ و نتایج؛
7. اجرای منوی CFQoE Scanner.

## اجرای دفعات بعد

```bash
cd ~/cfqoe-scanner
./start-cfqoe.sh
```

## به‌روزرسانی

```bash
cd ~/cfqoe-scanner
git pull
bash install-termux.sh
```

## اولین استفاده

1. گزینه `5` را انتخاب و لینک VLESS را وارد کنید.
2. گزینه `7` را برای System Check اجرا کنید؛ خروجی باید `android-arm64` و Xray موجود را نشان دهد.
3. ابتدا گزینه `1` یعنی Quick Scan را اجرا کنید.
4. نتایج را از گزینه `8` ببینید.
5. برای اسکن طولانی از Hard Deep Scan استفاده کنید؛ checkpoint و Resume جلوی از دست رفتن پیشرفت را می‌گیرند.

## جلوگیری از قطع اسکن در پس‌زمینه

لانچر `start-cfqoe.sh` هنگام اجرا به‌صورت خودکار `termux-wake-lock` می‌گیرد و پس از خروج آن را آزاد می‌کند. با این حال Android ممکن است به‌علت Battery Optimization یا کمبود حافظه Termux را متوقف کند.

برای اسکن طولانی:

- Battery Optimization را برای Termux روی **Unrestricted / Don't optimize** قرار دهید.
- در صورت امکان Termux را در صفحه Recent Apps قفل کنید.
- هنگام Hard Scan برنامه را Force Stop نکنید.
- اگر برنامه متوقف شد، گزینه `Resume Hard Scan` را اجرا کنید.

## بهینه‌سازی‌های مخصوص موبایل

در نصب تازه Android:

- concurrency مرحله eligibility از 12 به 6 کاهش می‌یابد تا فشار CPU، حرارت و تداخل شبکه کمتر شود.
- checkpoint در Hard Scan هر 10 IP ذخیره می‌شود تا در صورت توقف Android، پیشرفت کمتری از دست برود.
- progress bar متناسب با عرض ترمینال موبایل کوچک می‌شود و نباید به خط بعد بپیچد.
- Xray شکسته یا متعلق به پلتفرم دیگر تشخیص داده و با نسخه صحیح Android جایگزین می‌شود.

اگر قبلاً `data/settings.json` داشته‌اید، تنظیمات ذخیره‌شده شما حفظ می‌شود و می‌توانید concurrency و فاصله checkpoint را از منوی Scan Settings تغییر دهید.

## مصرف باتری و اینترنت

- Quick Scan سبک‌تر است.
- Full Scan و مخصوصاً Hard Deep Scan می‌توانند باتری و اینترنت بیشتری مصرف کنند.
- مرحله tunnel شامل مرور وب و دانلود ترتیبی segmentهای HLS است؛ بنابراین مصرف داده واقعی دارد.
- کاهش تعداد finalists، rounds و streaming segments زمان و مصرف را کمتر می‌کند، ولی دقت مقایسه نیز کاهش می‌یابد.

## خطاهای رایج

### `Unsupported platform: android`

نسخه پروژه قدیمی است:

```bash
cd ~/cfqoe-scanner
git pull
bash install-termux.sh
```

### `Permission denied` برای Xray

```bash
cd ~/cfqoe-scanner
chmod +x xray/xray start-cfqoe.sh
./start-cfqoe.sh
```

### پروژه داخل shared storage است

نسخه تمیز را داخل Home کلون کنید:

```bash
cd ~
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
bash install-termux.sh
```

### Android برنامه را وسط Hard Scan بسته است

دوباره برنامه را باز کرده و گزینه `Resume Hard Scan` را بزنید. آخرین checkpoint از پوشه محلی پروژه خوانده می‌شود.
