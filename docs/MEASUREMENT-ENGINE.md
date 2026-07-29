# Measurement Engine (0.6.0)

This document describes how CFQoE 0.6.0 decides *how much to measure*, *when to stop*, and *how much to trust the result*.

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
