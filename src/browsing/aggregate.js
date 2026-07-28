import { mad, median, quantile, round } from '../stats/robust.js';

function quality(value, excellent, unacceptable) {
  if (!Number.isFinite(value)) return 0;
  if (value <= excellent) return 100;
  if (value >= unacceptable) return 0;
  return 100 * (unacceptable - value) / (unacceptable - excellent);
}

export function aggregateBrowsing(ips, observations) {
  const byIp = new Map(ips.map((ip) => [ip, []]));
  for (const observation of observations) {
    if (!byIp.has(observation.ip)) byIp.set(observation.ip, []);
    byIp.get(observation.ip).push(observation);
  }

  const rows = [];
  for (const [ip, samples] of byIp) {
    const phases = samples.flatMap((sample) => [sample.cold, sample.warm]).filter(Boolean);
    const successRate = phases.length
      ? phases.reduce((sum, phase) => sum + phase.successRate, 0) / phases.length
      : 0;
    const coldPages = samples.map((sample) => sample.cold?.pageMs).filter(Number.isFinite);
    const warmPages = samples.map((sample) => sample.warm?.pageMs).filter(Number.isFinite);
    const resourceTtfb = phases.flatMap((phase) => phase.ttfbMs || []).filter(Number.isFinite);
    const pageValues = [...coldPages, ...warmPages];

    const coldMedian = median(coldPages);
    const warmMedian = median(warmPages);
    const ttfbP90 = quantile(resourceTtfb, 0.9);
    const pageMad = mad(pageValues);
    const browsingScore =
      successRate * 40
      + quality(coldMedian, 1200, 7000) * 0.15
      + quality(warmMedian, 700, 5000) * 0.20
      + quality(ttfbP90, 300, 2500) * 0.15
      + quality(pageMad, 100, 2000) * 0.10;

    rows.push({
      ip,
      browsingScore: round(browsingScore),
      browsingSuccessRate: round(successRate * 100),
      coldPageMedianMs: round(coldMedian),
      coldPageP90Ms: round(quantile(coldPages, 0.9)),
      warmPageMedianMs: round(warmMedian),
      warmPageP90Ms: round(quantile(warmPages, 0.9)),
      resourceTtfbP90Ms: round(ttfbP90),
      pageMadMs: round(pageMad),
      browsingErrors: samples.filter((sample) => !sample.ok).map((sample) => sample.error).filter(Boolean),
    });
  }
  rows.sort((a, b) => b.browsingScore - a.browsingScore || b.browsingSuccessRate - a.browsingSuccessRate);
  return rows;
}

export function mergeBrowsing(eligibilityRows, browsingRows) {
  const byIp = new Map(browsingRows.map((row) => [row.ip, row]));
  const merged = eligibilityRows.map((row) => ({ ...row, ...(byIp.get(row.ip) || {}) }));
  merged.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible)
    || (b.browsingScore ?? -1) - (a.browsingScore ?? -1)
    || b.successRate - a.successRate
    || (a.wsTtfbP90Ms ?? Infinity) - (b.wsTtfbP90Ms ?? Infinity)
  );
  return merged;
}
