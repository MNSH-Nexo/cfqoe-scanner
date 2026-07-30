import { createHttpClient, extractAssets } from '../net/http.js';
import { median, percentile, mad, scoreLowerBetter, weightedScore, round } from '../stats.js';

const MIB = 1024 * 1024;
const DEFAULT_BROWSING_MAX_BYTES = 5 * MIB;
const READ_SLACK_BYTES = 64 * 1024;
const WARM_RESERVE_BYTES = 512 * 1024;

function createBudget(limitBytes) {
  const limit = Math.max(0, Math.floor(Number(limitBytes) || 0));
  let actualBytes = 0;
  return {
    get limitBytes() { return limit; },
    get actualBytes() { return actualBytes; },
    get remainingBytes() { return Math.max(0, limit - actualBytes); },
    account(bytes) { actualBytes += Math.max(0, Math.floor(Number(bytes) || 0)); },
  };
}

async function budgetedRequest(client, budget, url, options = {}, reserveBytes = 0) {
  const available = budget.remainingBytes - Math.max(0, reserveBytes) - READ_SLACK_BYTES;
  if (available <= 0) return { url, ok: false, error: 'traffic_budget_exhausted', bytes: 0, totalMs: 0, ttfbMs: null };
  const maxBytes = Math.max(1, Math.min(Number(options.maxBytes) || available, available));
  const result = await client.request(url, { ...options, maxBytes });
  budget.account(result.bytes);
  return result;
}

// Portable network workload. This is deliberately reported as "Web Transfer",
// not browser QoE: there is no rendering engine, no CSSOM, no layout, and no
// Core Web Vitals here.
export async function probeBrowsing({
  workload,
  proxy = null,
  timeoutMs = 15000,
  assetLimit = 6,
  maxSockets = 1,
  maxBytes = DEFAULT_BROWSING_MAX_BYTES,
  logger = null,
}) {
  const client = createHttpClient({ proxy, timeoutMs, maxSockets });
  const budget = createBudget(maxBytes);
  const resources = [];
  try {
    const cold = await budgetedRequest(client, budget, workload.pageUrl, { captureBody: true, maxBytes: 2 * MIB }, WARM_RESERVE_BYTES);
    resources.push({ kind: 'document', phase: 'cold', ...stripBody(cold) });
    logger?.debug('web_transfer.document', { url: workload.pageUrl, ok: cold.ok, totalMs: cold.totalMs, bytes: cold.bytes });
    if (!cold.ok) return summarize({ workload, resources, error: cold.error || 'cold_failed', budget });

    const assets = Array.isArray(workload.assetUrls) && workload.assetUrls.length > 0
      ? workload.assetUrls.slice(0, assetLimit)
      : extractAssets(cold.body?.toString('utf8') || '', workload.pageUrl, assetLimit);

    for (const assetUrl of assets) {
      if (budget.remainingBytes <= WARM_RESERVE_BYTES + READ_SLACK_BYTES) break;
      const result = await budgetedRequest(client, budget, assetUrl, { maxBytes: 3 * MIB }, WARM_RESERVE_BYTES);
      resources.push({ kind: 'asset', phase: 'cold', ...stripBody(result) });
      logger?.debug('web_transfer.asset', { url: assetUrl, ok: result.ok, totalMs: result.totalMs, bytes: result.bytes });
      if (result.error === 'traffic_budget_exhausted') break;
    }

    const warm = await budgetedRequest(client, budget, workload.pageUrl, { maxBytes: 2 * MIB });
    resources.push({ kind: 'document', phase: 'warm', ...stripBody(warm) });
    return summarize({ workload, resources, error: warm.ok ? null : warm.error || 'warm_failed', budget });
  } finally {
    client.close();
  }
}

function stripBody(result) {
  const { body, ...rest } = result;
  return rest;
}

function summarize({ workload, resources, error, budget }) {
  const successes = resources.filter((item) => item.ok);
  const successRate = resources.length ? successes.length / resources.length : 0;
  const cold = resources.find((item) => item.kind === 'document' && item.phase === 'cold') || null;
  const warm = resources.find((item) => item.kind === 'document' && item.phase === 'warm') || null;
  const ttfbValues = successes.map((item) => item.ttfbMs);
  const totals = successes.map((item) => item.totalMs);

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
    bytes: budget.actualBytes,
    budget: { maxBytes: budget.limitBytes, remainingBytes: budget.remainingBytes, exhausted: budget.remainingBytes <= READ_SLACK_BYTES },
    score,
    error,
    resources,
  };
}

export { DEFAULT_BROWSING_MAX_BYTES };
