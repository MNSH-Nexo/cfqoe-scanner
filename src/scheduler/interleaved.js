import { createRng } from '../candidate/ipv4.js';
import { nullLogger } from '../logging/logger.js';

function shuffled(values, rng) {
  const output = values.slice();
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

async function runPool(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function runInterleaved({
  candidates, rounds, concurrency, seed, worker, onResult,
  logger = nullLogger, stage = 'unknown',
}) {
  const rng = createRng(seed);
  const observations = [];
  const log = logger.child({ component: 'scheduler', stage });
  log.info('scheduler.start', { candidateCount: candidates.length, rounds, concurrency, seed });
  for (let round = 1; round <= rounds; round += 1) {
    const roundStarted = performance.now();
    const order = shuffled(candidates, rng);
    log.info('scheduler.round.start', { round, candidateCount: order.length });
    const roundResults = await runPool(order, concurrency, async (ip) => {
      const taskStarted = performance.now();
      log.debug('scheduler.task.start', { round, ip });
      const result = await worker(ip, round);
      const observation = { ...result, ip, round };
      observations.push(observation);
      log.debug('scheduler.task.complete', {
        round, ip, ok: observation.ok, durationMs: performance.now() - taskStarted, error: observation.error,
      });
      onResult?.(observation, observations.length, candidates.length * rounds);
      return observation;
    });
    if (roundResults.length !== order.length) throw new Error('Scheduler lost observations');
    log.info('scheduler.round.complete', {
      round,
      durationMs: performance.now() - roundStarted,
      successes: roundResults.filter((item) => item.ok).length,
      failures: roundResults.filter((item) => !item.ok).length,
    });
  }
  log.info('scheduler.complete', {
    observationCount: observations.length,
    successes: observations.filter((item) => item.ok).length,
    failures: observations.filter((item) => !item.ok).length,
  });
  return observations;
}
