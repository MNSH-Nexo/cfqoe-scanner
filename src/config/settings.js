import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_VERSION = 6;
const MIB = 1024 * 1024;

export function createDefaultSettings(platform = process.platform) {
  const android = platform === 'android';
  const eligibilityConcurrency = android ? 6 : 12;
  return {
    version: SETTINGS_VERSION,
    mode: 'full',
    scan: { perRange: 3, maxCandidates: 120, rounds: 3, screeningRounds: 1, concurrency: eligibilityConcurrency, timeoutMs: 6000, minimumSuccessRate: 0.6, seed: 404, delayedRetry: { enabled: true, maxCandidates: android ? 30 : 60 } },
    verification: { enabled: true, limit: android ? 12 : 20, sprt: { p0: 0.6, p1: 0.9, alpha: 0.05, beta: 0.1, minRounds: 2, maxRounds: 16 } },
    calibration: { enabled: true, levels: android ? [1, 2, 4, 6] : [1, 2, 4, 8, 12, 16], latencyInflationLimit: 0.1, failureRateIncreaseLimit: 0.02, eventLoopLagLimitMs: android ? 80 : 50 },
    tunnel: { enabled: true, xrayPath: 'auto', limit: 5, rounds: 1, concurrency: 1, startupTimeoutMs: 8000, shutdownGraceMs: 1500 },
    browsing: { enabled: true, metricName: 'Web Transfer Score', workloads: android ? ['cloudflare-docs'] : ['cloudflare-docs', 'cdnjs'], assetLimit: android ? 8 : 10, timeoutMs: 20000, maxSockets: 1, maxBytes: android ? 3 * MIB : 5 * MIB, estimatedMaxBytes: android ? 3 * MIB : 5 * MIB },
    streaming: { enabled: true, workloads: ['apple-advanced-hevc'], maxSegments: android ? 3 : 4, quickSegments: 2, researchSegments: 6, maxBytes: android ? 8 * MIB : 12 * MIB, estimatedMaxBytes: android ? 8 * MIB : 12 * MIB, startupBufferSec: 4, safetyFactor: 1.25, timeoutMs: 30000, variantMode: 'fixed', targetMbps: 6 },
    load: { enabled: true, durationMs: android ? 10000 : 12000, chunkBytes: 1 * MIB, maxDownloadBytes: android ? 12 * MIB : 24 * MIB, flows: android ? 3 : 6, uploadBytes: android ? 1 * MIB : 2 * MIB, uploadFlows: 2, fanoutRequests: android ? 4 : 6, idleSamples: 4, timeoutMs: 20000, minBytes: android ? 6 * MIB : 12 * MIB, gateProfile: 'balanced', endpoints: { download: 'https://speed.cloudflare.com/__down', upload: 'https://speed.cloudflare.com/__up', ping: 'https://speed.cloudflare.com/__down?bytes=1000', control: 'https://ash-speed.hetzner.com/100MB.bin' }, control: { enabled: false, bytes: 6 * MIB }, gates: {} },
    traffic: { targetBytesPerCandidate: android ? 28 * MIB : 44 * MIB, hardWarningBytesPerCandidate: 50 * MIB },
    hard: { concurrency: eligibilityConcurrency, screeningRounds: 1, recheckTop: android ? 12 : 20, saveEvery: android ? 10 : 25, liveTop: 30, finalTop: 200, delayedRetry: true, retryLimit: android ? 1000 : 5000 },
    customWorkloads: { browsing: [], streaming: [] }, logging: { level: 'info' },
  };
}
export const DEFAULT_SETTINGS = createDefaultSettings();
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function mergeSettings(base, override) { const output = Array.isArray(base) ? base.slice() : { ...base }; if (!isPlainObject(override)) return output; for (const [key, value] of Object.entries(override)) { if (isPlainObject(value) && isPlainObject(output[key])) output[key] = mergeSettings(output[key], value); else output[key] = value; } return output; }
const UNDERSIZED_V2_VALUES = [['streaming', 'maxSegments', 10], ['streaming', 'quickSegments', 3], ['streaming', 'timeoutMs', 25000], ['browsing', 'assetLimit', 6], ['browsing', 'timeoutMs', 15000]];
const STALE_WORKLOAD_SELECTIONS = [['browsing', ['wikipedia']], ['streaming', ['apple-bipbop']]];
function sameList(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]); }
export function migrateSettings(stored, platform = process.platform) {
  if (!isPlainObject(stored)) return createDefaultSettings(platform);
  const defaults = createDefaultSettings(platform); const storedVersion = Number(stored.version) || 1;
  if (storedVersion >= SETTINGS_VERSION) return mergeSettings(defaults, stored);
  const upgraded = mergeSettings(defaults, stored);
  for (const [section, key, staleDefault] of UNDERSIZED_V2_VALUES) if (stored[section] && stored[section][key] === staleDefault) upgraded[section][key] = defaults[section][key];
  for (const [section, staleSelection] of STALE_WORKLOAD_SELECTIONS) if (stored[section] && sameList(stored[section].workloads, staleSelection)) upgraded[section].workloads = defaults[section].workloads;
  const storedGates = isPlainObject(stored.load) && isPlainObject(stored.load.gates) ? stored.load.gates : {};
  if (storedVersion < 4) upgraded.load = mergeSettings(defaults.load, { gates: storedGates });
  else { upgraded.load = mergeSettings(upgraded.load, { maxDownloadBytes: defaults.load.maxDownloadBytes, durationMs: Math.min(Number(upgraded.load.durationMs) || defaults.load.durationMs, defaults.load.durationMs), uploadBytes: Math.min(Number(upgraded.load.uploadBytes) || defaults.load.uploadBytes, defaults.load.uploadBytes), fanoutRequests: Math.min(Number(upgraded.load.fanoutRequests) || defaults.load.fanoutRequests, defaults.load.fanoutRequests) }); upgraded.streaming.maxSegments = Math.min(Number(upgraded.streaming.maxSegments) || defaults.streaming.maxSegments, defaults.streaming.maxSegments); upgraded.browsing.assetLimit = Math.min(Number(upgraded.browsing.assetLimit) || defaults.browsing.assetLimit, defaults.browsing.assetLimit); }
  if (storedVersion < 6) { upgraded.browsing.maxBytes = Number(stored.browsing?.maxBytes) || Number(stored.browsing?.estimatedMaxBytes) || defaults.browsing.maxBytes; upgraded.streaming.maxBytes = Number(stored.streaming?.maxBytes) || Number(stored.streaming?.estimatedMaxBytes) || defaults.streaming.maxBytes; if (upgraded.streaming.variantMode === 'abr') upgraded.streaming.variantMode = 'lowest'; }
  upgraded.version = SETTINGS_VERSION; upgraded.migratedFrom = storedVersion; return upgraded;
}
export function loadSettings(settingsFile) { try { return migrateSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch { return mergeSettings(DEFAULT_SETTINGS, {}); } }
export function saveSettings(settingsFile, settings) { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 }); return settingsFile; }
export function estimateTrafficBytes(settings) { const load = settings.load || {}; const streaming = settings.streaming || {}; const browsing = settings.browsing || {}; const disabled = load.enabled === false; const downlink = disabled ? 0 : Number(load.maxDownloadBytes) || 24 * MIB; const uplink = disabled ? 0 : Number(load.uploadBytes) || 0; const fanout = disabled ? 0 : (Number(load.fanoutRequests) || 0) * 128 * 1024; const control = disabled || !load.control?.enabled ? 0 : Number(load.control.bytes) || 0; const segments = streaming.enabled === false ? 0 : Number(streaming.maxBytes ?? streaming.estimatedMaxBytes) || 0; const transfer = browsing.enabled === false ? 0 : Number(browsing.maxBytes ?? browsing.estimatedMaxBytes) || 0; return Math.round(downlink + uplink + fanout + control + segments + transfer); }
export function resolveWorkloads({ settings, catalog, kind }) { const selected = settings[kind]?.workloads || []; const custom = settings.customWorkloads?.[kind] || []; return [...(catalog[kind] || []).filter((item) => selected.includes(item.name)), ...custom]; }
export function loadCatalog(workloadsFile) { return JSON.parse(fs.readFileSync(workloadsFile, 'utf8')); }
