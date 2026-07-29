import { performance } from 'node:perf_hooks';
import { median, round } from '../stats.js';

function startLagMonitor(intervalMs = 10) {
  let expected = performance.now() + intervalMs;
  let maximum = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maximum = Math.max(maximum, now - expected);
    expected = now + intervalMs;
  }, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    return round(maximum, 2) || 0;
  };
}

// Finds the highest concurrency level that does not distort the measurement
// itself. A level is rejected when latency inflates, failures increase, or the
// local event loop becomes the bottleneck instead of the network path.
export async function calibrateConcurrency({
  levels = [1, 2, 4, 8, 12, 16],
  controlTask,
  latencyInflationLimit = 0.1,
  failureRateIncreaseLimit = 0.02,
  eventLoopLagLimitMs = 50,
}) {
  if (typeof controlTask !== 'function') throw new Error('controlTask is required');
  const uniqueLevels = [...new Set(levels.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    .sort((a, b) => a - b);
  if (uniqueLevels.length === 0) throw new Error('at least one concurrency level is required');

  const results = [];
  let baseline = null;
  let selected = uniqueLevels[0];

  for (const level of uniqueLevels) {
    const stopLag = startLagMonitor();
    const observations = await Promise.all(
      Array.from({ length: level }, (_value, index) => controlTask({ level, index })),
    );
    const eventLoopLagMs = stopLag();
    const successful = observations.filter((item) => item?.ok);
    const latencyMs = median(successful.map((item) => item.latencyMs ?? item.handshakeMs ?? item.totalMs));
    const failureRate = observations.length ? 1 - successful.length / observations.length : 1;
    if (!baseline) baseline = { latencyMs, failureRate };

    const latencyInflation = Number.isFinite(latencyMs) && Number.isFinite(baseline.latencyMs) && baseline.latencyMs > 0
      ? latencyMs / baseline.latencyMs - 1
      : Infinity;
    const failureIncrease = failureRate - baseline.failureRate;
    const accepted = latencyInflation <= latencyInflationLimit
      && failureIncrease <= failureRateIncreaseLimit
      && eventLoopLagMs <= eventLoopLagLimitMs;

    results.push({
      level,
      accepted,
      latencyMs: round(latencyMs, 2),
      failureRate: round(failureRate, 4),
      latencyInflation: Number.isFinite(latencyInflation) ? round(latencyInflation, 4) : null,
      failureIncrease: round(failureIncrease, 4),
      eventLoopLagMs,
    });

    if (accepted) selected = level;
    else if (level !== uniqueLevels[0]) break;
  }

  return { selectedConcurrency: selected, baseline, levels: results };
}
