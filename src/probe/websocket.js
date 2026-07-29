import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { classifyProbeError } from './errors.js';
import { extractCloudflareColo } from '../measurement/confidence.js';

export function probeWebsocket({ ip, vless, timeoutMs = 6000 }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const observedAt = new Date().toISOString();
    let connectedAt = null;
    let settled = false;
    let socket = null;
    let response = '';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* ignore */ }
      const merged = {
        ip, observedAt, ok: false,
        connectMs: connectedAt === null ? null : Math.round((connectedAt - started) * 100) / 100,
        handshakeMs: null, statusCode: null, cfRay: null, colo: null, error: null,
        ...result,
      };
      merged.colo = merged.colo || extractCloudflareColo(merged.cfRay);
      merged.errorClass = classifyProbeError(merged.ok ? null : merged.error).class;
      resolve(merged);
    };
    const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
    const onSecureOrConnect = () => {
      connectedAt = performance.now();
      const key = crypto.randomBytes(16).toString('base64');
      socket.write([
        `GET ${vless.path} HTTP/1.1`, `Host: ${vless.host}`, 'Upgrade: websocket',
        'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13',
        'User-Agent: CFQoE/0.6', '', '',
      ].join('\r\n'));
    };
    try {
      if (!net.isIPv4(ip)) throw new Error('invalid_candidate_ip');
      if (vless.security === 'tls') {
        socket = tls.connect({
          host: ip, port: vless.port, servername: vless.sni || vless.host,
          rejectUnauthorized: !vless.allowInsecure, ALPNProtocols: ['http/1.1'],
        });
        socket.once('secureConnect', onSecureOrConnect);
      } else {
        socket = net.connect({ host: ip, port: vless.port });
        socket.once('connect', onSecureOrConnect);
      }
    } catch (error) { finish({ error: error.message }); return; }
    socket.setTimeout(timeoutMs, () => finish({ error: 'socket_timeout' }));
    socket.on('data', (chunk) => {
      response += chunk.toString('latin1');
      const headerEnd = response.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (response.length > 16384) finish({ error: 'header_overflow' });
        return;
      }
      const head = response.slice(0, headerEnd);
      const statusLine = head.split('\r\n')[0] || '';
      const statusCode = Number(statusLine.split(' ')[1]);
      const rayMatch = head.match(/^cf-ray:\s*(.+)$/im);
      const upgraded = /^upgrade:\s*websocket/im.test(head) && statusCode === 101;
      finish({
        ok: upgraded,
        statusCode: Number.isFinite(statusCode) ? statusCode : null,
        cfRay: rayMatch ? rayMatch[1].trim() : null,
        handshakeMs: Math.round((performance.now() - started) * 100) / 100,
        error: upgraded ? null : `unexpected_status_${statusCode || 'none'}`,
      });
    });
    socket.on('error', (error) => finish({ error: error.code || error.message }));
    socket.on('close', () => finish({ error: 'closed_before_upgrade' }));
  });
}
