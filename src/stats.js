// Robust statistics helpers. All functions ignore non-finite values.
export function finiteValues(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

export function median(values) {
  const sorted = finiteValues(values).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values, p) {
  const sorted = finiteValues(values).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const bounded = Math.max(0, Math.min(100, Number(p)));
  const rank = (bounded / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export function mad(values) {
  const list = finiteValues(values);
  if (list.length === 0) return null;
  const center = median(list);
  return median(list.map((value) => Math.abs(value - center)));
}

export function mean(values) {
  const list = finiteValues(values);
  if (list.length === 0) return null;
  return list.reduce((total, value) => total + value, 0) / list.length;
}

export function harmonicMean(values) {
  const list = finiteValues(values).filter((value) => value > 0);
  if (list.length === 0) return null;
  return list.length / list.reduce((total, value) => total + (1 / value), 0);
}

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreLowerBetter(value, good, bad) {
  if (!Number.isFinite(value) || bad <= good) return null;
  return clamp01((bad - value) / (bad - good));
}

export function scoreHigherBetter(value, good, bad) {
  if (!Number.isFinite(value) || good <= bad) return null;
  return clamp01((value - bad) / (good - bad));
}

export function weightedScore(components, { requireAll = false } = {}) {
  const expected = components.filter(({ weight }) => Number.isFinite(weight) && weight > 0);
  const present = expected.filter(({ score }) => score !== null && score !== undefined && Number.isFinite(score));
  if (present.length === 0 || (requireAll && present.length !== expected.length)) return null;
  const weightSum = present.reduce((total, item) => total + item.weight, 0);
  const total = present.reduce((sum, item) => sum + item.score * item.weight, 0);
  return Math.round((total / weightSum) * 1000) / 10;
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
