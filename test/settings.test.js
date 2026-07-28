import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  loadSettings,
  saveSettings,
  resolveWorkloads,
  loadCatalog,
} from '../src/config/settings.js';

test('mergeSettings merges nested objects without mutating defaults', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { scan: { rounds: 9 } });
  assert.equal(merged.scan.rounds, 9);
  assert.equal(merged.scan.maxCandidates, DEFAULT_SETTINGS.scan.maxCandidates);
  assert.equal(DEFAULT_SETTINGS.scan.rounds, 2);
});

test('loadSettings falls back to defaults for missing or broken files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-set-'));
  const file = path.join(directory, 'settings.json');
  assert.deepEqual(loadSettings(file).scan, DEFAULT_SETTINGS.scan);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(loadSettings(file).scan, DEFAULT_SETTINGS.scan);
});

test('saveSettings then loadSettings round trips', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-set-'));
  const file = path.join(directory, 'settings.json');
  saveSettings(file, mergeSettings(DEFAULT_SETTINGS, { tunnel: { limit: 11 } }));
  assert.equal(loadSettings(file).tunnel.limit, 11);
});

test('resolveWorkloads combines built-in selection with custom entries', () => {
  const catalog = loadCatalog(new URL('../config/workloads.default.json', import.meta.url).pathname);
  const settings = mergeSettings(DEFAULT_SETTINGS, {
    browsing: { workloads: ['cloudflare-docs'] },
    customWorkloads: { browsing: [{ name: 'mine', pageUrl: 'https://example.com/' }] },
  });
  const workloads = resolveWorkloads({ settings, catalog, kind: 'browsing' });
  assert.equal(workloads.length, 2);
  assert.equal(workloads[0].name, 'cloudflare-docs');
  assert.equal(workloads[1].name, 'mine');
});

test('default catalog entries are well formed', () => {
  const catalog = loadCatalog(new URL('../config/workloads.default.json', import.meta.url).pathname);
  for (const item of catalog.browsing) new URL(item.pageUrl);
  for (const item of catalog.streaming) assert.match(item.manifestUrl, /\.m3u8$/);
});
