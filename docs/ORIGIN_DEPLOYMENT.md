# Controlled Origin Deployment

CFQoE برای Browsing و Streaming به workload ثابت پشت Cloudflare نیاز دارد. Origin داخلی هیچ dependency ندارد و فقط داده‌های عمومی و deterministic سرو می‌کند.

## اجرا

```bash
cfqoe-origin --host 127.0.0.1 --port 8080
curl -i http://127.0.0.1:8080/healthz
```

## Reverse proxy

یک hostname جدا مثل `probe.example.com` با Proxy روشن بسازید:

```nginx
location = /healthz {
    proxy_pass http://127.0.0.1:8080;
}

location ^~ /cfqoe/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}
```

## Page workload

```text
/cfqoe/manifest.json
/cfqoe/page.html
/cfqoe/assets/*
```

یک document و هشت asset با مجموع تقریبی ۴۰۰ کیلوبایت دارد.

## Streaming workload

```text
/cfqoe/stream/manifest.json
/cfqoe/stream/360p/segment-*.bin
/cfqoe/stream/720p/segment-*.bin
/cfqoe/stream/1080p/segment-*.bin
```

هر پروفایل چهار segment چهارضانیه‌ای دارد:

| کیفیت | Bitrate | اندازهٔ هر segment |
|---|---:|---:|
| 360p | 1 Mbps | 500 KB |
| 720p | 3 Mbps | 1.5 MB |
| 1080p | 6 Mbps | 3 MB |

Origin segmentها را chunked در حافظه تولید می‌کند اما `Content-Length` ثابت دارد؛ در نتیجه Edge Cloudflare می‌تواند آن‌ها را cache کند و حافظهٔ origin با فایل‌های چندمگابایتی پر نمی‌شود.

## نکتهٔ Cache

resourceها `Cache-Control: public, max-age=86400, immutable` دارند. قبل از benchmark اصلی، یک warm-up scan کوتاه اجرا کنید تا نتیجه کمتر تحت تأثیر cache miss اولیه باشد.

## Systemd

نمونهٔ hardened service در این مسیر است:

```text
deploy/systemd/cfqoe-origin.service
```

سرویس به‌صورت پیش‌فرض با کاربر محدود `cfqoe` و روی `127.0.0.1:8080` اجرا می‌شود.
