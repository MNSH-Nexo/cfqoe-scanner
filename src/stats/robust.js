export function sorted(values) {
  return values.filter(Number.isFinite).slice().sort((a, b) => a - b);
}

export function quantile(values, q) {
  const xs = sorted(values);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const pos = Math.max(0, Math.min(1, q)) * (xs.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const weight = pos - lo;
  return xs[lo] * (1 - weight) + xs[hi] * weight;
}

export function median(values) {
  return quantile(values, 0.5);
}

export function mad(values) {
  const center = median(values);
  if (center === null) return null;
  return median(values.filter(Number.isFinite).map((value) => Math.abs(value - center)));
}

export function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
