// Absolute quality gates.
//
// 0.6.0 ranked candidates only relative to each other, so an IP could score 91
// while being unusable in practice. Gates add absolute, human-meaningful limits:
// a candidate that fails a gate can never be presented as a good IP, no matter
// how it compares to the rest of the run.

export const GATE_DEFINITIONS = [
	{
		name: 'sustainedMbps',
		label: 'Sustained downlink',
		unit: 'Mbps',
		direction: 'higher',
		warn: 6,
		fail: 1.5,
		reason: 'not enough sustained bandwidth for video or heavy pages',
	},
	{
		name: 'shapingRatio',
		label: 'Late/early throughput',
		unit: 'ratio',
		direction: 'higher',
		warn: 0.7,
		fail: 0.4,
		reason: 'throughput collapses after the first seconds (traffic shaping)',
	},
	{
		name: 'loadedRttMs',
		label: 'RTT under load',
		unit: 'ms',
		direction: 'lower',
		warn: 250,
		fail: 600,
		reason: 'round trips are too slow while the link is busy',
	},
	{
		name: 'rttInflation',
		label: 'RTT inflation under load',
		unit: 'x',
		direction: 'lower',
		warn: 1.6,
		fail: 3,
		reason: 'latency explodes as soon as traffic starts (bufferbloat)',
	},
	{
		name: 'jitterMs',
		label: 'Jitter (p95 - p50)',
		unit: 'ms',
		direction: 'lower',
		warn: 60,
		fail: 150,
		reason: 'latency is unstable, so interactive traffic stalls',
	},
	{
		name: 'lossRate',
		label: 'Request loss under load',
		unit: 'ratio',
		direction: 'lower',
		warn: 0.02,
		fail: 0.08,
		reason: 'requests are dropped while the link is busy',
	},
	{
		name: 'fanoutSuccess',
		label: 'Parallel request success',
		unit: 'ratio',
		direction: 'higher',
		warn: 0.98,
		fail: 0.9,
		reason: 'parallel requests fail, which is what a real page load does',
	},
	{
		name: 'freshConnectionMs',
		label: 'Fresh connection setup p90',
		unit: 'ms',
		direction: 'lower',
		warn: 800,
		fail: 2000,
		reason: 'opening new connections is too slow, so pages feel dead',
	},
	{
		name: 'uplinkMbps',
		label: 'Sustained uplink',
		unit: 'Mbps',
		direction: 'higher',
		warn: 1,
		fail: 0.25,
		reason: 'uplink is too weak to carry requests and handshakes',
	},
]

export const SCORE_CAPS = { pass: 100, warn: 75, fail: 45 }

const STATUS_RANK = { pass: 0, unknown: 1, warn: 2, fail: 3 }

function limitsFor(definition, overrides) {
	const override = (overrides && overrides[definition.name]) || {}
	return {
		warn: typeof override.warn === 'number' ? override.warn : definition.warn,
		fail: typeof override.fail === 'number' ? override.fail : definition.fail,
	}
}

function statusFor(definition, value, limits) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
	if (definition.direction === 'higher') {
		if (value < limits.fail) return 'fail'
		if (value < limits.warn) return 'warn'
		return 'pass'
	}
	if (value > limits.fail) return 'fail'
	if (value > limits.warn) return 'warn'
	return 'pass'
}

/**
 * Evaluate absolute gates for one candidate.
 *
 * @param {Record<string, number|null|undefined>} metrics measured values keyed by gate name
 * @param {{ overrides?: Record<string, {warn?: number, fail?: number}>, requireAll?: boolean }} [options]
 */
export function evaluateGates(metrics = {}, options = {}) {
	const { overrides, requireAll = true } = options
	const checks = []
	const failures = []
	const warnings = []
	const missing = []
	const reasons = []

	for (const definition of GATE_DEFINITIONS) {
		const limits = limitsFor(definition, overrides)
		const raw = metrics[definition.name]
		const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
		const status = statusFor(definition, value, limits)
		checks.push({
			name: definition.name,
			label: definition.label,
			unit: definition.unit,
			value,
			warn: limits.warn,
			fail: limits.fail,
			status,
		})
		if (status === 'fail') {
			failures.push(definition.name)
			reasons.push(definition.reason)
		} else if (status === 'warn') {
			warnings.push(definition.name)
		} else if (status === 'unknown') {
			missing.push(definition.name)
		}
	}

	let status = 'pass'
	if (failures.length > 0) status = 'fail'
	else if (warnings.length > 0) status = 'warn'
	else if (missing.length > 0) status = requireAll ? 'unknown' : 'pass'

	const scoreCap = status === 'unknown' ? SCORE_CAPS.warn : SCORE_CAPS[status]

	return { status, scoreCap, checks, failures, warnings, missing, reasons }
}

/**
 * Apply a gate result to a run-relative score.
 * A gate can only lower a score, never raise it.
 */
export function capScore(score, gateResult) {
	if (typeof score !== 'number' || !Number.isFinite(score)) return null
	const cap = (gateResult && gateResult.scoreCap) || SCORE_CAPS.pass
	return Math.min(score, cap)
}

/**
 * Human verdict for one candidate, so a report never presents a bare number.
 */
export function buildVerdict({ gateResult, cappedScore, streamingScore, confidence } = {}) {
	const status = (gateResult && gateResult.status) || 'unknown'
	if (status === 'fail') {
		return {
			label: 'unusable',
			summary: 'Fails at least one absolute quality gate.',
			reasons: (gateResult && gateResult.reasons) || [],
		}
	}
	if (status === 'unknown') {
		return {
			label: 'unverified',
			summary: 'Some load stages were not measured, so the score is provisional.',
			reasons: ((gateResult && gateResult.missing) || []).map((name) => `${name} was not measured`),
		}
	}
	const weakStreaming = typeof streamingScore === 'number' && streamingScore < 70
	if (status === 'warn' || weakStreaming) {
		return {
			label: weakStreaming ? 'browsing-only' : 'usable',
			summary: weakStreaming
				? 'Acceptable for pages, not reliable for video.'
				: 'Usable, but at least one metric is close to its limit.',
			reasons: (gateResult && gateResult.warnings) || [],
		}
	}
	const strong = typeof cappedScore === 'number' && cappedScore >= 80
	const trusted = confidence === 'medium' || confidence === 'high'
	return {
		label: strong && trusted ? 'recommended' : 'good',
		summary: trusted
			? 'Passes every absolute gate with a stable measurement.'
			: 'Passes every absolute gate, but needs more samples to be trusted.',
		reasons: [],
	}
}

export function worstStatus(statuses = []) {
	return statuses.reduce((worst, current) => {
		return (STATUS_RANK[current] || 0) > (STATUS_RANK[worst] || 0) ? current : worst
	}, 'pass')
}
