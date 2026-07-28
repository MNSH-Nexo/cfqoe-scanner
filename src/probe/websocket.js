import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { nullLogger } from '../logging/logger.js';

function parseHeaders(text) {
  const lines = text.split('\r\n');
  const statusMatch = lines[0]?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { statusCode: statusMatch ? Number(statusMatch[1]) : null, headers };
}

function cloudflareMetadata(headers) {
  const ray = headers['cf-ray'] || null;
  const server = headers.server || null;
  const colo = ray?.includes('-') ? ray.split('-').at(-1)?.toUpperCase() : null;
  return { cloudflare: Boolean(ray || /cloudflare/i.test(server || '')), ray, colo, server };
}

export function probeWebSocket(ip, target, { timeoutMs = 5000, rejectUnauthorized = true } = {}, logger = nullLogger) {
  const log = logger.child({ component: 'eligibility', ip });
  log.debug('ws.probe.start', {
    host: target.host, port: target.port, security: target.security, path: target.path, timeoutMs,
  });
  return new Promise((resolve) => {
    const started = performance.now();
    let connectedAt = null;
    let firstByteAt = null;
    let buffer = '';
    let settled = false;

    const secure = target.security === 'tls';
    const connectOptions = secure
      ? { host: ip, port: target.port, servername: target.sni || target.host, rejectUnauthorized, ALPNProtocols: ['http/1.1'] }
      : { host: ip, port: target.port };
    const socket = secure ? tls.connect(connectOptions) : net.connect(connectOptions);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const output = {
        ok: false,
        connectMs: connectedAt === null ? null : connectedAt - started,
        firstByteMs: firstByteAt === null ? null : firstByteAt - started,
        totalMs: performance.now() - started,
        ...result,
      };
      const eventData = {
        ok: output.ok,
        statusCode: output.statusCode,
        connectMs: output.connectMs,
        firstByteMs: output.firstByteMs,
        durationMs: output.totalMs,
        colo: output.colo,
        cloudflare: output.cloudflare,
        error: output.error,
      };
      if (output.ok) log.info('ws.probe.complete', eventData);
      else log.warn('ws.probe.failed', eventData);
      resolve(output);
    };

    const readyEvent = secure ? 'secureConnect' : 'connect';
    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
    socket.once(readyEvent, () => {
      connectedAt = performance.now();
      const key = crypto.randomBytes(16).toString('base64');
      socket.write([
        `GET ${target.path} HTTP/1.1`, `Host: ${target.host}`, 'Connection: Upgrade',
        'Upgrade: websocket', 'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${key}`,
        'User-Agent: CFQoE/0.3', '\r\n',
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      if (firstByteAt === null) firstByteAt = performance.now();
      buffer += chunk.toString('latin1');
      if (buffer.length > 64 * 1024) return finish({ error: 'response_headers_too_large' });
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      const { statusCode, headers } = parseHeaders(buffer.slice(0, end));
      const ok = target.transport === 'ws' ? statusCode === 101 : statusCode >= 200 && statusCode < 400;
      finish({
        ok, statusCode, protocol: secure ? socket.alpnProtocol || 'http/1.1' : 'http/1.1',
        ...cloudflareMetadata(headers), error: ok ? null : `unexpected_http_${statusCode ?? 'response'}`,
      });
    });
    socket.once('error', (error) => finish({ error: error.code || error.message }));
    socket.once('end', () => {
      if (!settled) finish({ error: buffer ? 'incomplete_http_headers' : 'connection_closed' });
    });
  });
}
