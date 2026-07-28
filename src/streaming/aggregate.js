import { mad, median, quantile, round } from '../stats/robust.js';

function quality(value, excellent, unacceptable, lowerIsBetter = true) {
  if (!Number.isFinite(value)) return 0;
  const adjusted = lowerIsBetter ? value : -value;
  const good = lowerIsBetter ? excellent : -excellent;
  const bad = lowerIsBetter ? unacceptable : -unacceptable;
  if (adjusted <= good) return 100;
  if (adjusted >= bad) return 0;
  return 100 * (bad - adjusted) / (bad - good);
}

export function aggregateStreaming(ips, observations) {
  const byIp = new Map(ips.map((ip) => [ip, []]));
  for (const observation of observations) {
    if (!byIp.has(observation.ip)) byIp.set(observation.ip, []);
    byIp.get(observation.ip).push(observation);
  }

  const rows = [];
  for (const [ip, samples] of byIp) {
    const allSegments = samples.flatMap((sample) => sample.profiles || []).flatMap((profile) => profile.segments || []);
    const segmentSuccessRate = allSegments.length ? allSegments.filter((segment) => segment.ok).length / allSegments.length : 0;
    const bestProfiles = samples.map((sample) => sample.sustainable).filter(Boolean);
    const bitrates = bestProfiles.map((profile) => profile.bitrateMbps);
    const startupDelays = bestProfiles.map((profile) => profile.startupDelayMs);
    const throughputs = allSegments.filter((segment) => segment.ok).map((segment) => segment.throughputMbps);
    const stallRatios = samples.flatMap((sample) => sample.profiles || []).map((profile) => profile.rebufferRatio).filter(Number.isFinite);
    const sustainableBitrate = quantile(bitrates, 0.1) || 0;
    const startupP90 = quantile(startupDelays, 0.9);
    const rebufferP90 = quantile(stallRatios, 0.9) ?? 1;
    const throughputP10 = quantile(throughputs, 0.1) || 0;
    const throughputMad = mad(throughputs);
    const score = segmentSuccessRate * 35
      + quality(startupP90, 800, 6000) * 0.15
      + quality(rebufferP90, 0, 0.10) * 0.30
      + quality(sustainableBitrate, 8, 0.8, false) * 0.20;
    const conservative = bestProfiles.slice().sort((a, b) => a.bitrateMbps - b.bitrateMbps)[0] || null;

    rows.push({
      ip, streamingScore: round(score), segmentSuccessRate: round(segmentSuccessRate * 100),
      sustainableBitrateMbps: round(sustainableBitrate, 2), sustainableQuality: conservative?.name || null,
      startupDelayMedianMs: round(median(startupDelays)), startupDelayP90Ms: round(startupP90),
      rebufferRatioP90: round(rebufferP90, 4), segmentThroughputP10Mbps: round(throughputP10, 2),
      segmentThroughputMadMbps: round(throughputMad, 2),
      streamingErrors: samples.filter((sample) => !sample.ok).map((sample) => sample.error).filter(Boolean),
    });
  }
  rows.sort((a, b) => b.streamingScore - a.streamingScore || b.sustainableBitrateMbps - a.sustainableBitrateMbps);
  return rows;
}

export function mergeStreaming(rows, streamingRows) {
  const byIp = new Map(streamingRows.map((row) => [row.ip, row]));
  const merged = rows.map((row) => {
    const combined = { ...row, ...(byIp.get(row.ip) || {}) };
    const parts = [];
    if (Number.isFinite(combined.browsingScore)) parts.push([combined.browsingScore, 0.45]);
    if (Number.isFinite(combined.streamingScore)) parts.push([combined.streamingScore, 0.40]);
    parts.push([combined.successRate ?? 0, 0.15]);
    const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
    combined.overallScore = round(parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight);
    return combined;
  });
  merged.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.overallScore ?? -1) - (a.overallScore ?? -1));
  return merged;
}
