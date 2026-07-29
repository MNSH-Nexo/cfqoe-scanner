import { classifyProbeError } from './probe/errors.js';
import { createSprtConfig, runSprt } from './measurement/sprt.js';

function positiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function collectCandidateBatch({ plan, cursor, limit, nextCandidate }) {
  const candidates = [];
  let nextCursor = cursor;
  while (candidates.length < positiveInteger(limit)) {
    const candidate = nextCandidate(plan, nextCursor);
    if (!candidate) break;
    candidates.push(candidate);
    nextCursor = candidate.nextCursor;
  }
  return candidates;
}

export async function probeCandidateRounds({ candidate, rounds, minimumSuccessRate, task }) {
  const totalRounds = positiveInteger(rounds);
  const threshold = Math.max(0, Math.min(1, Number(minimumSuccessRate) || 0));
  const requiredSuccesses = Math.ceil((totalRounds * threshold) - Number.EPSILON);
  const observations = [];
  let successes = 0;
  for (let round = 1; round <= totalRounds; round += 1) {
    const observation = await task(candidate, round);
    observations.push(observation);
    if (observation.ok) successes += 1;
    if (successes + (totalRounds - round) < requiredSuccesses) break;
  }
  return observations;
}

async function runWorkers({ candidates, concurrency, worker }) {
  const results = new Array(candidates.length);
  const workerCount = Math.min(positiveInteger(concurrency), candidates.length);
  let cursor = 0;
  let finished = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      results[index] = await worker(candidates[index], index);
      finished += 1;
      results[index].finished = finished;
    }
  }));
  return results;
}

export async function runEligibilityBatch({ candidates, rounds, concurrency, minimumSuccessRate, task, onCandidateDone = null }) {
  if (candidates.length === 0) return [];
  const results = await runWorkers({
    candidates, concurrency,
    worker: async (candidate) => ({ candidate, observations: await probeCandidateRounds({ candidate, rounds, minimumSuccessRate, task }) }),
  });
  for (const result of results) onCandidateDone?.({ ...result, total: candidates.length });
  return results.map(({ finished, ...result }) => result);
}

export async function runAdaptiveEligibilityBatch({ candidates, concurrency, task, sprt = {}, onCandidateDone = null }) {
  if (candidates.length === 0) return [];
  const config = createSprtConfig(sprt);
  const results = await runWorkers({
    candidates, concurrency,
    worker: async (candidate) => {
      const evaluated = await runSprt({ task: (round) => task(candidate, round), config });
      return { candidate, ...evaluated };
    },
  });
  for (const result of results) onCandidateDone?.({ ...result, total: candidates.length });
  return results.map(({ finished, ...result }) => result);
}

export function selectDelayedRetries(results, { maxRetries = Infinity } = {}) {
  return results
    .filter(({ observations }) => observations?.some((item) => !item.ok && classifyProbeError(item.error).retryable))
    .slice(0, maxRetries)
    .map(({ candidate }) => candidate);
}
