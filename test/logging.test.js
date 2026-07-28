import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact } from '../src/logging/logger.js';
import { diagnoseLog } from '../src/logging/diagnostics.js';

test('structured logger redacts credentials and creates diagnosable private NDJSON', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logger = await createLogger({ directory, level: 'debug', runId: 'test-run' });
  logger.info('scan.start', {
    uuid: 'should-not-leak',
    password: 'also-secret',
    connectionUri: 'vless://credential@example.com:443?type=ws',
    safe: 'visible',
  });
  logger.error('probe.failed', { ip: '127.0.0.1', durationMs: 123, error: Object.assign(new Error('boom'), { code: 'EBOOM' }) });
  await logger.close();

  const raw = await fs.readFile(logger.path, 'utf8');
  assert.doesNotMatch(raw, /should-not-leak|also-secret|vless:\/\/credential/);
  assert.match(raw, /\[REDACTED\]/);
  assert.match(raw, /\[REDACTED_VLESS_URI\]/);
  assert.equal((await fs.stat(logger.path)).mode & 0o777, 0o600);

  const summary = await diagnoseLog(logger.path);
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.levels.error, 1);
  assert.equal(summary.errorCodes.EBOOM, 1);
  assert.equal(summary.slowest[0].durationMs, 123);
});

test('redaction handles buffers and cycles safely', () => {
  const value = { token: 'x', body: Buffer.alloc(3) };
  value.self = value;
  assert.deepEqual(redact(value), {
    token: '[REDACTED]', body: '[BUFFER 3 bytes]', self: '[CIRCULAR]',
  });
});
