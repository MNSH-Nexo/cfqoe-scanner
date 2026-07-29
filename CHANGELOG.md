# Changelog

## 0.7.0

نسخه 0.6.0 آماری بود اما حجم اندازه‌گیری کوچک بود: هر کاندید فقط با چند صد کیلوبایت سنجیده می‌شد و امتیاز کاملاً نسبی بود. نتیجه این بود که یک IP خفه‌شده می‌توانست ۹۱ بگیرد. 0.7.0 این را اصلاح می‌کند.

### Added
- مرحله **Real Load** (`src/probe/load.js`): دانلود پیوسته چانک‌های چندمگابایتی در یک بودجه زمانی، پینگ همزمان زیر بار، fan-out موازی روی اتصال تازه و آپلود چندمگابایتی.
- متریک‌های جدید: `sustainedMbps`، `peakMbps`، `earlyMbps`، `lateMbps`، `shapingRatio`، `idleRttMs`، `loadedRttMs`، `rttInflation`، `jitterMs`، `lossRate`، `fanoutSuccess`، `freshConnectionMs`، `uplinkMbps`.
- **گیت‌های مطلق** (`src/measurement/gates.js`) با سقف امتیاز (`pass` ۱۰۰ / `warn` ۷۵ / `fail` ۴۵) و برچسب `verdict` (`recommended` … `unusable`).
- بخش `load` در تنظیمات (`durationMs`، `chunkBytes`، `uploadBytes`، `fanoutRequests`، `idleSamples`، `minBytes`، `endpoints`، `gates`) و ویرایش آن از منوی Scan Settings.
- فلگ‌های CLI: `--no-load`، `--load-duration`، `--load-chunk-mb`.
- `estimateTrafficBytes()` برای برآورد حجم ترافیک هر اجرا.
- تست‌های جدید برای پنجره‌های throughput، تشخیص shaping، latency زیر بار، fan-out، گیت‌ها، رتبه‌بندی و migration تنظیمات.

### Changed
- schema گزارش `7`؛ نسخه تولیدکننده `0.7.0`. هر کاندید `load`، `gates`، `verdict`، `scores.load`، `scores.overallUncapped` و `measurement.bytesMeasured` دارد.
- وزن‌های Overall با فعال بودن Real Load: Web Transfer ۳۰٪، Streaming ۳۰٪، Real Load ۲۵٪، Reliability ۱۵٪.
- رتبه‌بندی ابتدا بر اساس `verdict` و سپس امتیاز محافظه‌کارانه انجام می‌شود.
- حجم پیش‌فرض مراحل قبلی افزایش یافت: segmentهای استریم ۱۰ → ۲۴ (اندروید ۱۴)، asset limit انتقال ۶ → ۱۴ (اندروید ۱۰) و timeoutهای سخاوتمندانه‌تر.
- تنظیمات نسخه `3`؛ فایل‌های نسخه ۲ که مقادیر کم پیش‌فرض داشتند به‌صورت خودکار به مقادیر جدید مهاجرت می‌کنند و `migratedFrom` ثبت می‌شود (مقادیر دست‌کاری‌شده کاربر دست‌نخورده می‌ماند).
- جدول رتبه‌بندی CLI ستون‌های `Verdict`، `Mbps`، `Shaping`، `RTT-load` و `Traffic` گرفت؛ `best-ips.txt` هم همین اطلاعات را دارد.
- کلاینت HTTP از متد، بدنه، غیرفعال‌کردن keep-alive و callbackهای first-byte/progress پشتیبانی می‌کند.

### Removed
- ماژول‌های بی‌استفاده `src/probe/aggregate.js` و `src/streaming/aggregate.js`.

## 0.6.0

This release turns CFQoE from a linear probing pipeline into a staged, adaptive measurement system that reports uncertainty instead of hiding it.

### Added
- Wilson score confidence intervals for every candidate's success rate, plus a `conservative` score that ranks IPs by the lower bound instead of the point estimate.
- Confidence labels (`none`, `low`, `medium`, `high`) derived from sample size and how many independent time blocks a candidate was observed in.
- A Sequential Probability Ratio Test (SPRT) verification stage that keeps sampling a finalist only until the evidence is conclusive (`verification.sprt`).
- Concurrency calibration that measures latency inflation, failure-rate increase and event-loop lag before the sweep, and picks the highest safe parallelism (`calibration`).
- Hard and soft failure classification with a delayed retry queue, so transient failures no longer permanently disqualify an IP.
- Cloudflare POP (`cf-ray` colo) extraction and per-candidate POP consistency summaries.
- A `research` profile and `cfqoe research` command with 29 streaming samples, more rounds and stricter verification.
- Adaptive scheduling helpers `runAdaptiveEligibilityBatch` and `selectDelayedRetries`.
- Real ABR support for streaming (`streaming.variantMode = abr`) alongside the fixed-bitrate ladder mode, plus `--abr`, `--verify-limit`, `--no-verify` and `--no-retry` CLI flags.
- HLS handling for `EXT-X-MAP` init segments, `EXT-X-KEY`, byte ranges and discontinuities, all accounted for as startup overhead.
- New docs: [docs/MEASUREMENT-ENGINE.md](docs/MEASUREMENT-ENGINE.md).
- Focused tests for Wilson bounds, confidence labelling, SPRT decisions, error classification, POP summaries, calibration, buffer simulation and throughput estimation.

### Changed
- Report schema is now `6`. Reports declare `scope: "run-relative"`, an explicit `scoreLabel`, and per-candidate `measurement.status` / `measurement.completeness`.
- Scores are no longer renormalised over missing components: an incomplete measurement returns `null` instead of an optimistic number.
- Sustainable bitrate uses the harmonic mean of segment throughput for small samples and only claims a P10 when at least 29 samples exist; the estimator and its confidence are reported.
- Buffer simulation models real playback: only successfully downloaded segments add playable seconds, startup delay includes manifest, init-segment and key overhead, and a session that never fills the startup buffer receives no score.
- The browsing stage is renamed **Web Transfer Score** and is documented as portable HTTP transfer quality, not full browser QoE.
- HTTP client defaults to a single socket per host so the transfer metric is not accidentally a parallel-connection speed test.
- Hard Scan state version is now `3` and carries the retry queue, verification results, error summaries and POP summaries; older checkpoints are migrated automatically.
- Rankings and ranking output are explicitly labelled run-relative, with a `Confidence` and `POP` column.
- Settings are version `2` and gain `verification`, `calibration`, `scan.delayedRetry`, `streaming.variantMode`, `streaming.researchSegments` and `hard.delayedRetry`.

### Fixed
- Failed segments were previously credited with playable buffer, which could make a broken stream look smooth.
- Startup delay ignored manifest and prerequisite fetch time.
- P10 sustainable bitrate was reported from as few as three samples.
- POP information from `cf-ray` was discarded, so results from different Cloudflare colos were compared as if identical.
- `maxSockets` was inconsistent between the transfer probe and the HTTP client.

## 0.5.0

Complete rewrite as a desktop tool. The scanner runs on the user's machine and is driven by an interactive terminal menu.

### Added
- Interactive menu, Windows support, portable data layout, browsing and streaming workloads.
- Report schema 5, structured logs and an offline test suite.

### Changed
- Ranking weights are browsing 45%, streaming 40%, reliability 15%.
- Xray is optional; without it the scanner still reports WebSocket eligibility.

### Unchanged principles
- TCP ping is never used for ranking.
- No multi-connection speed test is performed.

## 0.4.0
- Server-oriented release with real VLESS tunnel probing and process management.
