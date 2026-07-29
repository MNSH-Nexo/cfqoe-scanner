// Absolute quality gates.
//
// 0.6.0 ranked candidates only relative to each other, so an IP could score 91
// while being unusable in practice. Gates add absolute, human-meaningful limits.
//
// 0.8.0 fixes the opposite failure mode: gates that were absolute where the
// physics is relative. On a tunnel to Frankfurt the base RTT is 150-300 ms no
// matter how good the edge is, so an absolute "RTT under load < 250 ms" gate
// failed every single candidate and flattened the whole report to one score.
// What matters is
//   * how many round trips per minute the path delivers WHILE loaded (RPM, as
//     defined by the IETF responsiveness work), and
//   * how much delay the path ADDS under load compared to its own idle baseline
//     (bufferbloat), not the geographic baseline itself.

export const GATE_DEFINITIONS = [
	{
		name: 'sustainedMbps',
		label: 'Sustained downlink',
		unit: 'Mbps',
		direction: 'higher',
		warn: 8,
		fail: 2,
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
		name: 'rpm',
		label: 'Responsiveness under load',
		unit: 'rpm',
		direction: 'higher',
		warn: 300,
		fail: 100,
		reason: 'too few round trips per minute under load, so pages crawl',
	},
	{
		name: 'rttIncreaseMs',
		label: 'Added delay under load',
		unit: 'ms',
		direction: 'lower',
		warn: 120,
		fail: 400,
		reason: 'the path adds a lot of delay as soon as it is busy (bufferbloat)',
	},
	{
		name: 'rttInflation',
		label: 'RTT inflation under load',
		unit: 'x',
		direction: 'lower',
		warn: 2,
		fail: 4,
		reason: 'latency multiplies as soon as traffic starts',
	},
	{
		name: 'jitterMs',
		label: 'Jitter (p95 - p50)',
		unit: 'ms',
		direction: 'lower',
		warn: 80,
		fail: 250,
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
		warn: 1200,
		fail: 3000,
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

// Named threshold profiles.
//
// `balanced` is the shipped default and is written for a real tunnel over a
// long, congested path. `strict` is for picking the best of an already good
// set (data-centre or low-RTT paths). `tolerant` is for very constrained links
// where the question is only "is this usable at all".
export const GATE_PROFILES = {
	balanced: {},
	strict: {
		sustainedMbps: { warn: 20, fail: 6 },
		rpm: { warn: 600, fail: 200 },
		rttIncreaseMs: { warn: 60, fail: 200 },
		rttInflation: { warn: 1.5, fail: 2.5 },
		jitterMs: { warn: 50, fail: 120 },
		freshConnectionMs: { warn: 700, fail: 1800 },
		uplinkMbps: { warn: 3, fail: 1 },
	},
	tolerant: {
		sustainedMbps: { warn: 4, fail: 1 },
		shapingRatio: { warn: 0.55, fail: 0.3 },
		rpm: { warn: 150, fail: 60 },
		rttIncreaseMs: { warn: 250, fail: 800 },
		rttInflation: { warn: 3, fail: 6 },
		jitterMs: { warn: 150, fail: 400 },
		fanoutSuccess: { warn: 0.9, fail: 0.75 },
		freshConnectionMs: { warn: 2000, fail: 5000 },
		uplinkMbps: { warn: 0.5, fail: 0.1 },
	},
}

export const DEFAULT_GATE_PROFILE = 'balanced'

/**
 * Merge a named profile with explicit per-gate overrides.
 * Explicit overrides always win, so a user setting is never silently replaced.
 */
export function resolveGateOverrides(profile = DEFAULT_GATE_PROFILE, overrides = {}) {
	const base = GATE_PROFILES[profile] || GATE_PROFILES[DEFAULT_GATE_PROFILE]
	const merged = {}
	for (const definition of GATE_DEFINITIONS) {
		const fromProfile = base[definition.name] || {}
		const fromUser = (overrides && overrides[definition.name]) || {}
		const limits = { ...fromProfile, ...fromUser }
		if (Object.keys(limits).length > 0) merged[definition.name] = limits
	}
	return merged
}

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
 * @param {{ overrides?: Record<string, {warn?: number, fail?: number}>, profile?: string, requireAll?: boolean }} [options]
 */
export function evaluateGates(metrics = {}, options = {}) {
	const { overrides, profile, requireAll = true } = options
	const effective = profile ? resolveGateOverrides(profile, overrides) : overrides
	const checks = []
	const failures = []
	const warnings = []
	const missing = []
	const reasons = []

	for (const definition of GATE_DEFINITIONS) {
		const limits = limitsFor(definition, effective)
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

	return {
		status,
		scoreCap,
		profile: profile || DEFAULT_GATE_PROFILE,
		checks,
		failures,
		warnings,
		missing,
		reasons,
		// The single most important reason a candidate is not better than it is.
		// Reports print this so a table of identical scores is never a dead end.
		limiting: failures[0] || warnings[0] || missing[0] || null,
	}
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
			limiting: (gateResult && gateResult.limiting) || null,
			reasons: (gateResult && gateResult.reasons) || [],
		}
	}
	if (status === 'unknown') {
		return {
			label: 'unverified',
			summary: 'Some load stages were not measured, so the score is provisional.',
			limiting: (gateResult && gateResult.limiting) || null,
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
			limiting: (gateResult && gateResult.limiting) || null,
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
		limiting: null,
		reasons: [],
	}
}

export function worstStatus(statuses = []) {
	return statuses.reduce((worst, current) => {
		return (STATUS_RANK[current] || 0) > (STATUS_RANK[worst] || 0) ? current : worst
	}, 'pass')
}
