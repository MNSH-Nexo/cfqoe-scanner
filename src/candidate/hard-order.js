import { parseCidr, intToIp } from './ipv4.js';

function usableMeta(cidr) {
  const parsed = parseCidr(cidr);
  const usable = parsed.size > 2 ? parsed.size - 2 : parsed.size;
  const startOffset = parsed.size > 2 ? 1 : 0;
  return { ...parsed, usable, startOffset, range: `${parsed.network}/${parsed.prefix}` };
}

export function buildRangePlan(ranges) {
  const entries = ranges.map(usableMeta);
  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.usable, 0),
    maxDepth: entries.reduce((maximum, entry) => Math.max(maximum, entry.usable), 0),
  };
}

// Breadth-first traversal: host #1 from every range, then host #2 from every
// range, and so on. Short ranges are skipped after they run out of hosts.
export function nextRoundRobinCandidate(plan, cursor = {}) {
  const { entries, maxDepth } = plan;
  if (entries.length === 0 || maxDepth === 0) return null;

  let rangeIndex = Number.isInteger(cursor.rangeIndex) ? cursor.rangeIndex : 0;
  let passIndex = Number.isInteger(cursor.passIndex) ? cursor.passIndex : 0;

  while (passIndex < maxDepth) {
    const currentRangeIndex = rangeIndex;
    const hostIndex = passIndex;
    const meta = entries[currentRangeIndex];

    rangeIndex += 1;
    if (rangeIndex >= entries.length) {
      rangeIndex = 0;
      passIndex += 1;
    }

    if (hostIndex >= meta.usable) continue;
    return {
      ip: intToIp(meta.base + meta.startOffset + hostIndex),
      range: meta.range,
      rangeIndex: currentRangeIndex,
      hostIndex,
      nextCursor: { rangeIndex, passIndex },
    };
  }

  return null;
}

// Compatibility path for checkpoints created before range round-robin mode.
export function nextLegacyCandidate(plan, cursor = {}) {
  let rangeIndex = Number.isInteger(cursor.rangeIndex) ? cursor.rangeIndex : 0;
  let hostIndex = Number.isInteger(cursor.hostIndex) ? cursor.hostIndex : 0;

  while (rangeIndex < plan.entries.length) {
    const meta = plan.entries[rangeIndex];
    if (hostIndex >= meta.usable) {
      rangeIndex += 1;
      hostIndex = 0;
      continue;
    }
    return {
      ip: intToIp(meta.base + meta.startOffset + hostIndex),
      range: meta.range,
      rangeIndex,
      hostIndex,
      nextCursor: { rangeIndex, hostIndex: hostIndex + 1 },
    };
  }

  return null;
}
