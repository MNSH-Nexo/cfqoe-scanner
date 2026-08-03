import { calibrateConcurrency } from './calibration.js';
import { probeWebsocket } from '../probe/websocket.js';

function positiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export async function calibrateWebsocketConcurrency({
  candidates = [],
  vless,
  calibration = {},
  requestedConcurrency = 1,
  timeoutMs = 6000,
  probeTask = probeWebsocket,
} = {}) {
  const requested = positiveInteger(requestedConcurrency);
  if (calibration?.enabled === false) {
    return { enabled: false, selectedConcurrency: requested, requestedConcurrency: requested, reason: 'disabled', levels: [] };
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { enabled: true, selectedConcurrency: requested, requestedConcurrency: requested, reason: 'no_candidates', levels: [] };
  }

  let control = null;
  for (const candidate of candidates.slice(0, 8)) {
    const observation = await probeTask({ ip: candidate.ip, vless, timeoutMs });
    if (observation?.ok) {
      control = candidate;
      break;
    }
  }
  if (!control) {
    return { enabled: true, selectedConcurrency: requested, requestedConcurrency: requested, reason: 'no_working_control', levels: [] };
  }

  const configuredLevels = Array.isArray(calibration?.levels) ? calibration.levels : [1, 2, 4, 8, 12, 16];
  const levels = [...new Set([
    1,
    ...configuredLevels.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= requested),
    requested,
  ])].sort((a, b) => a - b);

  const result = await calibrateConcurrency({
    levels,
    latencyInflationLimit: calibration?.latencyInflationLimit,
    failureRateIncreaseLimit: calibration?.failureRateIncreaseLimit,
    eventLoopLagLimitMs: calibration?.eventLoopLagLimitMs,
    controlTask: () => probeTask({ ip: control.ip, vless, timeoutMs }),
  });

  return {
    enabled: true,
    requestedConcurrency: requested,
    selectedConcurrency: Math.min(requested, positiveInteger(result.selectedConcurrency)),
    controlIp: control.ip,
    reason: 'measured',
    baseline: result.baseline,
    levels: result.levels,
  };
}
