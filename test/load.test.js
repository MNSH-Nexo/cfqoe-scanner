import test from 'node:test';
import assert from 'node:assert/strict';
import {
	summarizeWindows,
	summarizeLatency,
	summarizeFanout,
	toGateMetrics,
	quantile,
} from '../src/probe/load.js';
import { evaluateGates, capScore, buildVerdict, SCORE_CAPS } from '../src/measurement/gates.js';
import { summarizeLoad, scoreLoad, applyTunnelResults, rankCandidates } from '../src/report.js';
import { createDefaultSettings, migrateSettings, estimateTrafficBytes, SETTINGS_VERSION } from '../src/config/settings.js';

const MB = 1024 * 1024;

test('summarizeWindows reports sustained throughput over the whole transfer', () => {
	const windows = Array.from({ length: 6 }, () => ({ bytes: 2 * MB, ms: 1000, ok: true }));
	const summary = summarizeWindows(windows);
	assert.equal(summary.samples, 6);
	assert.equal(summary.totalBytes, 12 * MB);
	// 2 MiB per second is ~16.8 Mbps.
	assert.ok(summary.sustainedMbps > 16 && summary.sustainedMbps < 17.5);
	assert.equal(summary.shapingRatio, 1);
});

test('summarizeWindows detects throughput collapsing after the first seconds', () => {
	const windows = [
		{ bytes: 2 * MB, ms: 500, ok: true },
		{ bytes: 2 * MB, ms: 500, ok: true },
		{ bytes: 2 * MB, ms: 2000, ok: true },
		{ bytes: 2 * MB, ms: 4000, ok: true },
		{ bytes: 2 * MB, ms: 4000, ok: true },
		{ bytes: 2 * MB, ms: 4000, ok: true },
	];
	const summary = summarizeWindows(windows);
	assert.ok(summary.earlyMbps > summary.lateMbps);
	assert.ok(summary.shapingRatio !== null && summary.shapingRatio < 0.2);
});

test('summarizeWindows refuses to claim "no shaping" from too few samples', () => {
	const summary = summarizeWindows([
		{ bytes: 512 * 1024, ms: 300, ok: true },
		{ bytes: 512 * 1024, ms: 300, ok: true },
	]);
	assert.equal(summary.shapingRatio, null);
	assert.equal(summary.samples, 2);
});

test('summarizeWindows ignores failed windows and counts them', () => {
	const summary = summarizeWindows([
		{ bytes: 2 * MB, ms: 1000, ok: true },
		{ bytes: 0, ms: 6000, ok: false },
	]);
	assert.equal(summary.samples, 1);
	assert.equal(summary.failures, 1);
});

test('summarizeLatency reports inflation, jitter and loss under load', () => {
	const summary = summarizeLatency({
		idle: [40, 42, 44, 46],
		loaded: [120, 130, 140, 600],
		attempts: 10,
		failures: 2,
	});
	assert.equal(summary.idleRttMs, 43);
	assert.equal(summary.loadedRttMs, 135);
	assert.ok(summary.rttInflation > 3);
	assert.ok(summary.jitterMs > 200);
	assert.equal(summary.lossRate, 0.2);
});

test('quantile interpolates and tolerates single samples', () => {
	assert.equal(quantile([10], 0.9), 10);
	assert.equal(quantile([10, 20], 0.5), 15);
	assert.equal(quantile([], 0.5), null);
});

test('summarizeFanout scores parallel browser-like requests', () => {
	const summary = summarizeFanout(
		[
			{ ok: true, ttfbMs: 300, totalMs: 500 },
			{ ok: true, ttfbMs: 350, totalMs: 600 },
			{ ok: false, ttfbMs: null, totalMs: null },
			{ ok: true, ttfbMs: 1200, totalMs: 1500 },
		],
		1800,
	);
	assert.equal(summary.requests, 4);
	assert.equal(summary.fanoutSuccess, 0.75);
	assert.ok(summary.freshConnectionMs > 350);
	assert.equal(summary.wallClockMs, 1800);
});

test('gates fail a fast-looking link that collapses or stalls under load', () => {
	const metrics = toGateMetrics({
		downlink: { sustainedMbps: 18, shapingRatio: 0.2 },
		latency: { loadedRttMs: 900, rttInflation: 6, jitterMs: 300, lossRate: 0.15 },
		fanout: { fanoutSuccess: 0.5, freshConnectionMs: 2600 },
		uplink: { sustainedMbps: 0.1 },
	});
	const result = evaluateGates(metrics);
	assert.equal(result.status, 'fail');
	assert.ok(result.failures.includes('shapingRatio'));
	assert.ok(result.failures.includes('loadedRttMs'));
	assert.equal(capScore(96.4, result), SCORE_CAPS.fail);
	assert.equal(buildVerdict({ gateResult: result, cappedScore: 45 }).label, 'unusable');
});

test('gates pass a genuinely healthy link and keep the score', () => {
	const result = evaluateGates({
		sustainedMbps: 30,
		shapingRatio: 0.95,
		loadedRttMs: 90,
		rttInflation: 1.2,
		jitterMs: 25,
		lossRate: 0,
		fanoutSuccess: 1,
		freshConnectionMs: 350,
		uplinkMbps: 4,
	});
	assert.equal(result.status, 'pass');
	assert.equal(capScore(88.2, result), 88.2);
	assert.equal(
		buildVerdict({ gateResult: result, cappedScore: 88.2, streamingScore: 90, confidence: 'high' }).label,
		'recommended',
	);
});

test('missing load stages produce an unverified verdict, never a good one', () => {
	const result = evaluateGates({ sustainedMbps: 20 });
	assert.equal(result.status, 'unknown');
	assert.equal(capScore(99, result), SCORE_CAPS.warn);
	assert.equal(buildVerdict({ gateResult: result, cappedScore: 75 }).label, 'unverified');
});

test('summarizeLoad and scoreLoad aggregate probe observations', () => {
	const load = summarizeLoad([
		{
			ok: true,
			downlink: { sustainedMbps: 24, peakMbps: 30, earlyMbps: 26, lateMbps: 23, shapingRatio: 0.88, totalBytes: 12 * MB },
			latency: { idleRttMs: 60, loadedRttMs: 110, rttInflation: 1.3, jitterMs: 30, lossRate: 0 },
			fanout: { fanoutSuccess: 1, freshConnectionMs: 420 },
			uplink: { sustainedMbps: 3, totalBytes: 3 * MB },
		},
	]);
	assert.equal(load.observations, 1);
	assert.equal(load.bytes, 15 * MB);
	assert.equal(load.sustainedMbps, 24);
	const score = scoreLoad(load);
	assert.ok(score > 70 && score <= 100);
	assert.equal(scoreLoad(null), null);
});

function candidateSummary(ip) {
	return {
		ip,
		range: '104.16.0.0/24',
		eligibility: {
			attempts: 8,
			successes: 8,
			successRate: 1,
			confidence95: { lower: 0.68, upper: 1 },
			confidence: 'medium',
			handshakeMedianMs: 120,
			pops: { dominant: 'FRA', consistency: 1, observed: ['FRA'] },
			errors: {},
		},
	};
}

function tunnelWith(loadMetrics) {
	return {
		browsing: [{ score: 84, bytes: 3 * MB, coldMs: 900, warmMs: 400, ttfbP90Ms: 300, successRate: 1 }],
		streaming: [{ score: 96, bytes: 20 * MB, sustainableMbps: 8, startupDelaySec: 2, rebufferRatio: 0 }],
		load: [loadMetrics],
	};
}

test('a shaped link can no longer score 90 once the load stage runs', () => {
	const shaped = applyTunnelResults(
		candidateSummary('162.159.51.222'),
		tunnelWith({
			ok: true,
			downlink: { sustainedMbps: 1.1, shapingRatio: 0.2, totalBytes: 12 * MB },
			latency: { idleRttMs: 90, loadedRttMs: 850, rttInflation: 9, jitterMs: 260, lossRate: 0.12 },
			fanout: { fanoutSuccess: 0.6, freshConnectionMs: 2400 },
			uplink: { sustainedMbps: 0.2, totalBytes: 3 * MB },
		}),
		{ browsing: true, streaming: true, load: true },
	);
	assert.equal(shaped.gates.status, 'fail');
	assert.equal(shaped.verdict.label, 'unusable');
	assert.ok(shaped.scores.overall <= SCORE_CAPS.fail);
	assert.ok(shaped.scores.overallUncapped > shaped.scores.overall);
	assert.ok(shaped.measurement.bytesMeasured >= 12 * MB);
	assert.ok(shaped.verdict.reasons.length > 0);
});

test('ranking puts gated-out candidates below healthy ones regardless of score', () => {
	const healthy = applyTunnelResults(
		candidateSummary('104.16.0.9'),
		tunnelWith({
			ok: true,
			downlink: { sustainedMbps: 28, shapingRatio: 0.96, totalBytes: 14 * MB },
			latency: { idleRttMs: 60, loadedRttMs: 95, rttInflation: 1.2, jitterMs: 20, lossRate: 0 },
			fanout: { fanoutSuccess: 1, freshConnectionMs: 300 },
			uplink: { sustainedMbps: 4, totalBytes: 3 * MB },
		}),
		{ browsing: true, streaming: true, load: true },
	);
	const shaped = applyTunnelResults(
		candidateSummary('49.238.238.60'),
		tunnelWith({
			ok: true,
			downlink: { sustainedMbps: 1.2, shapingRatio: 0.25, totalBytes: 12 * MB },
			latency: { idleRttMs: 80, loadedRttMs: 700, rttInflation: 8, jitterMs: 200, lossRate: 0.1 },
			fanout: { fanoutSuccess: 0.7, freshConnectionMs: 2200 },
			uplink: { sustainedMbps: 0.2, totalBytes: 3 * MB },
		}),
		{ browsing: true, streaming: true, load: true },
	);
	const ranked = rankCandidates([shaped, healthy]);
	assert.equal(ranked[0].ip, '104.16.0.9');
	assert.equal(ranked[1].ip, '49.238.238.60');
});

test('load stage stays optional so older callers keep the previous weighting', () => {
	const legacy = applyTunnelResults(candidateSummary('104.16.0.5'), {
		browsing: [{ score: 80, bytes: 1024 }],
		streaming: [{ score: 90, bytes: 1024 }],
	}, { browsing: true, streaming: true });
	assert.equal(legacy.gates, null);
	assert.equal(legacy.verdict, null);
	assert.equal(legacy.scores.overall, legacy.scores.overallUncapped);
});

test('0.6.x settings are migrated away from a few hundred kilobytes per candidate', () => {
	const stored = {
		version: 2,
		streaming: { maxSegments: 10, quickSegments: 3, timeoutMs: 25000, workloads: ['mux-test-hls'] },
		browsing: { assetLimit: 6, timeoutMs: 15000 },
		tunnel: { limit: 9 },
	};
	const migrated = migrateSettings(stored, 'linux');
	const defaults = createDefaultSettings('linux');
	assert.equal(migrated.version, SETTINGS_VERSION);
	assert.equal(migrated.migratedFrom, 2);
	assert.equal(migrated.streaming.maxSegments, defaults.streaming.maxSegments);
	assert.ok(migrated.streaming.maxSegments >= 24);
	assert.equal(migrated.browsing.assetLimit, defaults.browsing.assetLimit);
	assert.equal(migrated.load.enabled, true);
	// user choices survive the migration
	assert.deepEqual(migrated.streaming.workloads, ['mux-test-hls']);
	assert.equal(migrated.tunnel.limit, 9);
});

test('explicit user volumes are never overwritten by the migration', () => {
	const migrated = migrateSettings({ version: 2, streaming: { maxSegments: 40 } }, 'linux');
	assert.equal(migrated.streaming.maxSegments, 40);
});

test('planned traffic per candidate is several megabytes, not kilobytes', () => {
	const desktop = estimateTrafficBytes(createDefaultSettings('linux'));
	const android = estimateTrafficBytes(createDefaultSettings('android'));
	assert.ok(desktop > 30 * MB, `expected > 30 MB, got ${desktop}`);
	assert.ok(android > 12 * MB, `expected > 12 MB, got ${android}`);
	assert.ok(android < desktop);
});
