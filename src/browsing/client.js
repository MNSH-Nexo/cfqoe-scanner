import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { connectSocks5 } from '../net/socks5.js';

function successfulStatus(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 400;
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('connect_timeout')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

async function openSocket(target, timeoutMs = 8000) {
  const started = performance.now();
  let socket = target.proxy
    ? await connectSocks5(target.proxy, { host: target.host, port: target.port }, timeoutMs)
    : await connectTcp(target.ip, target.port, timeoutMs);

  if (target.security === 'tls') {
    const raw = socket;
    socket = tls.connect({
      socket: raw,
      servername: target.sni || target.host,
      rejectUnauthorized: target.rejectUnauthorized !== false,
      ALPNProtocols: target.protocol === 'h2' ? ['h2'] : ['http/1.1'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => socket.destroy(new Error('tls_timeout')), timeoutMs);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
  }
  socket.__cfqoeFresh = true;
  socket.__cfqoeConnectMs = performance.now() - started;
  return socket;
}

function makeAgent(target) {
  const BaseAgent = target.security === 'tls' ? https.Agent : http.Agent;
  return new class extends BaseAgent {
    createConnection(_options, callback) {
      openSocket(target).then((socket) => callback(null, socket), callback);
      return undefined;
    }
  }({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
}

function makeH1Client(target) {
  const secure = target.security === 'tls';
  const transport = secure ? https : http;
  const agent = makeAgent(target);

  return {
    protocol: 'http/1.1',
    request(resourcePath, { captureBody = false, timeoutMs = 8000, maxCaptureBytes = 1024 * 1024 } = {}) {
      return new Promise((resolve) => {
        const started = performance.now();
        let connectedAt = null;
        let reusedConnection = false;
        let bytes = 0;
        const chunks = [];
        let settled = false;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          resolve({
            ok: false, path: resourcePath, protocol: 'http/1.1',
            connectMs: connectedAt === null ? null : connectedAt - started,
            ttfbMs: null, totalMs: performance.now() - started,
            bytes, reusedConnection, ...result,
          });
        };

        const request = transport.request({
          host: target.host,
          port: target.port,
          path: resourcePath,
          method: 'GET',
          agent,
          headers: {
            Host: target.host, Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'CFQoE/0.4',
          },
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
        request.on('socket', (socket) => {
          if (socket.__cfqoeFresh) {
            connectedAt = performance.now();
            reusedConnection = false;
            delete socket.__cfqoeFresh;
          } else reusedConnection = true;
        });
        request.on('response', (response) => {
          const firstByte = performance.now();
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (captureBody && bytes <= maxCaptureBytes) chunks.push(chunk);
          });
          response.on('end', () => {
            const captureExceeded = captureBody && bytes > maxCaptureBytes;
            const statusOk = successfulStatus(response.statusCode);
            finish({
              ok: statusOk && !captureExceeded,
              statusCode: response.statusCode,
              ttfbMs: firstByte - started,
              totalMs: performance.now() - started,
              contentType: response.headers['content-type'] || null,
              body: captureBody && !captureExceeded ? Buffer.concat(chunks) : undefined,
              error: captureExceeded ? 'capture_limit_exceeded' : statusOk ? null : `http_${response.statusCode}`,
            });
          });
        });
        request.on('error', (error) => finish({ error: error.code || error.message }));
        request.end();
      });
    },
    close() { agent.destroy(); },
  };
}

async function makeH2Client(target) {
  if (target.security !== 'tls') throw new Error('HTTP/2 mode currently requires TLS');
  const socket = await openSocket(target);
  if (socket.alpnProtocol !== 'h2') {
    socket.destroy();
    throw new Error(`HTTP/2 was not negotiated (ALPN=${socket.alpnProtocol || 'none'})`);
  }
  const authority = `https://${target.host}:${target.port}`;
  let session;
  try {
    session = http2.connect(authority, { createConnection: () => socket });
    await new Promise((resolve, reject) => {
      session.once('connect', resolve);
      session.once('error', reject);
    });
  } catch (error) {
    session?.destroy();
    socket.destroy();
    throw error;
  }

  return {
    protocol: 'h2',
    request(resourcePath, { captureBody = false, timeoutMs = 8000, maxCaptureBytes = 1024 * 1024 } = {}) {
      return new Promise((resolve) => {
        const started = performance.now();
        let firstByte = null;
        let bytes = 0;
        let statusCode = null;
        const chunks = [];
        let settled = false;
        let timedOut = false;
        const stream = session.request({
          ':method': 'GET', ':path': resourcePath, ':authority': target.host,
          'accept-encoding': 'identity', 'user-agent': 'CFQoE/0.4',
        });
        const timer = setTimeout(() => {
          timedOut = true;
          stream.close(http2.constants.NGHTTP2_CANCEL);
        }, timeoutMs);
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: false, path: resourcePath, protocol: 'h2', connectMs: 0,
            ttfbMs: firstByte === null ? null : firstByte - started,
            totalMs: performance.now() - started, bytes, reusedConnection: true,
            statusCode, ...result,
          });
        };
        stream.on('response', (headers) => {
          firstByte = performance.now();
          statusCode = Number(headers[':status']);
        });
        stream.on('data', (chunk) => {
          bytes += chunk.length;
          if (captureBody && bytes <= maxCaptureBytes) chunks.push(chunk);
        });
        stream.on('end', () => {
          const captureExceeded = captureBody && bytes > maxCaptureBytes;
          const statusOk = successfulStatus(statusCode);
          finish({
            ok: statusOk && !captureExceeded,
            body: captureBody && !captureExceeded ? Buffer.concat(chunks) : undefined,
            error: captureExceeded ? 'capture_limit_exceeded' : statusOk ? null : `http_${statusCode ?? 'response'}`,
          });
        });
        stream.on('error', (error) => finish({ error: timedOut ? 'timeout' : error.code || error.message }));
        stream.on('close', () => { if (!settled) finish({ error: timedOut ? 'timeout' : 'stream_closed' }); });
        stream.end();
      });
    },
    close() { session.destroy(); socket.destroy(); },
  };
}

export async function createPageClient(target) {
  if (!target.proxy && !net.isIP(target.ip)) throw new Error(`Invalid candidate IP: ${target.ip}`);
  if (target.proxy && (!target.proxy.port || !target.proxy.host)) throw new Error('Invalid SOCKS proxy configuration');
  return target.protocol === 'h2' ? makeH2Client(target) : makeH1Client(target);
}
