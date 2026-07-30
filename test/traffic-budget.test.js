import test from 'node:test';
import assert from 'node:assert/strict';
import { createByteBudget, DEFAULT_MAX_DOWNLOAD_BYTES } from '../src/probe/load.js';
import { createDefaultSettings, estimateTrafficBytes, migrateSettings, SETTINGS_VERSION } from '../src/config/settings.js';

const MIB = 1024 * 1024;

test('parallel workers cannot reserve beyond the shared download cap', () => {
  const budget = createByteBudget(24 * MIB);
  const grants = Array.from({ length: 40 }, () => budget.reserve(MIB));
  assert.equal(grants.reduce((sum, value) => sum + value, 0), 24 * MIB);
  assert.equal(budget.reservedBytes, 24 * MIB);
  assert.equal(budget.remainingBytes, 0);
  assert.equal(budget.reserve(MIB), 0);
});

test('the default load transfer is capped at 24 MiB', () => {
  assert.equal(DEFAULT_MAX_DOWNLOAD_BYTES, 24 * MIB);
  assert.equal(createDefaultSettings('win32').load.maxDownloadBytes, 24 * MIB);
});

test('planned desktop traffic stays below 50 MiB per tunnel-tested IP', () => {
  const settings = createDefaultSettings('win32');
  assert.ok(estimateTrafficBytes(settings) <= 50 * MIB, `${estimateTrafficBytes(settings) / MIB} MiB`);
});

test('v0.8.1 settings migrate to the cost-aware budget', () => {
  const migrated = migrateSettings({ version: 4, load: { durationMs: 25000, uploadBytes: 3 * MIB }, streaming: { maxSegments: 24 }, browsing: { assetLimit: 14 } }, 'win32');
  assert.equal(migrated.version, SETTINGS_VERSION);
  assert.equal(migrated.load.maxDownloadBytes, 24 * MIB);
  assert.equal(migrated.load.durationMs, 12000);
  assert.equal(migrated.streaming.maxSegments, 4);
  assert.equal(migrated.browsing.assetLimit, 10);
});
