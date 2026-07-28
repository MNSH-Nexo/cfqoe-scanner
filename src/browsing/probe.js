import { performance } from 'node:perf_hooks';
import { createPageClient } from './client.js';
import { nullLogger } from '../logging/logger.js';

function normalizePath(value, label) {
  const text = String(value || '');
  if (!text.startsWith('/')) throw new Error(`${label} must begin with /`);
  return text;
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Browsing manifest must be a JSON object');
  const document = normalizePath(raw.document || '/cfqoe/page.html', 'manifest.document');
  const assets = Array.isArray(raw.assets) ? raw.assets.map((item, index) => {
    const assetPath = typeof item === 'string' ? item : item?.path;
    return { path: normalizePath(assetPath, `manifest.assets[${index}]`) };
  }) : [];
  if (!assets.length) throw new Error('Browsing manifest has no assets');
  if (assets.length > 64) throw new Error('Browsing manifest exceeds the 64-asset safety limit');
  return { document, assets };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function runPage(client, manifest, { assetConcurrency, timeoutMs }) {
  const started = performance.now();
  const document = await client.request(manifest.document, { timeoutMs });
  const assets = document.ok
    ? await runPool(manifest.assets, assetConcurrency, (asset) => client.request(asset.path, { timeoutMs }))
    : manifest.assets.map((asset) => ({ ok: false, path: asset.path, error: 'document_failed', bytes: 0 }));
  const resources = [document, ...assets];
  const successful = resources.filter((resource) => resource.ok);
  return {
    ok: successful.length === resources.length,
    pageMs: performance.now() - started,
    resourceCount: resources.length,
    successfulResources: successful.length,
    successRate: resources.length ? successful.length / resources.length : 0,
    bytes: resources.reduce((sum, resource) => sum + (resource.bytes || 0), 0),
    ttfbMs: successful.map((resource) => resource.ttfbMs).filter(Number.isFinite),
    resources,
  };
}

async function discoverManifest(ip, target, browsing) {
  if (browsing.document && Array.isArray(browsing.assets)) {
    return normalizeManifest({ document: browsing.document, assets: browsing.assets });
  }
  const client = await createPageClient({ ...target, ip });
  try {
    const response = await client.request(browsing.manifestPath, {
      captureBody: true, timeoutMs: browsing.timeoutMs, maxCaptureBytes: 1024 * 1024,
    });
    if (!response.ok) throw new Error(`Manifest request failed: ${response.error}`);
    if (!response.body) throw new Error('Manifest body is empty');
    return normalizeManifest(JSON.parse(response.body.toString('utf8')));
  } finally {
    client.close();
  }
}

export async function probePage(ip, target, browsing, logger = nullLogger) {
  const log = logger.child({ component: 'browsing', ip });
  const started = performance.now();
  let client;
  try {
    log.debug('page.manifest.start', { path: browsing.manifestPath });
    const manifest = await discoverManifest(ip, target, browsing);
    log.info('page.manifest.ok', { document: manifest.document, assetCount: manifest.assets.length });
    client = await createPageClient({ ...target, ip });
    const cold = await runPage(client, manifest, browsing);
    log.info('page.cold.complete', {
      ok: cold.ok, pageMs: cold.pageMs, successRate: cold.successRate * 100, bytes: cold.bytes,
    });
    const warm = await runPage(client, manifest, browsing);
    log.info('page.warm.complete', {
      ok: warm.ok, pageMs: warm.pageMs, successRate: warm.successRate * 100, bytes: warm.bytes,
    });
    const output = {
      ok: cold.ok && warm.ok,
      protocol: client.protocol,
      manifest: { document: manifest.document, assetCount: manifest.assets.length },
      cold, warm, totalMs: performance.now() - started, error: null,
    };
    log.info('page.probe.complete', { ok: output.ok, durationMs: output.totalMs, protocol: output.protocol });
    log.debug('page.resources', { cold: cold.resources, warm: warm.resources });
    return output;
  } catch (error) {
    log.error('page.probe.error', { durationMs: performance.now() - started, error });
    return { ok: false, cold: null, warm: null, totalMs: performance.now() - started, error: error.code || error.message };
  } finally {
    client?.close();
  }
}
