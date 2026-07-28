import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, createLogger, summarizeLogFile } from '../src/logging/logger.js';

const URI = 'vless://11111111-2222-3333-4444-555555555555@edge.example.com:2052?type=ws';

test('redact removes uris, uuids and sensitive keys', () => {
  const output = redact({
    uri: URI,
    note: `use ${URI} now`,
    id: '11111111-2222-3333-4444-555555555555',
    nested: { password: 'secret', ip: '104.16.0.1' },
  });
  const text = JSON.stringify(output);
  assert.equal(text.includes('11111111-2222'), false);
  assert.equal(text.includes('vless://'), false);
  assert.equal(output.nested.password, '[REDACTED]');
  assert.equal(output.nested.ip, '104.16.0.1');
});

test('redact survives circular structures', () => {
  const node = { name: 'a' };
  node.self = node;
  assert.equal(redact(node).self, '[circular]');
});

test('logger writes redacted ndjson and summarizes it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-log-'));
  const logger = createLogger({ level: 'debug', directory, quiet: true });
  logger.info('scan.start', { uri: URI, durationMs: 12 });
  logger.warn('tunnel.failed', { error: 'xray_exited_23' });
  logger.debug('probe', { durationMs: 300 });
  await logger.close();

  const raw = fs.readFileSync(logger.filePath, 'utf8');
  assert.equal(raw.includes('vless://'), false);

  const summary = summarizeLogFile(logger.filePath);
  assert.equal(summary.total, 3);
  assert.equal(summary.byLevel.warn, 1);
  assert.equal(summary.errors[0].reason, 'xray_exited_23');
  assert.equal(summary.slowest[0].durationMs, 300);
});

test('log level filters lower severity events', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-log-'));
  const logger = createLogger({ level: 'warn', directory, quiet: true });
  logger.info('ignored', {});
  logger.error('kept', {});
  await logger.close();
  assert.equal(summarizeLogFile(logger.filePath).total, 1);
});
