import { createHttpClient, extractAssets } from '../net/http.js';
import { median, percentile, mad, scoreLowerBetter, weightedScore, round } from '../stats.js';

// Portable network workload. This is deliberately reported as "Web Transfer",
// not browser QoE: there is no rendering engine, no CSSOM, no layout, and no
// Core Web Vitals here.
export async function probeBrowsing({
  workload,
  proxy = null,
  timeoutMs = 15000,
  assetLimit = 6,
  maxSockets = 1,
  logger = null,
}) {
  const client = createHttpClient({ proxy, timeoutMs, maxSockets });
  const resources = [];
  try {
    const cold = await client.request(workload.pageUrl, { captureBody: true, maxBytes: 2 * 1024 * 1024 });
    resources.push({ kind: 'document', phase: 'cold', ...stripBody(cold) });
    logger?.debug('web_transfer.document', { url: workload.pageUrl, ok: cold.ok, totalMs: cold.totalMs });
    if (!cold.ok) return summarize({ workload, resources, error: cold.error || 'cold_failed' });

    const assets = Array.isArray(workload.assetUrls) && workload.assetUrls.length > 0
      ? workload.assetUrls.slice(0, assetLimit)
      : extractAssets(cold.body?.toString('utf8') || '', workload.pageUrl, assetLimit);

    for (const assetUrl of assets) {
      const result = await client.request(assetUrl, { maxBytes: 3 * 1024 * 1024 });
      resources.push({ kind: 'asset', phase: 'cold', ...stripBody(result) });
      logger?.debug('web_transfer.asset', { url: assetUrl, ok: result.ok, totalMs: result.totalMs });
    }

    const warm = await client.request(workload.pageUrl, { maxBytes: 2 * 1024 * 1024 });
    resources.push({ kind: 'document', phase: 'warm', ...stripBody(warm) });
    return summarize({ workload, resources, error: null });
  } finally {
    client.close();
  }
}

function stripBody(result) {
  const { body, ...rest } = result;
  return rest;
}

function summarize({ workload, resources, error }) {
  const successes = resources.filter((item) => item.ok);
  const successRate = resources.length ? successes.length / resources.length : 0;
  const cold = resources.find((item) => item.kind === 'document' && item.phase === 'cold') || null;
  const warm = resources.find((item) => item.kind === 'document' && item.phase === 'warm') || null;
  const ttfbValues = successes.map((item) => item.ttfbMs);
  const totals = successes.map((item) => item.totalMs);
  const bytes = resources.reduce((total, item) => total + (item.bytes || 0), 0);

  // requireAll keeps a broken workload from scoring well just because the
  // remaining components happened to be fast.
  const score = weightedScore([
    { score: successRate, weight: 40 },
    { score: scoreLowerBetter(cold?.ok ? cold.totalMs : NaN, 400, 4000), weight: 15 },
    { score: scoreLowerBetter(warm?.ok ? warm.totalMs : NaN, 200, 2500), weight: 20 },
    { score: scoreLowerBetter(percentile(ttfbValues, 90), 150, 1800), weight: 15 },
    { score: scoreLowerBetter(mad(totals), 40, 900), weight: 10 },
  ], { requireAll: true });

  return {
    metric: 'web-transfer',
    workload: workload.name,
    pageUrl: workload.pageUrl,
    resourceCount: resources.length,
    successRate: round(successRate, 3),
    coldMs: cold?.ok ? cold.totalMs : null,
    warmMs: warm?.ok ? warm.totalMs : null,
    ttfbMedianMs: round(median(ttfbValues), 2),
    ttfbP90Ms: round(percentile(ttfbValues, 90), 2),
    stabilityMadMs: round(mad(totals), 2),
    bytes,
    score,
    error,
    resources,
  };
}
