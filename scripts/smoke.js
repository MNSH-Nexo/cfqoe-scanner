#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveOrigin } from '../src/origin/server.js';
import { probeWebSocket } from '../src/probe/websocket.js';
import { probePage } from '../src/browsing/probe.js';
import { probeStreaming } from '../src/streaming/probe.js';
import { createLogger } from '../src/logging/logger.js';
import { diagnoseLog } from '../src/logging/diagnostics.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-smoke-'));
const server = await serveOrigin({ host: '127.0.0.1', port: 0 });
const port = server.address().port;
const logger = await createLogger({ directory: path.join(temp, 'logs'), level: 'debug', runId: 'smoke' });

try {
  const target = {
    host: 'probe.example.com', port, security: 'none', transport: 'ws',
    path: '/cfqoe/ws', sni: 'probe.example.com',
  };
  const workloadTarget = {
    host: 'probe.example.com', port, security: 'none', protocol: 'h1', sni: 'probe.example.com',
  };
  const eligibility = await probeWebSocket('127.0.0.1', target, { timeoutMs: 1500 }, logger);
  if (!eligibility.ok) throw new Error(`Eligibility smoke failed: ${eligibility.error}`);

  const browsing = await probePage('127.0.0.1', workloadTarget, {
    manifestPath: '/cfqoe/manifest.json', assetConcurrency: 4, timeoutMs: 2000,
  }, logger);
  if (!browsing.ok) throw new Error(`Browsing smoke failed: ${browsing.error}`);

  const streaming = await probeStreaming('127.0.0.1', workloadTarget, {
    manifestPath: '/cfqoe/stream/manifest.json', profiles: ['360p'], timeoutMs: 5000,
    startupBufferSec: 8, safetyFactor: 1.25, stopOnUnsustainable: true,
  }, logger);
  if (!streaming.ok || !streaming.sustainable) throw new Error(`Streaming smoke failed: ${streaming.error || 'not sustainable'}`);

  logger.info('smoke.complete', {
    eligibilityMs: eligibility.totalMs,
    coldPageMs: browsing.cold.pageMs,
    warmPageMs: browsing.warm.pageMs,
    streaming: streaming.sustainable,
  });
  await logger.close();
  const diagnosis = await diagnoseLog(logger.path);
  if (diagnosis.malformed.length) throw new Error('Smoke log contains malformed NDJSON');

  console.log('[=] CFQoE smoke test passed');
  console.log(`[=] eligibility: ${eligibility.totalMs.toFixed(1)} ms`);
  console.log(`[=] cold/warm:   ${browsing.cold.pageMs.toFixed(1)} / ${browsing.warm.pageMs.toFixed(1)} ms`);
  console.log(`[=] streaming:   ${streaming.sustainable.name} (${streaming.sustainable.throughputP10Mbps} Mbps p10)`);
  console.log(`[=] log events:  ${diagnosis.entryCount}`);
} finally {
  await logger.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
