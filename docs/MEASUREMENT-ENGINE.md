# Measurement Engine (0.7.0)

This document describes how CFQoE decides *how much to measure*, *when to stop*, and *how much to trust the result*.

## 1. Why the previous design was not enough

Up to 0.5.0 the scanner ran a fixed pipeline: a fixed number of eligibility rounds, a fixed number of finalists, a fixed number of segments, one score per IP. That design has three structural problems:

1. **No uncertainty.** `3/3 successful` and `16/16 successful` both produced a 100% success rate, although the evidence is very different.
2. **No adaptivity.** Easy decisions consumed as much budget as hard ones, and hard decisions never received more samples.
3. **Optimism on missing data.** When a stage failed, the remaining weights were renormalised, so an IP that only completed the cheap stage could outrank a fully measured one.

0.6.0 addresses all three.

## 2. Uncertainty: Wilson intervals

For `s` successes out of `n` attempts, the 95% Wilson score interval is computed and stored as `eligibility.confidence95`.

Examples of the lower bound:

| Observation | Point estimate | Wilson lower bound |
| --- | --- | --- |
| 1/1 | 100% | ~20.7% |
| 3/3 | 100% | ~43.9% |
| 16/16 | 100% | ~80.6% |

Ranking uses `scores.conservative`, which substitutes the lower bound for the reliability component. An IP therefore has to be measured more to be ranked highly, which is exactly the intended incentive.

## 3. Confidence labels

Each candidate receives a label based on sample size and temporal spread:

- `provisional` — a single observation only.
- `low` — very few samples, or a single time block.
- `medium` — enough samples for a usable estimate.
- `high` — many samples spread over several independent time blocks.

A `high` label never means "this IP is good"; it means "this measurement is stable".

## 4. Adaptive verification: SPRT

Finalists are verified with a Sequential Probability Ratio Test:

- `p0 = 0.60` — the quality level we reject.
- `p1 = 0.90` — the quality level we accept.
- `alpha = 0.05`, `beta = 0.10`.
- `minRounds = 2`, `maxRounds = 16` (24 in the research profile).

After every round the log-likelihood ratio is updated. A clearly good or clearly bad IP is decided in a few rounds; only ambiguous IPs consume the full budget. The decision (`accept`, `reject`, `inconclusive`) and the number of rounds used are stored in the report.

## 5. Hard and soft failures with delayed retry

Probe errors are classified:

- **Hard** — `403`, `404`, TLS failures, protocol errors, refused connections. These are properties of the endpoint.
- **Soft / retryable** — timeouts, resets, temporary DNS or transport failures. These are properties of the moment.

Soft failures push the candidate into a delayed retry queue, which is drained later in the sweep. This separates "this IP is blocked" from "the network hiccuped while we were measuring".

## 6. Concurrency calibration

Before a sweep the scanner probes a small control set at increasing concurrency levels and measures:

- median latency inflation versus the serial baseline (limit: 10%),
- failure-rate increase (limit: 2 percentage points),
- event-loop lag (limit: 50 ms desktop, 80 ms Android).

The highest level that satisfies all three limits is used. This prevents the scanner from measuring its own congestion instead of the network.

## 7. Throughput estimation

Segment throughput is aggregated with the **harmonic mean** (the correct average for rates), divided by a safety factor of 1.25.

- Fewer than 29 samples: `estimator = harmonic_mean`, no P10 is reported.
- 29 or more samples: a P10 is reported and labelled explicitly.

The estimator name and its confidence travel with the result, so a number can never be quoted without its basis.

## 8. Playback modelling

The buffer simulation now behaves like a player:

- startup delay includes manifest, variant, init-segment and key fetch time,
- only successfully downloaded segments add playable seconds,
- a stall is recorded whenever download time exceeds the buffered seconds,
- a session that never reaches the startup buffer has **no** quality score.

## 9. Web Transfer versus Browser QoE

The HTTP stage measures portable transfer quality: cold fetch, warm fetch, TTFB p90, sub-resource success and temporal stability, with one socket per host. It is deliberately **not** a browser metric: there is no DOM, no JavaScript execution, no rendering and no real browser connection pool. It is reported as **Web Transfer Score** so it is not mistaken for page-load experience.

## 10. Run-relative ranking

A report describes one device, one connection and one time window. Reports therefore declare `scope: "run-relative"`, and every ranking output repeats it. Comparing scores between two runs, two devices or two ISPs is not supported by the methodology.

## 11. Profiles

| Profile | Candidates | Rounds | Streaming samples | Verification |
| --- | --- | --- | --- | --- |
| `quick` | 16 | 2 | 3 | shortened |
| `full` | 120 | 3 | 10 | SPRT, 20 finalists |
| `research` | 240+ | 6+ | 29 | SPRT, 24 finalists, up to 24 rounds |

Quick results are screening only, and their confidence labels say so.


## 12. Real load (0.7.0)

Everything up to 0.6.0 measured a *thin slice* of traffic. A browsing observation fetched a handful of small assets and a streaming observation fetched ten short segments, so a candidate could be ranked from a few hundred kilobytes in total. That is not enough traffic to reveal the failure mode users actually hit: links that look fast for the first few hundred kilobytes and then collapse.

0.7.0 adds a dedicated load stage that runs inside the same Xray tunnel as the other workloads.

### 12.1 What it does

1. **Idle latency baseline** - a few small requests before any load, to know what the link looks like when it is not busy.
2. **Sustained download** - multi-megabyte chunks are pulled back to back until a time budget expires (15 s on Android, 25 s on desktop). Every chunk becomes a throughput window.
3. **Latency under load** - while the download runs, a small request is issued roughly every 250 ms. This is the bufferbloat probe.
4. **Browser-like fan-out** - several requests in parallel on a fresh connection with keep-alive disabled, which is what a browser does on a cold page.
5. **Uplink** - a multi-megabyte POST.

### 12.2 Metrics

| Metric | Meaning |
| --- | --- |
| `sustainedMbps` | total bytes over total transfer time |
| `peakMbps` | best single window |
| `earlyMbps` / `lateMbps` | first third versus last third of windows |
| `shapingRatio` | `lateMbps / earlyMbps`, only reported with at least 3 windows |
| `idleRttMs` / `loadedRttMs` | median RTT before and during load |
| `rttInflation` | `loadedRttMs / idleRttMs` |
| `jitterMs` | p90 minus p10 of loaded RTT |
| `lossRate` | failed probe requests during load |
| `fanoutSuccess` / `freshConnectionMs` | parallel cold-connection behaviour |
| `uplinkMbps` | sustained upload throughput |

`shapingRatio` is the metric that explains the 0.6.0 mismatch: a candidate could score 91 while its throughput dropped by 80% after the first few megabytes, because the old stages never transferred enough bytes to reach the shaping threshold.

### 12.3 Absolute gates

Run-relative scores answer "which of these IPs is best". They cannot answer "is any of these usable". Gates add that second, absolute judgement, and they may only ever *lower* a score.

| Gate | warn | fail |
| --- | --- | --- |
| `sustainedMbps` | < 6 | < 1.5 |
| `shapingRatio` | < 0.7 | < 0.4 |
| `loadedRttMs` | > 250 | > 600 |
| `rttInflation` | > 1.6 | > 3 |
| `jitterMs` | > 60 | > 150 |
| `lossRate` | > 0.02 | > 0.08 |
| `fanoutSuccess` | < 0.98 | < 0.9 |
| `freshConnectionMs` | > 800 | > 2000 |
| `uplinkMbps` | < 1 | < 0.25 |

Score caps: `pass` -> 100, `warn` -> 75, `fail` -> 45, missing data -> 75. Reports keep both the capped score (`scores.overall`) and the raw one (`scores.overallUncapped`) so the effect of the gates is auditable.

Verdicts, in ranking order: `recommended`, `good`, `usable`, `browsing-only`, `unverified`, `unusable`. Ranking sorts by verdict first, then by the conservative score, so a gated-out candidate can never sit at the top of the list.

### 12.4 Traffic budget

With the 0.7.0 defaults each fully measured finalist moves tens of megabytes instead of a few hundred kilobytes: sustained download plus a multi-megabyte upload, plus the enlarged streaming (24 segments) and transfer (14 assets) stages. `estimateTrafficBytes(settings)` reports the planned volume, `measurement.bytesMeasured` reports the observed volume per candidate, and `totals.bytesMeasured` the run total.

On metered connections use `--no-load`, `--load-duration`, `--load-chunk-mb`, or the new load fields in *Scan Settings*.

### 12.5 Settings migration

Settings are now version `3`. Version 2 files that still carry the old undersized values (10 streaming segments, 6 transfer assets, tight timeouts) are migrated to the new defaults automatically and record `migratedFrom: 2`. Values the user deliberately changed are preserved.
