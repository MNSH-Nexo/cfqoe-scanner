# Security

## Credential handling

- فایل‌های `*.uri`، `.env` و `*.secret.json` توسط Git ignore می‌شوند.
- UUID و URI کامل در گزارش یا target metadata ذخیره نمی‌شوند.
- Logger کلیدهای حساس و رشته‌های VLESS را recursively redacted می‌کند.
- Bufferهای پاسخ به‌جای محتوا فقط با اندازه ثبت می‌شوند.
- Manifest capture به یک مگابایت محدود است.
- UUID کامل در حالت Real Tunnel فقط در حافظهٔ runtime و config موقت Xray وجود دارد.
- stderr فرایند Xray پیش از ثبت در لاگ redacted می‌شود.

## File permissions

- پوشهٔ output و log: `0700`
- JSON، CSV، Top IP و NDJSON: `0600`
- config secret پیشنهادی: `0600`
- پوشهٔ موقت Xray: `0700`
- config موقت Xray: `0600` و حذف در success، failure و timeout

## Network safety

- تعداد candidate سقف سراسری دارد.
- concurrency هر مرحله محدود است.
- timeout برای handshake، SOCKS، Xray startup، resource و segment اعمال می‌شود.
- manifest حداکثر ۶۴ asset، ۸ profile و ۱۲ segment برای هر profile می‌پذیرد.
- streaming پس از profile ناپایدار متوقف می‌شود تا مصرف بیهوده کم شود.

## Probe origin

Origin هیچ credential، upload یا endpoint اجرایی ندارد. فقط resourceهای deterministic عمومی می‌سازد. سرویس systemd نمونه با user محدود، `NoNewPrivileges` و filesystem فقط‌خواندنی اجرا می‌شود.

## Supply chain

CFQoE dependency زمان اجرا ندارد. نصب‌کننده Xray فقط asset رسمی آخرین release را از GitHub می‌گیرد و قبل از استخراج و اجرا، وجود و تطبیق digest از نوع SHA-256 را اجباری می‌کند؛ در نبود digest نصب متوقف می‌شود.

## Sharing diagnostics

Redaction خودکار از credentialهای شناخته‌شده محافظت می‌کند؛ با این حال IP، Hostname، Colo و Path برای عیب‌یابی در لاگ می‌مانند. قبل از انتشار عمومی لاگ، این metadataها را نیز بررسی کنید.
