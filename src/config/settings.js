import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_VERSION = 4;

// Traffic volume and PARALLELISM are correctness issues, not preferences.
// 0.6.x pushed a few hundred kilobytes, which is exactly the window where every
// path looks fast. 0.7.0 pushed megabytes but on one connection, which on a
// 200 ms path is bounded by the bandwidth-delay product and under-reports the
// link several times over. 0.8.0 saturates with parallel flows, the way
// Cloudflare's own speed test and the IETF responsiveness method do.
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
    // Web Transfer must be measured on pages that Cloudflare actually serves,
    // otherwise the score belongs to another CDN. wikipedia is kept in the
    // catalog as a control workload only.
    browsing: {
      enabled: true, metricName: 'Web Transfer Score',
      workloads: android ? ['cloudflare-docs'] : ['cloudflare-docs', 'cdnjs'],
      assetLimit: android ? 10 : 14, timeoutMs: 20000, maxSockets: 1,
    },
    streaming: {
      enabled: true, workloads: ['apple-advanced-hevc'],
      maxSegments: android ? 14 : 24,
      quickSegments: 6, researchSegments: 29, startupBufferSec: 4,
      safetyFactor: 1.25, timeoutMs: 30000, variantMode: 'fixed', targetMbps: 6,
    },
    // Real-load stage: saturating parallel transfer, responsiveness under that
    // load, browser-like fan-out and uplink.
    load: {
      enabled: true,
      durationMs: android ? 15000 : 25000,
      chunkBytes: android ? 1024 * 1024 : 2 * 1024 * 1024,
      flows: android ? 3 : 6,
      uploadBytes: android ? 1024 * 1024 : 3 * 1024 * 1024,
      uploadFlows: android ? 2 : 3,
      fanoutRequests: android ? 6 : 8,
      idleSamples: 4,
      timeoutMs: 25000,
      minBytes: android ? 6 * 1024 * 1024 : 12 * 1024 * 1024,
      // Named threshold profile from src/measurement/gates.js. `balanced` is
      // written for a real long-haul tunnel; `strict` for already-good paths.
      gateProfile: 'balanced',
      endpoints: {
        download: 'https://speed.cloudflare.com/__down',
        upload: 'https://speed.cloudflare.com/__up',
        ping: 'https://speed.cloudflare.com/__down?bytes=1000',
        control: 'https://ash-speed.hetzner.com/100MB.bin',
      },
      // Off by default because it costs extra traffic outside Cloudflare; it
      // answers "is this edge slow, or is my own link slow".
      control: { enabled: false, bytes: 8 * 1024 * 1024 },
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

// Workload selections that were wrong for the job (measured a non-Cloudflare
// CDN, or a ladder too small to show real quality) and are replaced on upgrade.
const STALE_WORKLOAD_SELECTIONS = [
  ['browsing', ['wikipedia']],
  ['streaming', ['apple-bipbop']],
];

function sameList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * Upgrade a stored settings object to the current version.
 * Only stale low-volume values and workload selections that are known to be
 * wrong are reset; user choices such as seeds, limits, custom workloads and
 * logging level are preserved.
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
  for (const [section, staleSelection] of STALE_WORKLOAD_SELECTIONS) {
    if (stored[section] && sameList(stored[section].workloads, staleSelection)) {
      upgraded[section].workloads = defaults[section].workloads;
    }
  }
  // The load stage did not exist before version 3 and was single-flow in
  // version 3, so always take its structural defaults and keep only the user's
  // explicit gate overrides.
  const storedGates = isPlainObject(stored.load) && isPlainObject(stored.load.gates) ? stored.load.gates : {};
  upgraded.load = mergeSettings(defaults.load, { gates: storedGates });
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
  const disabled = load.enabled === false;
  // With parallel flows the saturating stage moves at least minBytes, and in
  // practice as much as the link allows within durationMs.
  const downlink = disabled ? 0 : Number(load.minBytes) || 0;
  const uplink = disabled ? 0 : Number(load.uploadBytes) || 0;
  const fanout = disabled ? 0 : (Number(load.fanoutRequests) || 0) * 128 * 1024;
  const control = disabled || !load.control?.enabled ? 0 : Number(load.control.bytes) || 0;
  // Reference HLS segments average roughly 1.2 MB at the bitrates we target.
  const segments = streaming.enabled === false ? 0 : (Number(streaming.maxSegments) || 0) * 1.2 * 1024 * 1024;
  const transfer = browsing.enabled === false
    ? 0
    : ((Number(browsing.assetLimit) || 0) + 2) * 250 * 1024 * Math.max(1, (browsing.workloads || []).length);
  return Math.round(downlink + uplink + fanout + control + segments + transfer);
}

export function resolveWorkloads({ settings, catalog, kind }) {
  const selected = settings[kind]?.workloads || [];
  const custom = settings.customWorkloads?.[kind] || [];
  return [...(catalog[kind] || []).filter((item) => selected.includes(item.name)), ...custom];
}

export function loadCatalog(workloadsFile) { return JSON.parse(fs.readFileSync(workloadsFile, 'utf8')); }
