import fs from 'node:fs';
import path from 'node:path';
import { median, percentile, mad, weightedScore, round } from './stats.js';

export const REPORT_SCHEMA = 5;

// Combines eligibility, browsing and streaming observations into one ranking.
export function buildCandidateSummary({ ip, range, eligibility, tunnel }) {
  const handshakes = eligibility.filter((item) => item.ok).map((item) => item.handshakeMs);
  const connects = eligibility.filter((item) => item.ok).map((item) => item.connectMs);
  const successRate = eligibility.length === 0 ? 0 : eligibility.filter((item) => item.ok).length / eligibility.length;

  const browsingScores = (tunnel?.browsing || []).map((item) => item.score).filter((value) => value !== null);
  const streamingScores = (tunnel?.streaming || []).map((item) => item.score).filter((value) => value !== null);

  const browsingScore = browsingScores.length > 0 ? round(median(browsingScores), 1) : null;
  const streamingScore = streamingScores.length > 0 ? round(median(streamingScores), 1) : null;

  const overall = weightedScore([
    { score: browsingScore === null ? null : browsingScore / 100, weight: 45 },
    { score: streamingScore === null ? null : streamingScore / 100, weight: 40 },
    { score: successRate, weight: 15 },
  ]);

  return {
    ip,
    range,
    eligibility: {
      attempts: eligibility.length,
      successRate: round(successRate, 3),
      handshakeMedianMs: round(median(handshakes), 2),
      handshakeP90Ms: round(percentile(handshakes, 90), 2),
      handshakeMadMs: round(mad(handshakes), 2),
      connectMedianMs: round(median(connects), 2),
      cfRay: eligibility.find((item) => item.cfRay)?.cfRay ? true : false,
    },
    browsing: summarizeBrowsing(tunnel?.browsing || []),
    streaming: summarizeStreaming(tunnel?.streaming || []),
    scores: {
      browsing: browsingScore,
      streaming: streamingScore,
      reliability: round(successRate * 100, 1),
      overall,
    },
  };
}

function summarizeBrowsing(items) {
  if (items.length === 0) return null;
  return {
    observations: items.length,
    coldMedianMs: round(median(items.map((item) => item.coldMs)), 2),
    warmMedianMs: round(median(items.map((item) => item.warmMs)), 2),
    ttfbP90Ms: round(median(items.map((item) => item.ttfbP90Ms)), 2),
    successRate: round(median(items.map((item) => item.successRate)), 3),
    bytes: items.reduce((total, item) => total + (item.bytes || 0), 0),
  };
}

function summarizeStreaming(items) {
  if (items.length === 0) return null;
  return {
    observations: items.length,
    sustainableMbps: round(median(items.map((item) => item.sustainableMbps)), 3),
    p10Mbps: round(median(items.map((item) => item.p10Mbps)), 3),
    quality: items.find((item) => item.quality)?.quality || null,
    startupDelaySec: round(median(items.map((item) => item.startupDelaySec)), 3),
    rebufferRatio: round(median(items.map((item) => item.rebufferRatio)), 4),
    bytes: items.reduce((total, item) => total + (item.bytes || 0), 0),
  };
}

export function rankCandidates(summaries) {
  return summaries.slice().sort((a, b) => {
    const scoreA = a.scores.overall ?? -1;
    const scoreB = b.scores.overall ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.eligibility.handshakeMedianMs ?? Infinity) - (b.eligibility.handshakeMedianMs ?? Infinity);
  });
}

export function writeReport({ directory, runId, target, settings, candidates, startedAt }) {
  fs.mkdirSync(directory, { recursive: true });
  const ranked = rankCandidates(candidates);

  const report = {
    schema: REPORT_SCHEMA,
    generator: 'cfqoe-scanner',
    version: '0.5.0',
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    target,
    settings,
    totals: {
      candidates: ranked.length,
      eligible: ranked.filter((item) => item.eligibility.successRate > 0).length,
      withBrowsing: ranked.filter((item) => item.scores.browsing !== null).length,
      withStreaming: ranked.filter((item) => item.scores.streaming !== null).length,
    },
    results: ranked,
  };

  const jsonPath = path.join(directory, `run-${runId}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  const latestPath = path.join(directory, 'latest.json');
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  const topPath = path.join(directory, 'best-ips.txt');
  fs.writeFileSync(topPath, `${renderTopList(ranked)}\n`, { mode: 0o600 });

  return { jsonPath, latestPath, topPath, report };
}

export function renderTopList(ranked, limit = 20) {
  const header = ['IP', 'Overall', 'Browsing', 'Streaming', 'Reliability', 'Quality'].join('\t');
  const lines = ranked.slice(0, limit).map((item) =>
    [
      item.ip,
      item.scores.overall ?? '-',
      item.scores.browsing ?? '-',
      item.scores.streaming ?? '-',
      item.scores.reliability ?? '-',
      item.streaming?.quality || '-',
    ].join('\t'),
  );
  return [header, ...lines].join('\n');
}
