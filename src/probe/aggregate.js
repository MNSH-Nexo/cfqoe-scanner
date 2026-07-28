import { mad, median, quantile, round } from '../stats/robust.js';

export function aggregateObservations(candidates, observations, minimumSuccessRate = 0.67) {
  const byIp = new Map(candidates.map((ip) => [ip, []]));
  for (const observation of observations) {
    if (!byIp.has(observation.ip)) byIp.set(observation.ip, []);
    byIp.get(observation.ip).push(observation);
  }

  const rows = [];
  for (const [ip, samples] of byIp) {
    const successes = samples.filter((sample) => sample.ok);
    const successRate = samples.length ? successes.length / samples.length : 0;
    const firstBytes = successes.map((sample) => sample.firstByteMs);
    const connects = successes.map((sample) => sample.connectMs);
    const colos = [...new Set(successes.map((sample) => sample.colo).filter(Boolean))];
    const errors = samples.filter((sample) => !sample.ok).map((sample) => sample.error);
    const cloudflareRate = successes.length
      ? successes.filter((sample) => sample.cloudflare).length / successes.length
      : 0;

    rows.push({
      ip,
      eligible: successRate >= minimumSuccessRate,
      attempts: samples.length,
      successes: successes.length,
      successRate: round(successRate * 100),
      cloudflareRate: round(cloudflareRate * 100),
      wsTtfbMedianMs: round(median(firstBytes)),
      wsTtfbP90Ms: round(quantile(firstBytes, 0.9)),
      wsTtfbMadMs: round(mad(firstBytes)),
      connectMedianMs: round(median(connects)),
      colos,
      errors,
    });
  }

  rows.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible)
    || b.successRate - a.successRate
    || b.cloudflareRate - a.cloudflareRate
    || (a.wsTtfbP90Ms ?? Infinity) - (b.wsTtfbP90Ms ?? Infinity)
    || (a.wsTtfbMadMs ?? Infinity) - (b.wsTtfbMadMs ?? Infinity)
  );
  return rows;
}
