# اجرای CFQoE Scanner روی Android با Termux

این نسخه از Android/Termux روی arm64 و محیط‌های Android x64 پشتیبانی می‌کند و به root نیاز ندارد.

## نصب با یک دستور

```bash
pkg update -y && pkg install -y git && git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git && cd cfqoe-scanner && bash install-termux.sh
```

پروژه را داخل `$HOME` نگه دارید، نه `/sdcard`، `/storage` یا Download.

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
2. گزینه `7` را اجرا کنید؛ خروجی باید `android-arm64` و Xray موجود را نشان دهد.
3. ابتدا Quick Scan را اجرا کنید.
4. نتایج را از گزینه `8` ببینید.
5. برای پوشش گسترده و قابل ادامه Hard Deep Scan را اجرا کنید.

## رفتار اسکن‌ها

- Quick و Full در هر بار اجرا یک seed تازه می‌سازند، پس sampleها نباید دائماً یکسان باشند.
- Quick فقط یک sample کوچک و Full یک sample بزرگ‌تر است؛ هیچ‌کدام قرار نیست کل catalog را در یک اجرا بررسی کنند.
- Hard Scan در هر pass یک usable IP از هر رنج می‌گیرد؛ بعد سراغ IP بعدی تمام رنج‌ها می‌رود.
- Hard Scan روی Termux به‌طور پیش‌فرض 6 IP از رنج‌های مختلف را هم‌زمان screen می‌کند.
- sweep اولیه برای سرعت یک round دارد و 12 finalist برتر قبل از tunnel با roundهای کامل دوباره بررسی می‌شوند.
- checkpoint قدیمی با ترتیب قدیمی Resume می‌شود، اما eligibility آن نیز به‌صورت موازی اجرا می‌شود.

جزئیات فنی: [HARD-DEEP-SCAN.md](HARD-DEEP-SCAN.md)

## جلوگیری از قطع اسکن

لانچر به‌صورت خودکار `termux-wake-lock` می‌گیرد و پس از خروج آزاد می‌کند. برای اسکن طولانی:

- Battery Optimization را روی Unrestricted قرار دهید.
- در صورت امکان Termux را در Recent Apps قفل کنید.
- اگر Android برنامه را بست، `Resume Hard Scan` را اجرا کنید.

## بهینه‌سازی موبایل

- Hard concurrency اولیه 6 است تا فشار CPU و حرارت کنترل شود.
- checkpoint در نصب تازه هر 10 IP ذخیره می‌شود.
- progress bar با عرض صفحه تطبیق پیدا می‌کند.
- گزینه‌های 9 و 10 روی صفحه باریک خروجی چندخطی دارند.
- همه خروجی‌ها زیر منوی فعلی باقی می‌مانند تا کاربر Enter بزند.

اگر گوشی بیش از حد گرم شد، از `Scan Settings` مقدار `Hard concurrent IPs` را به 3 یا 4 کاهش دهید.

## مصرف باتری و اینترنت

Quick سبک‌تر است. Full و Hard زمان و داده بیشتری مصرف می‌کنند. مرحله tunnel شامل مرور وب و دریافت segmentهای HLS واقعی است.

## خطاهای رایج

### `Unsupported platform: android`

```bash
cd ~/cfqoe-scanner
git pull
bash install-termux.sh
```

### `Permission denied`

```bash
cd ~/cfqoe-scanner
chmod +x xray/xray start-cfqoe.sh
./start-cfqoe.sh
```

### Android برنامه را وسط Hard Scan بست

برنامه را دوباره اجرا و گزینه `Resume Hard Scan` را انتخاب کنید.
