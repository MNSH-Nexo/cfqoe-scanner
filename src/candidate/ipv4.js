// Deterministic Cloudflare IPv4 candidate sampling.

export function ipToInt(ip) {
  const parts = String(ip).trim().split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`Invalid IPv4 address: ${ip}`);
    const octet = Number(part);
    if (octet > 255) throw new Error(`Invalid IPv4 address: ${ip}`);
    value = value * 256 + octet;
  }
  return value;
}

export function intToIp(value) {
  if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
    throw new Error(`Invalid IPv4 integer: ${value}`);
  }
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join('.');
}

export function parseCidr(cidr) {
  const text = String(cidr).trim();
  const [address, prefixText] = text.split('/');
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }
  const size = 2 ** (32 - prefix);
  const base = Math.floor(ipToInt(address) / size) * size;
  return { network: intToIp(base), prefix, base, size };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeRangeLine(line) {
  const withoutComments = String(line).replace(/#.*$/, '').trim();
  if (withoutComments.length === 0) return null;
  const firstColumn = withoutComments.split(/\t+/)[0].trim();
  if (firstColumn.length === 0) return null;
  if (/^netblock$/i.test(firstColumn)) return null;
  return firstColumn;
}

function shuffleInPlace(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

export function parseRangeList(text) {
  return String(text)
    .split(/\r?\n/)
    .map(normalizeRangeLine)
    .filter(Boolean);
}

function drawIp(state, random, seen) {
  const usable = state.size > 2 ? state.size - 2 : state.size;
  const offset = state.size > 2 ? 1 : 0;
  if (usable <= 0 || state.used.size >= usable) return null;

  const guardLimit = Math.min(Math.max(usable * 2, 8), 2048);
  for (let guard = 0; guard < guardLimit; guard += 1) {
    const index = offset + Math.floor(random() * usable);
    if (state.used.has(index)) continue;
    state.used.add(index);
    const ip = intToIp(state.base + index);
    if (seen.has(ip)) continue;
    seen.add(ip);
    return ip;
  }

  for (let step = 0; step < usable; step += 1) {
    const index = offset + step;
    if (state.used.has(index)) continue;
    state.used.add(index);
    const ip = intToIp(state.base + index);
    if (seen.has(ip)) continue;
    seen.add(ip);
    return ip;
  }

  return null;
}

// Samples usable host addresses, skipping network and broadcast addresses.
// The sampler walks ranges in shuffled round-robin passes so a large catalog
// still gets broad coverage before any range receives many extra picks.
export function sampleCandidates({ ranges, perRange = 4, max = 60, seed = 404 }) {
  const random = mulberry32(seed);
  const seen = new Set();
  const candidates = [];
  const states = shuffleInPlace(
    ranges.map((entry) => {
      const parsed = parseCidr(entry);
      return {
        ...parsed,
        range: `${parsed.network}/${parsed.prefix}`,
        used: new Set(),
      };
    }),
    random,
  );

  for (let pass = 0; pass < perRange && candidates.length < max; pass += 1) {
    for (const state of states) {
      if (candidates.length >= max) break;
      const ip = drawIp(state, random, seen);
      if (!ip) continue;
      candidates.push({ ip, range: state.range });
    }
  }

  return candidates;
}
