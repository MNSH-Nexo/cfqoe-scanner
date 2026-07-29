import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { connectSocks5 } from './socks5.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 CFQoE/0.7';

function createAgent({ proxy, secure, timeoutMs, maxSockets }) {
  const Base = secure ? https.Agent : http.Agent;
  class ProxyAgent extends Base {
    createConnection(options, callback) {
      const port = Number(options.port) || (secure ? 443 : 80);
      const host = options.host;
      const dial = proxy ? connectSocks5(proxy, { host, port }, timeoutMs) : Promise.resolve(net.connect({ host, port }));
      dial.then((socket) => {
        if (!secure) return callback(null, socket);
        const secureSocket = tls.connect({ socket, servername: options.servername || host, ALPNProtocols: ['http/1.1'] });
        secureSocket.once('secureConnect', () => callback(null, secureSocket));
        secureSocket.once('error', callback);
      }).catch(callback);
      return undefined;
    }
  }
  return new ProxyAgent({ keepAlive: true, maxSockets, maxFreeSockets: maxSockets });
}

export function createHttpClient({ proxy = null, timeoutMs = 15000, maxSockets = 1 } = {}) {
  const agents = { http: null, https: null };
  function agentFor(secure) {
    const key = secure ? 'https' : 'http';
    if (!agents[key]) agents[key] = createAgent({ proxy, secure, timeoutMs, maxSockets });
    return agents[key];
  }

  function request(rawUrl, {
    captureBody = false,
    maxBytes = 4 * 1024 * 1024,
    redirects = 3,
    headers = {},
    method = 'GET',
    body = null,
    keepAlive = true,
    onFirstByte = null,
    onProgress = null,
  } = {}) {
    return new Promise((resolve) => {
      let url;
      try { url = new URL(rawUrl); }
      catch { resolve({ url: rawUrl, ok: false, error: 'invalid_url', bytes: 0, ttfbMs: null, totalMs: null }); return; }
      const secure = url.protocol === 'https:';
      const transport = secure ? https : http;
      const started = performance.now();
      let ttfb = null;
      let bytes = 0;
      const chunks = [];
      let settled = false;
      let exceeded = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({
          url: rawUrl, ok: false, statusCode: null,
          ttfbMs: ttfb === null ? null : Math.round((ttfb - started) * 100) / 100,
          totalMs: Math.round((performance.now() - started) * 100) / 100,
          bytes, error: null, ...result,
        });
      };
      const payload = body === null || body === undefined
        ? null
        : (Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
      const outgoingHeaders = {
        Host: url.host, Accept: '*/*', 'Accept-Encoding': 'identity',
        'User-Agent': USER_AGENT, Connection: keepAlive ? 'keep-alive' : 'close', ...headers,
      };
      if (payload) outgoingHeaders['Content-Length'] = String(payload.length);
      const clientRequest = transport.request({
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        servername: url.hostname,
        agent: agentFor(secure),
        headers: outgoingHeaders,
      }, (response) => {
        ttfb = performance.now();
        if (typeof onFirstByte === 'function') onFirstByte(ttfb - started);
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location && redirects > 0) {
          response.resume();
          const next = new URL(response.headers.location, url).toString();
          request(next, { captureBody, maxBytes, redirects: redirects - 1, headers, method, body, keepAlive, onFirstByte, onProgress })
            .then((result) => finish({ ...result, redirected: true }));
          return;
        }
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (typeof onProgress === 'function') onProgress(chunk.length, performance.now() - started);
          if (bytes > maxBytes) { exceeded = true; response.destroy(); return; }
          if (captureBody) chunks.push(chunk);
        });
        response.on('end', () => {
          if (exceeded) return finish({ statusCode: status, error: 'body_limit_exceeded' });
          const ok = status >= 200 && status < 400;
          finish({
            ok, statusCode: status, contentType: response.headers['content-type'] || null,
            headers: response.headers,
            body: captureBody ? Buffer.concat(chunks) : undefined,
            error: ok ? null : `http_${status}`,
          });
        });
        response.on('aborted', () => finish({ statusCode: status, error: exceeded ? 'body_limit_exceeded' : 'aborted' }));
      });
      clientRequest.setTimeout(timeoutMs, () => clientRequest.destroy(new Error('timeout')));
      clientRequest.on('error', (error) => finish({ error: exceeded ? 'body_limit_exceeded' : error.code || error.message }));
      if (payload) clientRequest.write(payload);
      clientRequest.end();
    });
  }
  return { request, close() { for (const agent of Object.values(agents)) agent?.destroy(); } };
}

export function extractAssets(html, baseUrl, limit = 8) {
  const text = String(html);
  const found = [];
  const seen = new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match !== null) {
      let absolute = null;
      try { absolute = new URL(match[1], baseUrl).toString(); } catch { /* ignore */ }
      if (absolute && !seen.has(absolute) && /^https?:/.test(absolute)) {
        seen.add(absolute); found.push(absolute);
      }
      if (found.length >= limit) return found;
      match = pattern.exec(text);
    }
  }
  return found;
}
