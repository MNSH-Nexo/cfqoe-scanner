import fs from 'node:fs/promises';

export function ipv4ToInt(ip) {
  const parts = String(ip).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]);
}

export function intToIpv4(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('IPv4 integer is out of range');
  return [
    Math.floor(value / 0x1000000) % 256,
    Math.floor(value / 0x10000) % 256,
    Math.floor(value / 0x100) % 256,
    value % 256,
  ].join('.');
}

export function parseCidr(input) {
  const text = String(input).trim();
  const [address, prefixText = '32'] = text.split('/');
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error(`Invalid CIDR prefix: ${input}`);
  const raw = ipv4ToInt(address);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(raw / size) * size;
  return { cidr: `${intToIpv4(network)}/${prefix}`, network, prefix, size };
}

export function createRng(seed = Date.now()) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function sampleNetwork(network, perRange, rng) {
  const reserveEdges = network.prefix <= 30;
  const first = network.network + (reserveEdges ? 1 : 0);
  const last = network.network + network.size - 1 - (reserveEdges ? 1 : 0);
  const count = Math.max(0, last - first + 1);
  const wanted = Math.min(Math.max(0, perRange), count);
  if (!wanted) return [];

  // Stratified sampling gives broad coverage without materializing /24 lists.
  const picks = new Set();
  for (let index = 0; index < wanted; index += 1) {
    const lower = Math.floor(index * count / wanted);
    const upper = Math.max(lower + 1, Math.floor((index + 1) * count / wanted));
    const offset = lower + Math.floor(rng() * (upper - lower));
    picks.add(first + Math.min(offset, count - 1));
  }
  return [...picks].map(intToIpv4);
}

export function sampleRanges(cidrLines, { perRange = 4, maxCandidates = 100, seed = 404 } = {}) {
  const rng = createRng(seed);
  const networks = cidrLines.map(parseCidr);
  const candidates = [];
  const seen = new Set();

  for (const network of networks) {
    for (const ip of sampleNetwork(network, perRange, rng)) {
      if (!seen.has(ip)) {
        seen.add(ip);
        candidates.push(ip);
      }
    }
  }

  // Deterministic Fisher-Yates shuffle prevents range-order bias.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return { networks, candidates: candidates.slice(0, maxCandidates) };
}

export async function loadRangeLines(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}
