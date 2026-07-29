import fs from 'node:fs';
import path from 'node:path';

export function createDefaultSettings(platform = process.platform) {
  const android = platform === 'android';
  const eligibilityConcurrency = android ? 6 : 12;
  return {
    version: 2,
    mode: 'full',
    scan: {
      perRange: 3,
      maxCandidates: 120,
      rounds: 3,
      screeningRounds: 1,
      concurrency: eligibilityConcurrency,
      timeoutMs: 6000,
      minimumSuccessRate: 0.6,
      seed: 404,
      delayedRetry: { enabled: true, maxCandidates: android ? 30 : 60 },
    },
    verification: {
      enabled: true,
      limit: android ? 12 : 20,
      sprt: { p0: 0.6, p1: 0.9, alpha: 0.05, beta: 0.1, minRounds: 2, maxRounds: 16 },
    },
    calibration: {
      enabled: true,
      levels: android ? [1, 2, 4, 6] : [1, 2, 4, 8, 12, 16],
      latencyInflationLimit: 0.1,
      failureRateIncreaseLimit: 0.02,
      eventLoopLagLimitMs: android ? 80 : 50,
    },
    tunnel: {
      enabled: true, xrayPath: 'auto', limit: 5, rounds: 1, concurrency: 1,
      startupTimeoutMs: 8000, shutdownGraceMs: 1500,
    },
    browsing: {
      enabled: true, metricName: 'Web Transfer Score', workloads: ['wikipedia'],
      assetLimit: 6, timeoutMs: 15000, maxSockets: 1,
    },
    streaming: {
      enabled: true, workloads: ['apple-bipbop'], maxSegments: 10,
      quickSegments: 3, researchSegments: 29, startupBufferSec: 4,
      safetyFactor: 1.25, timeoutMs: 25000, variantMode: 'fixed', targetMbps: 6,
    },
    hard: {
      concurrency: eligibilityConcurrency, screeningRounds: 1,
      recheckTop: android ? 12 : 20, saveEvery: android ? 10 : 25,
      liveTop: 30, finalTop: 200, delayedRetry: true,
      retryLimit: android ? 1000 : 5000,
    },
    customWorkloads: { browsing: [], streaming: [] },
    logging: { level: 'info' },
  };
}

export const DEFAULT_SETTINGS = createDefaultSettings();

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export function mergeSettings(base, override) {
  const output = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(override)) return output;
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(output[key])) output[key] = mergeSettings(output[key], value);
    else output[key] = value;
  }
  return output;
}

export function loadSettings(settingsFile) {
  try { return mergeSettings(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
  catch { return mergeSettings(DEFAULT_SETTINGS, {}); }
}

export function saveSettings(settingsFile, settings) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settingsFile;
}

export function resolveWorkloads({ settings, catalog, kind }) {
  const selected = settings[kind]?.workloads || [];
  const custom = settings.customWorkloads?.[kind] || [];
  return [...(catalog[kind] || []).filter((item) => selected.includes(item.name)), ...custom];
}

export function loadCatalog(workloadsFile) { return JSON.parse(fs.readFileSync(workloadsFile, 'utf8')); }
