import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, createDefaultSettings, mergeSettings, loadSettings, saveSettings, resolveWorkloads, loadCatalog } from '../src/config/settings.js';

test('mergeSettings merges nested objects without mutating defaults', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { scan: { rounds: 9 } });
  assert.equal(merged.scan.rounds, 9);
  assert.equal(merged.scan.maxCandidates, DEFAULT_SETTINGS.scan.maxCandidates);
  assert.equal(DEFAULT_SETTINGS.scan.rounds, 3);
});

test('Android defaults reduce contention and checkpoint more often', () => {
  const android = createDefaultSettings('android');
  const desktop = createDefaultSettings('linux');
  assert.equal(android.scan.concurrency, 6);
  assert.equal(desktop.scan.concurrency, 12);
  assert.equal(android.hard.concurrency, 6);
  assert.equal(desktop.hard.concurrency, 12);
  assert.equal(android.hard.screeningRounds, 1);
  assert.equal(android.hard.recheckTop, 12);
  assert.equal(desktop.hard.recheckTop, 20);
  assert.equal(android.hard.saveEvery, 10);
  assert.equal(desktop.hard.saveEvery, 25);
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

test('old settings files receive new Hard Scan defaults', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-set-'));
  const file = path.join(directory, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hard: { saveEvery: 7 } }));
  const settings = loadSettings(file);
  assert.equal(settings.hard.saveEvery, 7);
  assert.equal(settings.hard.screeningRounds, 1);
  assert.equal(settings.hard.concurrency, DEFAULT_SETTINGS.hard.concurrency);
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
