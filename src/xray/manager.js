import fs from 'node:fs/promises';
import fsConstants from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { buildXrayConfig } from './config.js';
import { nullLogger } from '../logging/logger.js';

async function executable(filePath) {
  try { await fs.access(filePath, fsConstants.constants.X_OK); return true; }
  catch { return false; }
}

export async function resolveXrayBinary(requested = 'auto') {
  const candidates = [];
  if (requested && requested !== 'auto') candidates.push(path.resolve(requested));
  if (process.env.XRAY_PATH) candidates.push(path.resolve(process.env.XRAY_PATH));
  candidates.push(path.resolve(import.meta.dirname, '../../bin/xray'));
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'xray'));
  }
  for (const candidate of [...new Set(candidates)]) {
    if (await executable(candidate)) return candidate;
  }
  throw new Error('Xray binary was not found; set xray.path or XRAY_PATH');
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 150);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function cleanOutput(text, credential) {
  let value = String(text || '');
  if (credential) value = value.split(credential).join('[REDACTED_UUID]');
  return value.length > 8192 ? `${value.slice(0, 8192)}…[TRUNCATED]` : value;
}

async function waitForReady(child, port, timeoutMs, stderr) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Xray exited before readiness: ${stderr() || `code ${child.exitCode}`}`);
    if (await canConnect(port)) return;
    await sleep(75);
  }
  throw new Error(`Xray SOCKS inbound was not ready within ${timeoutMs}ms`);
}

export async function startXrayTunnel({
  runtime, candidateIp, binaryPath = 'auto', startupTimeoutMs = 6000,
  shutdownGraceMs = 1500, logger = nullLogger,
}) {
  const log = logger.child({ component: 'xray', ip: candidateIp });
  const binary = await resolveXrayBinary(binaryPath);
  const socksPort = await reservePort();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cfqoe-xray-'));
  await fs.chmod(tempDir, 0o700);
  const configPath = path.join(tempDir, 'config.json');
  const config = buildXrayConfig(runtime, candidateIp, socksPort);
  await fs.writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);

  const started = performance.now();
  let stderr = '';
  const child = spawn(binary, ['run', '-c', configPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env },
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = cleanOutput(`${stderr}${chunk}`, runtime.id).slice(-32768);
    log.debug('xray.stderr', { message: cleanOutput(chunk, runtime.id) });
  });
  log.info('xray.start', { binary, socksPort, transport: runtime.transport, security: runtime.security });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const stopStarted = performance.now();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const exited = await Promise.race([
        new Promise((resolve) => child.once('exit', () => resolve(true))),
        sleep(shutdownGraceMs).then(() => false),
      ]);
      if (!exited && child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    log.info('xray.stop', { durationMs: performance.now() - stopStarted, exitCode: child.exitCode });
  };

  try {
    await waitForReady(child, socksPort, startupTimeoutMs, () => stderr);
    const startupMs = performance.now() - started;
    log.info('xray.ready', { socksPort, startupMs });
    return {
      proxy: { host: '127.0.0.1', port: socksPort, type: 'socks5' },
      startupMs,
      pid: child.pid,
      binary,
      stop,
    };
  } catch (error) {
    log.error('xray.start.error', { error, stderr: cleanOutput(stderr, runtime.id) });
    await stop();
    throw error;
  }
}
