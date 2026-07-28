import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { connectSocks5 } from './socks5.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CFQoE/0.5';

function createAgent({ proxy, secure, timeoutMs }) {
  const Base = secure ? https.Agent : http.Agent;

  class ProxyAgent extends Base {
    createConnection(options, callback) {
      const port = Number(options.port) || (secure ? 443 : 80);
      const host = options.host;

      const dial = proxy
        ? connectSocks5(proxy, { host, port }, timeoutMs)
        : Promise.resolve(net.connect({ host, port }));

      dial
        .then((socket) => {
          if (!secure) {
            callback(null, socket);
            return;
          }
          const secureSocket = tls.connect({
            socket,
            servername: options.servername || host,
            ALPNProtocols: ['http/1.1'],
          });
          secureSocket.once('secureConnect', () => callback(null, secureSocket));
          secureSocket.once('error', (error) => callback(error));
        })
        .catch((error) => callback(error));

      return undefined;
    }
  }

  return new ProxyAgent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 6 });
}

// A small HTTP client that can optionally tunnel every request through SOCKS5.
export function createHttpClient({ proxy = null, timeoutMs = 15000 } = {}) {
  const agents = { http: null, https: null };

  function agentFor(secure) {
    const key = secure ? 'https' : 'http';
    if (!agents[key]) agents[key] = createAgent({ proxy, secure, timeoutMs });
    return agents[key];
  }

  function request(rawUrl, { captureBody = false, maxBytes = 4 * 1024 * 1024, redirects = 3 } = {}) {
    return new Promise((resolve) => {
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        resolve({ url: rawUrl, ok: false, error: 'invalid_url', bytes: 0, ttfbMs: null, totalMs: null });
        return;
      }

      const secure = url.protocol === 'https:';
      const transport = secure ? https : http;
      const started = performance.now();
      let ttfb = null;
      let bytes = 0;
      const chunks = [];
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({
          url: rawUrl,
          ok: false,
          statusCode: null,
          ttfbMs: ttfb === null ? null : Math.round((ttfb - started) * 100) / 100,
          totalMs: Math.round((performance.now() - started) * 100) / 100,
          bytes,
          error: null,
          ...result,
        });
      };

      const clientRequest = transport.request(
        {
          protocol: url.protocol,
          host: url.hostname,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          servername: url.hostname,
          agent: agentFor(secure),
          headers: {
            Host: url.host,
            Accept: '*/*',
            'Accept-Encoding': 'identity',
            'User-Agent': USER_AGENT,
            Connection: 'keep-alive',
          },
        },
        (response) => {
          ttfb = performance.now();
          const status = response.statusCode || 0;

          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location && redirects > 0) {
            response.resume();
            const next = new URL(response.headers.location, url).toString();
            request(next, { captureBody, maxBytes, redirects: redirects - 1 }).then((result) =>
              finish({ ...result, redirected: true }),
            );
            return;
          }

          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (captureBody && bytes <= maxBytes) chunks.push(chunk);
            if (bytes > maxBytes && !captureBody) response.destroy();
          });

          response.on('end', () => {
            const ok = status >= 200 && status < 400;
            finish({
              ok,
              statusCode: status,
              contentType: response.headers['content-type'] || null,
              body: captureBody ? Buffer.concat(chunks) : undefined,
              error: ok ? null : `http_${status}`,
            });
          });

          response.on('aborted', () => finish({ statusCode: status, error: 'aborted' }));
        },
      );

      clientRequest.setTimeout(timeoutMs, () => clientRequest.destroy(new Error('timeout')));
      clientRequest.on('error', (error) => finish({ error: error.code || error.message }));
      clientRequest.end();
    });
  }

  return {
    request,
    close() {
      for (const agent of Object.values(agents)) agent?.destroy();
    },
  };
}

// Extracts a small, deterministic set of sub-resources from an HTML document.
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
      let absolute;
      try {
        absolute = new URL(match[1], baseUrl).toString();
      } catch {
        absolute = null;
      }
      if (absolute && !seen.has(absolute) && /^https?:/.test(absolute)) {
        seen.add(absolute);
        found.push(absolute);
      }
      if (found.length >= limit) return found;
      match = pattern.exec(text);
    }
  }
  return found;
}
