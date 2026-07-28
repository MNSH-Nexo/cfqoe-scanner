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
  const rank = (p / 100) * (sorted.length - 1);
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

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// 1 when value <= good, 0 when value >= bad, linear in between.
export function scoreLowerBetter(value, good, bad) {
  if (!Number.isFinite(value)) return null;
  if (bad <= good) return null;
  return clamp01((bad - value) / (bad - good));
}

// 1 when value >= good, 0 when value <= bad, linear in between.
export function scoreHigherBetter(value, good, bad) {
  if (!Number.isFinite(value)) return null;
  if (good <= bad) return null;
  return clamp01((value - bad) / (good - bad));
}

// Weighted average that silently drops missing components and renormalizes.
export function weightedScore(components) {
  let weightSum = 0;
  let total = 0;
  for (const { score, weight } of components) {
    if (score === null || score === undefined || !Number.isFinite(score)) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    total += score * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  return Math.round((total / weightSum) * 1000) / 10;
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
