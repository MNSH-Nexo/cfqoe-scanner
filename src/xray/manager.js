import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { buildXrayConfig, describeXrayConfig } from './config.js';

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('xray_startup_timeout'));
        else setTimeout(attempt, 120);
      });
    };
    attempt();
  });
}

// Starts one short-lived Xray process bound to a private SOCKS inbound.
export async function startXray({
  xrayPath,
  vless,
  candidateIp,
  startupTimeoutMs = 8000,
  shutdownGraceMs = 1500,
  logger = null,
}) {
  const socksPort = await findFreePort();
  const config = buildXrayConfig({ vless, candidateIp, socksPort });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cfqoe-'), { mode: 0o700 });
  const configPath = path.join(directory, `${randomUUID()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

  const child = spawn(xrayPath, ['run', '-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.stdout.on('data', () => {});

  const cleanup = () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, shutdownGraceMs);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    cleanup();
    logger?.debug('xray.stop', { candidateIp, socksPort });
  };

  const failed = new Promise((_resolve, reject) => {
    child.once('error', (error) => reject(new Error(`xray_spawn_failed: ${error.message}`)));
    child.once('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`xray_exited_${code}`));
    });
  });

  logger?.debug('xray.start', { candidateIp, socksPort, ...describeXrayConfig(config) });

  try {
    await Promise.race([waitForPort(socksPort, startupTimeoutMs), failed]);
  } catch (error) {
    await stop();
    const reason = stderr.trim().split('\n').slice(-1)[0] || '';
    throw new Error(reason ? `${error.message} (${reason})` : error.message);
  }

  logger?.debug('xray.ready', { candidateIp, socksPort });

  return {
    socks: { host: '127.0.0.1', port: socksPort },
    describe: () => describeXrayConfig(config),
    stop,
  };
}
