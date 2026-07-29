import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_VERSION = 3;

// Traffic volume is a correctness issue, not a preference. 0.6.0 pushed a few
// hundred kilobytes per candidate, which is exactly the window where every path
// looks fast: slow start is not finished, shaping has not kicked in, and no
// uplink is used. 0.7.0 defaults move several megabytes per candidate.
export function createDefaultSettings(platform = process.platform) {
  const android = platform === 'android';
  const eligibilityConcurrency = android ? 6 : 12;
  return {
    version: SETTINGS_VERSION,
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
      assetLimit: android ? 10 : 14, timeoutMs: 20000, maxSockets: 1,
    },
    streaming: {
      enabled: true, workloads: ['apple-bipbop'],
      maxSegments: android ? 14 : 24,
      quickSegments: 6, researchSegments: 29, startupBufferSec: 4,
      safetyFactor: 1.25, timeoutMs: 30000, variantMode: 'fixed', targetMbps: 6,
    },
    // Real-load stage: sustained transfer, latency under load, browser-like
    // fan-out and uplink. This is where the multi-megabyte traffic happens.
    load: {
      enabled: true,
      durationMs: android ? 15000 : 25000,
      chunkBytes: android ? 1024 * 1024 : 2 * 1024 * 1024,
      uploadBytes: android ? 1024 * 1024 : 3 * 1024 * 1024,
      fanoutRequests: android ? 6 : 8,
      idleSamples: 4,
      timeoutMs: 25000,
      minBytes: android ? 6 * 1024 * 1024 : 12 * 1024 * 1024,
      endpoints: {
        download: 'https://speed.cloudflare.com/__down',
        upload: 'https://speed.cloudflare.com/__up',
        ping: 'https://speed.cloudflare.com/__down?bytes=1000',
      },
      gates: {},
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

// Values that were too small in 0.6.x and must not survive a settings merge,
// otherwise an upgraded install keeps measuring a few hundred kilobytes.
const UNDERSIZED_V2_VALUES = [
  ['streaming', 'maxSegments', 10],
  ['streaming', 'quickSegments', 3],
  ['streaming', 'timeoutMs', 25000],
  ['browsing', 'assetLimit', 6],
  ['browsing', 'timeoutMs', 15000],
];

/**
 * Upgrade a stored settings object to the current version.
 * Only stale low-volume values are reset; user choices such as workloads,
 * seeds, limits and logging level are preserved.
 */
export function migrateSettings(stored, platform = process.platform) {
  if (!isPlainObject(stored)) return createDefaultSettings(platform);
  const defaults = createDefaultSettings(platform);
  const storedVersion = Number(stored.version) || 1;
  if (storedVersion >= SETTINGS_VERSION) return mergeSettings(defaults, stored);

  const upgraded = mergeSettings(defaults, stored);
  for (const [section, key, staleDefault] of UNDERSIZED_V2_VALUES) {
    if (stored[section] && stored[section][key] === staleDefault) {
      upgraded[section][key] = defaults[section][key];
    }
  }
  // The load stage did not exist before version 3, so always take its defaults.
  upgraded.load = mergeSettings(defaults.load, isPlainObject(stored.load) ? stored.load : {});
  upgraded.version = SETTINGS_VERSION;
  upgraded.migratedFrom = storedVersion;
  return upgraded;
}

export function loadSettings(settingsFile) {
  try { return migrateSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
  catch { return mergeSettings(DEFAULT_SETTINGS, {}); }
}

export function saveSettings(settingsFile, settings) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settingsFile;
}

/**
 * Planned bytes per candidate for one tunnel round.
 * Used by the CLI and menu so the traffic cost is stated up front instead of
 * being an accidental few hundred kilobytes.
 */
export function estimateTrafficBytes(settings) {
  const load = settings.load || {};
  const streaming = settings.streaming || {};
  const browsing = settings.browsing || {};
  const downlink = load.enabled === false ? 0 : Number(load.minBytes) || 0;
  const uplink = load.enabled === false ? 0 : Number(load.uploadBytes) || 0;
  const fanout = (Number(load.fanoutRequests) || 0) * 128 * 1024;
  // Reference HLS segments average roughly 1.2 MB at the bitrates we target.
  const segments = streaming.enabled === false ? 0 : (Number(streaming.maxSegments) || 0) * 1.2 * 1024 * 1024;
  const transfer = browsing.enabled === false ? 0 : ((Number(browsing.assetLimit) || 0) + 2) * 250 * 1024;
  return Math.round(downlink + uplink + fanout + segments + transfer);
}

export function resolveWorkloads({ settings, catalog, kind }) {
  const selected = settings[kind]?.workloads || [];
  const custom = settings.customWorkloads?.[kind] || [];
  return [...(catalog[kind] || []).filter((item) => selected.includes(item.name)), ...custom];
}

export function loadCatalog(workloadsFile) { return JSON.parse(fs.readFileSync(workloadsFile, 'utf8')); }
