import { round } from '../stats.js';

export function wilsonInterval(successes, attempts, z = 1.959963984540054) {
  const n = Math.max(0, Math.floor(Number(attempts)));
  const s = Math.max(0, Math.min(n, Math.floor(Number(successes))));
  if (n === 0) return { lower: 0, upper: 1, center: null, confidence: 0.95 };
  const p = s / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)));
  return {
    lower: round(Math.max(0, center - margin), 4),
    upper: round(Math.min(1, center + margin), 4),
    center: round(center, 4),
    confidence: 0.95,
  };
}

export function confidenceLabel({ attempts, successes, temporalBlocks = 1 }) {
  const interval = wilsonInterval(successes, attempts);
  if (attempts <= 1) return 'provisional';
  if (attempts < 8 || temporalBlocks < 2) return 'low';
  if (attempts < 16 || temporalBlocks < 3 || interval.lower < 0.8) return 'medium';
  return 'high';
}

export function extractCloudflareColo(cfRay) {
  if (typeof cfRay !== 'string') return null;
  const match = cfRay.trim().match(/-([A-Za-z]{3})(?:\b|$)/);
  return match ? match[1].toUpperCase() : null;
}

export function summarizePops(observations) {
  const counts = new Map();
  for (const item of observations || []) {
    const colo = item.colo || extractCloudflareColo(item.cfRay);
    if (colo) counts.set(colo, (counts.get(colo) || 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const observed = [...counts.entries()]
    .map(([colo, count]) => ({ colo, count, share: total ? round(count / total, 3) : 0 }))
    .sort((a, b) => b.count - a.count || a.colo.localeCompare(b.colo));
  return {
    observed,
    dominant: observed[0]?.colo || null,
    consistency: total ? round((observed[0]?.count || 0) / total, 3) : null,
  };
}
