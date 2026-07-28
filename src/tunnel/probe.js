import { performance } from 'node:perf_hooks';
import { startXrayTunnel } from '../xray/manager.js';
import { probePage } from '../browsing/probe.js';
import { probeStreaming } from '../streaming/probe.js';
import { nullLogger } from '../logging/logger.js';

export async function probeTunnelCandidate({
  ip, runtime, xray, browsing, streaming, logger = nullLogger,
}) {
  const log = logger.child({ component: 'tunnel', ip });
  const started = performance.now();
  let session;
  try {
    log.info('tunnel.probe.start', {
      browsing: Boolean(browsing), streaming: Boolean(streaming),
      transport: runtime.transport, security: runtime.security,
    });
    session = await startXrayTunnel({
      runtime,
      candidateIp: ip,
      binaryPath: xray.path,
      startupTimeoutMs: xray.startupTimeoutMs,
      shutdownGraceMs: xray.shutdownGraceMs,
      logger,
    });
    let browsingResult = null;
    let streamingResult = null;
    if (browsing) {
      browsingResult = await probePage(ip, { ...browsing.target, proxy: session.proxy }, browsing.options, logger);
    }
    if (streaming) {
      streamingResult = await probeStreaming(ip, { ...streaming.target, proxy: session.proxy }, streaming.options, logger);
    }
    const ok = (!browsingResult || browsingResult.ok) && (!streamingResult || streamingResult.ok);
    const output = {
      ok,
      startupMs: session.startupMs,
      browsing: browsingResult,
      streaming: streamingResult,
      totalMs: performance.now() - started,
      error: ok ? null : 'tunnel_workload_failed',
    };
    log.info('tunnel.probe.complete', {
      ok, startupMs: output.startupMs, durationMs: output.totalMs,
      browsingOk: browsingResult?.ok, streamingOk: streamingResult?.ok,
    });
    return output;
  } catch (error) {
    log.error('tunnel.probe.error', { durationMs: performance.now() - started, error });
    return {
      ok: false, startupMs: session?.startupMs ?? null,
      browsing: null, streaming: null,
      totalMs: performance.now() - started,
      error: error.code || error.message,
    };
  } finally {
    await session?.stop();
  }
}
