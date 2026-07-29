function positiveInteger(value, fallback = 1) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function collectCandidateBatch({ plan, cursor, limit, nextCandidate }) {
  const candidates = [];
  let nextCursor = cursor;
  const batchLimit = positiveInteger(limit);

  while (candidates.length < batchLimit) {
    const candidate = nextCandidate(plan, nextCursor);
    if (!candidate) break;
    candidates.push(candidate);
    nextCursor = candidate.nextCursor;
  }

  return candidates;
}

export async function probeCandidateRounds({
  candidate,
  rounds,
  minimumSuccessRate,
  task,
}) {
  const totalRounds = positiveInteger(rounds);
  const threshold = Math.max(0, Math.min(1, Number(minimumSuccessRate) || 0));
  const requiredSuccesses = Math.ceil((totalRounds * threshold) - Number.EPSILON);
  const observations = [];
  let successes = 0;

  for (let round = 1; round <= totalRounds; round += 1) {
    const observation = await task(candidate, round);
    observations.push(observation);
    if (observation.ok) successes += 1;

    const remaining = totalRounds - round;
    if (successes + remaining < requiredSuccesses) break;
  }

  return observations;
}

// Runs a bounded set of candidates concurrently while preserving input order in
// the returned array. Each candidate's rounds remain sequential, avoiding a
// burst of duplicate connections to the same edge IP.
export async function runEligibilityBatch({
  candidates,
  rounds,
  concurrency,
  minimumSuccessRate,
  task,
  onCandidateDone = null,
}) {
  if (candidates.length === 0) return [];
  const results = new Array(candidates.length);
  const workerCount = Math.min(positiveInteger(concurrency), candidates.length);
  let cursor = 0;
  let finished = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const candidate = candidates[index];
      const observations = await probeCandidateRounds({
        candidate,
        rounds,
        minimumSuccessRate,
        task,
      });
      results[index] = { candidate, observations };
      finished += 1;
      onCandidateDone?.({ candidate, observations, finished, total: candidates.length });
    }
  });

  await Promise.all(workers);
  return results;
}
