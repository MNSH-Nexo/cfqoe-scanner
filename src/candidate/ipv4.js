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

export function parseRangeList(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

// Samples usable host addresses, skipping network and broadcast addresses.
export function sampleCandidates({ ranges, perRange = 4, max = 60, seed = 404 }) {
  const random = mulberry32(seed);
  const seen = new Set();
  const candidates = [];

  for (const entry of ranges) {
    const { base, size, network, prefix } = parseCidr(entry);
    const usable = size > 2 ? size - 2 : size;
    const offset = size > 2 ? 1 : 0;
    const take = Math.min(perRange, usable);
    let guard = 0;
    let taken = 0;
    while (taken < take && guard < take * 20) {
      guard += 1;
      const index = offset + Math.floor(random() * usable);
      const ip = intToIp(base + index);
      if (seen.has(ip)) continue;
      seen.add(ip);
      candidates.push({ ip, range: `${network}/${prefix}` });
      taken += 1;
      if (candidates.length >= max) return candidates;
    }
  }
  return candidates;
}
