function validateProbability(value, name) {
  const numeric = Number(value);
  if (!(numeric > 0 && numeric < 1)) throw new Error(`${name} must be between 0 and 1`);
  return numeric;
}

export function createSprtConfig({ p0 = 0.6, p1 = 0.9, alpha = 0.05, beta = 0.1, maxRounds = 16, minRounds = 2 } = {}) {
  p0 = validateProbability(p0, 'p0');
  p1 = validateProbability(p1, 'p1');
  alpha = validateProbability(alpha, 'alpha');
  beta = validateProbability(beta, 'beta');
  if (p1 <= p0) throw new Error('p1 must be greater than p0');
  return {
    p0, p1, alpha, beta,
    maxRounds: Math.max(1, Math.floor(maxRounds)),
    minRounds: Math.max(1, Math.floor(minRounds)),
    acceptBoundary: Math.log((1 - beta) / alpha),
    rejectBoundary: Math.log(beta / (1 - alpha)),
    successIncrement: Math.log(p1 / p0),
    failureIncrement: Math.log((1 - p1) / (1 - p0)),
  };
}

export function evaluateSprt(outcomes, config = createSprtConfig()) {
  let logLikelihood = 0;
  let successes = 0;
  let failures = 0;
  let decision = 'continue';
  for (const outcome of outcomes) {
    if (Boolean(outcome)) {
      successes += 1;
      logLikelihood += config.successIncrement;
    } else {
      failures += 1;
      logLikelihood += config.failureIncrement;
    }
    const attempts = successes + failures;
    if (attempts < config.minRounds) continue;
    if (logLikelihood >= config.acceptBoundary) { decision = 'accept'; break; }
    if (logLikelihood <= config.rejectBoundary) { decision = 'reject'; break; }
  }
  if (decision === 'continue' && successes + failures >= config.maxRounds) decision = 'inconclusive';
  return { decision, logLikelihood, successes, failures, attempts: successes + failures };
}

export async function runSprt({ task, config = createSprtConfig(), onObservation = null }) {
  const observations = [];
  for (let round = 1; round <= config.maxRounds; round += 1) {
    const observation = await task(round);
    observations.push(observation);
    const state = evaluateSprt(observations.map((item) => item.ok), config);
    onObservation?.({ round, observation, ...state });
    if (state.decision !== 'continue') return { observations, ...state };
  }
  return { observations, ...evaluateSprt(observations.map((item) => item.ok), config) };
}
