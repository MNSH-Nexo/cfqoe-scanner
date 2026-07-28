import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const SENSITIVE_KEY = /(^id$|uuid|credential|password|passwd|authorization|proxy-authorization|token|secret|private.?key|uri)$/i;

export function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function cleanString(value) {
  if (/vless:\/\//i.test(value)) return '[REDACTED_VLESS_URI]';
  return value.length > 4096 ? `${value.slice(0, 4096)}…[TRUNCATED]` : value;
}

export function redact(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEY.test(key)) {
    return typeof value === 'string' && /vless:\/\//i.test(value)
      ? '[REDACTED_VLESS_URI]'
      : '[REDACTED]';
  }
  if (typeof value === 'string') return cleanString(value);
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value);
  if (Buffer.isBuffer(value)) return `[BUFFER ${value.length} bytes]`;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, '', seen));
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey, seen)]));
}

export function serializeError(error) {
  if (!(error instanceof Error)) return { message: cleanString(String(error)) };
  return {
    name: error.name,
    message: cleanString(error.message),
    code: error.code || undefined,
    stack: error.stack ? cleanString(error.stack) : undefined,
    cause: error.cause ? redact(error.cause, 'cause') : undefined,
  };
}

export async function createLogger({ directory, level = 'info', runId = makeRunId(), context = {} }) {
  if (!(level in LEVELS)) throw new Error(`Unknown log level: ${level}`);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  await fsp.chmod(directory, 0o700);
  const filePath = path.join(directory, `run-${runId}.ndjson`);
  const stream = fs.createWriteStream(filePath, { flags: 'a', mode: 0o600 });
  await new Promise((resolve, reject) => {
    stream.once('open', resolve);
    stream.once('error', reject);
  });
  await fsp.chmod(filePath, 0o600);
  const threshold = LEVELS[level];
  let closed = false;

  const build = (baseContext) => {
    const logger = {
      runId,
      path: filePath,
      level,
      child(extra = {}) { return build({ ...baseContext, ...redact(extra) }); },
      log(logLevel, event, data = {}) {
        if (closed || LEVELS[logLevel] < threshold) return;
        const entry = {
          ts: new Date().toISOString(), level: logLevel, runId, event,
          ...baseContext, ...redact(data),
        };
        stream.write(`${JSON.stringify(entry)}\n`);
      },
      debug(event, data) { logger.log('debug', event, data); },
      info(event, data) { logger.log('info', event, data); },
      warn(event, data) { logger.log('warn', event, data); },
      error(event, data) { logger.log('error', event, data); },
      async close() {
        if (closed) return;
        closed = true;
        await new Promise((resolve) => stream.end(resolve));
      },
    };
    return logger;
  };

  return build(redact(context));
}

export const nullLogger = Object.freeze({
  runId: null, path: null, level: 'silent',
  child() { return this; }, log() {}, debug() {}, info() {}, warn() {}, error() {}, async close() {},
});
