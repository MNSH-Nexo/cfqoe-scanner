# CFQoE Scanner 0.8.6

This release improves ranking transparency and evidence semantics without changing the measurement budgets, score weights, absolute thresholds, or gate caps.

## Scoring invariants

The following remain unchanged from 0.8.5:

- Overall weights with Real Load: Transfer 30%, Streaming 30%, Load 25%, Reliability 15%.
- Gate caps: pass 100, warn 75, fail 45.
- Balanced/strict/tolerant threshold values.
- Full Scan candidate count, tunnel limit, traffic budget, load duration, and sampling behavior.

A direct 0.8.5 versus 0.8.6 fixture comparison confirmed identical raw scores, final scores, gate status, caps, and verdicts for pass, warn, and fail paths.

## Ranking

Evidence completeness and verdict remain the primary safety boundaries. Inside the same evidence/verdict/final-cap class, ties now use:

1. uncapped conservative score,
2. uncapped overall score,
3. sustained goodput,
4. RPM-style responsiveness,
5. handshake latency.

A failed or warned candidate cannot cross into a safer verdict because of its raw score.

## Evidence reporting

- Final and uncapped scores are displayed together.
- Eligibility confidence is separated from QoE evidence confidence.
- A single complete tunnel round is labelled provisional, not stable or high-confidence.
- Three complete repeated tunnel/load observations with full gate coverage may be labelled medium.
- QoE high confidence is intentionally reserved until explicit goodput/responsiveness convergence is implemented.
- Loaded-latency sample counts and absolute-gate coverage are retained in the report.

## Eligibility-only candidates

Candidates that were not tunnel-tested no longer receive manufactured empty Load gates or the misleading limiter `Sustained downlink: not measured`. Reports distinguish:

- outside tunnel.limit,
- eligibility threshold not met,
- Xray unavailable,
- tunnel stage disabled.

Eligibility-only rows are excluded from limiting-factor totals.

## Gate explanations

All warn/fail/unknown checks are retained. The primary limiting check is selected by status severity first and normalized threshold violation second, rather than static definition order. This changes only the explanation, not the gate result or score.

## RPM scope

CFQoE currently reports an RPM-style estimate calculated from loaded RTT. The CLI no longer describes it as the complete IETF Responsiveness Test, which additionally requires saturation/convergence logic and a larger stable sample.

## Hard Scan consistency

Hard Scan now forwards the configured gate profile to the same gate evaluator used by Full Scan.

## Validation

- Source suite: 145/145 passing.
- Minified release suite: 145/145 passing.
- Syntax checks passed for all generated JavaScript.
- Direct score-invariance comparison against 0.8.5 passed for pass/warn/fail fixtures.
- No credentials, VLESS URIs, or user data were added.
