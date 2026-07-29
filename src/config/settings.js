import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  version: 1,
  scan: {
    perRange: 3,
    maxCandidates: 120,
    rounds: 3,
    concurrency: 12,
    timeoutMs: 6000,
    minimumSuccessRate: 0.6,
    seed: 404,
  },
  tunnel: {
    enabled: true,
    xrayPath: 'auto',
    limit: 5,
    rounds: 1,
    concurrency: 1,
    startupTimeoutMs: 8000,
    shutdownGraceMs: 1500,
  },
  browsing: {
    enabled: true,
    workloads: ['cloudflare-docs'],
    assetLimit: 6,
    timeoutMs: 15000,
  },
  streaming: {
    enabled: true,
    workloads: ['mux-test-hls'],
    maxSegments: 3,
    startupBufferSec: 4,
    safetyFactor: 1.25,
    timeoutMs: 25000,
  },
  hard: {
    saveEvery: 25,
    liveTop: 30,
    finalTop: 200,
  },
  customWorkloads: {
    browsing: [],
    streaming: [],
  },
  logging: {
    level: 'info',
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
  try {
    const raw = fs.readFileSync(settingsFile, 'utf8');
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return mergeSettings(DEFAULT_SETTINGS, {});
  }
}

export function saveSettings(settingsFile, settings) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  return settingsFile;
}

export function resolveWorkloads({ settings, catalog, kind }) {
  const selected = settings[kind]?.workloads || [];
  const custom = settings.customWorkloads?.[kind] || [];
  const builtIn = (catalog[kind] || []).filter((item) => selected.includes(item.name));
  return [...builtIn, ...custom];
}

export function loadCatalog(workloadsFile) {
  const raw = fs.readFileSync(workloadsFile, 'utf8');
  return JSON.parse(raw);
}
