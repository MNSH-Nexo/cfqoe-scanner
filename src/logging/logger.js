import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const VLESS_PATTERN = /vless:\/\/\S+/gi;
const SENSITIVE_KEYS = /^(id|uuid|password|token|secret|credential|authorization|uri|vless)$/i;

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return value.replace(VLESS_PATTERN, '[REDACTED_VLESS_URI]').replace(UUID_PATTERN, '[REDACTED_UUID]');
  }
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item, seen);
  }
  return output;
}

export function createLogger({ level = 'info', directory = null, runId = randomUUID(), quiet = false } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let stream = null;
  let filePath = null;

  if (directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    filePath = path.join(directory, `run-${runId}.ndjson`);
    stream = fs.createWriteStream(filePath, { flags: 'a', mode: 0o600 });
  }

  const counters = { debug: 0, info: 0, warn: 0, error: 0 };

  function write(levelName, event, details) {
    if ((LEVELS[levelName] ?? 0) < threshold) return;
    counters[levelName] += 1;
    const record = {
      time: new Date().toISOString(),
      runId,
      level: levelName,
      event,
      ...redact(details || {}),
    };
    if (stream) stream.write(`${JSON.stringify(record)}\n`);
    if (!quiet && (levelName === 'warn' || levelName === 'error')) {
      process.stderr.write(`[${levelName}] ${event}\n`);
    }
  }

  return {
    runId,
    filePath,
    counters,
    debug: (event, details) => write('debug', event, details),
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
    async close() {
      if (!stream) return;
      await new Promise((resolve) => stream.end(resolve));
    },
  };
}

export function summarizeLogFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
  const errors = [];
  const slowest = [];

  for (const event of events) {
    if (byLevel[event.level] !== undefined) byLevel[event.level] += 1;
    if (event.level === 'error' || event.level === 'warn') {
      errors.push({ event: event.event, reason: event.error || event.reason || null });
    }
    if (Number.isFinite(event.durationMs)) {
      slowest.push({ event: event.event, durationMs: event.durationMs });
    }
  }

  slowest.sort((a, b) => b.durationMs - a.durationMs);

  return {
    total: events.length,
    byLevel,
    errors: errors.slice(0, 20),
    slowest: slowest.slice(0, 10),
    runId: events[0]?.runId || null,
  };
}
