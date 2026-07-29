// Real-load probe.
//
// 0.7.0 pushed megabytes instead of kilobytes, but still saturated the link
// with a SINGLE connection. On a tunnel with 150-300 ms RTT one TCP flow is
// bounded by the bandwidth-delay product, not by the link, so a perfectly good
// edge measured 1-3 Mbps and was failed by the absolute gates.
//
// 0.8.0 follows the two references that already solved this problem:
//   * Cloudflare's own speedtest engine, which saturates with multiple parallel
//     requests and a ramp-up per direction,
//   * IETF "Responsiveness under Working Conditions" (RPM), which defines load
//     as parallel flows and scores latency measured DURING that load.
//
// Stages:
//   1. idle latency baseline,
//   2. parallel saturating download (N flows) with concurrent latency probes,
//   3. browser-like fan-out on fresh connections,
//   4. sustained uplink,
//   5. optional non-Cloudflare control download to locate the bottleneck.
//
// Every summarisation helper is pure and exported so it can be tested offline.

import { performance } from 'node:perf_hooks'
import { createHttpClient } from '../net/http.js'

export const DEFAULT_LOAD_ENDPOINTS = {
	download: 'https://speed.cloudflare.com/__down',
	upload: 'https://speed.cloudflare.com/__up',
	ping: 'https://speed.cloudflare.com/__down?bytes=1000',
	// Deliberately NOT Cloudflare: used only to tell "this edge is slow" apart
	// from "my own uplink or server is slow".
	control: 'https://ash-speed.hetzner.com/100MB.bin',
}

function toMbps(bytes, ms) {
	if (!Number.isFinite(bytes) || !Number.isFinite(ms) || ms <= 0) return null
	return (bytes * 8) / (ms / 1000) / 1e6
}

function round(value, digits = 2) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

function sorted(values) {
	return values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
}

export function quantile(values, fraction) {
	const list = sorted(values)
	if (list.length === 0) return null
	if (list.length === 1) return list[0]
	const position = (list.length - 1) * fraction
	const low = Math.floor(position)
	const high = Math.ceil(position)
	if (low === high) return list[low]
	return list[low] + (list[high] - list[low]) * (position - low)
}

/**
 * Summarise a sequence of timed transfer windows on ONE connection.
 * Windows are chronological; each is { bytes, ms, ok }.
 * Still used for the uplink stage and for single-flow diagnostics.
 */
export function summarizeWindows(windows = []) {
	const usable = windows.filter((window) => window && window.ok && window.ms > 0 && window.bytes > 0)
	const empty = {
		samples: 0,
		sustainedMbps: null,
		peakMbps: null,
		earlyMbps: null,
		lateMbps: null,
		shapingRatio: null,
		totalBytes: 0,
		totalMs: 0,
		failures: windows.length - usable.length,
	}
	if (usable.length === 0) return empty

	const totalBytes = usable.reduce((sum, window) => sum + window.bytes, 0)
	const totalMs = usable.reduce((sum, window) => sum + window.ms, 0)
	const rates = usable.map((window) => toMbps(window.bytes, window.ms))

	const edge = Math.max(1, Math.floor(usable.length / 3))
	const earlyMbps = quantile(rates.slice(0, edge), 0.5)
	const lateMbps = quantile(rates.slice(-edge), 0.5)
	const comparable = usable.length >= 3 && earlyMbps > 0

	return {
		samples: usable.length,
		sustainedMbps: round(toMbps(totalBytes, totalMs)),
		peakMbps: round(Math.max(...rates)),
		earlyMbps: round(earlyMbps),
		lateMbps: round(lateMbps),
		// Deliberately null (unknown) instead of 1 when there is not enough history:
		// claiming "no shaping" from two samples is exactly the old mistake.
		shapingRatio: comparable ? round(Math.min(lateMbps / earlyMbps, 2), 3) : null,
		totalBytes,
		totalMs: round(totalMs),
		failures: windows.length - usable.length,
	}
}

/**
 * Summarise a parallel, saturating transfer.
 *
 * This is the honest aggregate: bytes moved by ALL flows divided by the
 * wall-clock time of the stage. Summing per-flow durations (as a single-flow
 * summary does) would divide by N times too much time and under-report the
 * link by roughly the flow count.
 *
 * @param {object} options
 * @param {Array<{bytes:number, ms:number, ok:boolean, flow?:number, offsetMs?:number}>} options.windows
 * @param {number} options.wallClockMs wall-clock duration of the saturating stage
 * @param {number} [options.flows] number of parallel flows used
 */
export function summarizeSaturation({ windows = [], wallClockMs = null, flows = 1 } = {}) {
	const usable = windows.filter((window) => window && window.ok && window.bytes > 0)
	const failures = windows.length - usable.length
	if (usable.length === 0 || !Number.isFinite(wallClockMs) || wallClockMs <= 0) {
		return {
			flows,
			samples: 0,
			failures,
			totalBytes: 0,
			wallClockMs: round(wallClockMs),
			sustainedMbps: null,
			peakMbps: null,
			earlyMbps: null,
			lateMbps: null,
			shapingRatio: null,
			perFlowMbps: null,
		}
	}

	const totalBytes = usable.reduce((sum, window) => sum + window.bytes, 0)
	const perWindowMbps = usable.map((window) => toMbps(window.bytes, window.ms)).filter((value) => value !== null)

	// Split by wall-clock thirds so shaping is measured over time, not over
	// per-flow sample order: with parallel flows those two are not the same.
	const positioned = usable.filter((window) => Number.isFinite(window.offsetMs))
	let earlyMbps = null
	let lateMbps = null
	if (positioned.length >= 3) {
		const third = wallClockMs / 3
		const earlyBytes = positioned
			.filter((window) => window.offsetMs <= third)
			.reduce((sum, window) => sum + window.bytes, 0)
		const lateBytes = positioned
			.filter((window) => window.offsetMs >= third * 2)
			.reduce((sum, window) => sum + window.bytes, 0)
		earlyMbps = earlyBytes > 0 ? toMbps(earlyBytes, third) : null
		lateMbps = lateBytes > 0 ? toMbps(lateBytes, third) : null
	}
	const comparable = typeof earlyMbps === 'number' && earlyMbps > 0 && typeof lateMbps === 'number'

	return {
		flows,
		samples: usable.length,
		failures,
		totalBytes,
		wallClockMs: round(wallClockMs),
		sustainedMbps: round(toMbps(totalBytes, wallClockMs)),
		peakMbps: perWindowMbps.length ? round(Math.max(...perWindowMbps)) : null,
		earlyMbps: round(earlyMbps),
		lateMbps: round(lateMbps),
		shapingRatio: comparable ? round(Math.min(lateMbps / earlyMbps, 2), 3) : null,
		perFlowMbps: round(toMbps(totalBytes, wallClockMs) / Math.max(1, flows)),
	}
}

/**
 * Round-trips per minute, as defined by the IETF responsiveness work.
 * Higher is better; it is simply how many request/response cycles fit into a
 * minute at the latency the user actually experiences while the link is busy.
 */
export function responsivenessRpm(loadedRttMs) {
	if (typeof loadedRttMs !== 'number' || !Number.isFinite(loadedRttMs) || loadedRttMs <= 0) return null
	return round(60000 / loadedRttMs)
}

/**
 * Summarise latency samples taken while idle and while the link is loaded.
 */
export function summarizeLatency({ idle = [], loaded = [], attempts = 0, failures = 0 } = {}) {
	const idleRttMs = quantile(idle, 0.5)
	const loadedRttMs = quantile(loaded, 0.5)
	const loadedP95 = quantile(loaded, 0.95)
	const totalAttempts = attempts || idle.length + loaded.length + failures
	const hasBoth = typeof idleRttMs === 'number' && typeof loadedRttMs === 'number'
	return {
		idleRttMs: round(idleRttMs),
		loadedRttMs: round(loadedRttMs),
		loadedP95Ms: round(loadedP95),
		// Added delay is the part the path is responsible for; absolute RTT is
		// mostly geography and must not be gated as if it were a defect.
		rttIncreaseMs: hasBoth ? round(loadedRttMs - idleRttMs) : null,
		rttInflation: hasBoth && idleRttMs > 0 ? round(loadedRttMs / idleRttMs, 2) : null,
		rpm: responsivenessRpm(loadedRttMs),
		idleRpm: responsivenessRpm(idleRttMs),
		jitterMs:
			typeof loadedP95 === 'number' && typeof loadedRttMs === 'number'
				? round(loadedP95 - loadedRttMs)
				: null,
		lossRate: totalAttempts > 0 ? round(failures / totalAttempts, 4) : null,
		samples: { idle: idle.length, loaded: loaded.length, attempts: totalAttempts, failures },
	}
}

/**
 * Summarise a browser-like parallel fan-out.
 * Results are { ok, totalMs, ttfbMs }.
 */
export function summarizeFanout(results = [], wallClockMs = null) {
	if (results.length === 0) {
		return { requests: 0, fanoutSuccess: null, freshConnectionMs: null, wallClockMs: null }
	}
	const successes = results.filter((result) => result && result.ok)
	const setupTimes = successes
		.map((result) => (typeof result.ttfbMs === 'number' ? result.ttfbMs : result.totalMs))
		.filter((value) => typeof value === 'number' && Number.isFinite(value))
	return {
		requests: results.length,
		fanoutSuccess: round(successes.length / results.length, 4),
		freshConnectionMs: round(quantile(setupTimes, 0.9)),
		wallClockMs: round(wallClockMs),
	}
}

/**
 * Compare the Cloudflare path with a non-Cloudflare control download.
 * A low ratio means the edge is the bottleneck; a ratio near or above 1 means
 * the ceiling is the local uplink or the tunnel server, not this IP.
 */
export function summarizeControl({ edgeMbps, controlMbps } = {}) {
	const usable =
		typeof edgeMbps === 'number' && Number.isFinite(edgeMbps) &&
		typeof controlMbps === 'number' && Number.isFinite(controlMbps) && controlMbps > 0
	return {
		controlMbps: round(controlMbps),
		edgeMbps: round(edgeMbps),
		edgeShare: usable ? round(edgeMbps / controlMbps, 3) : null,
		bottleneck: usable ? (edgeMbps / controlMbps < 0.6 ? 'cloudflare-edge' : 'local-or-server') : null,
	}
}

/**
 * Flatten the stage results into the metric names used by the absolute gates.
 */
export function toGateMetrics({ downlink, latency, fanout, uplink } = {}) {
	return {
		sustainedMbps: downlink?.sustainedMbps ?? null,
		shapingRatio: downlink?.shapingRatio ?? null,
		rpm: latency?.rpm ?? null,
		rttIncreaseMs: latency?.rttIncreaseMs ?? null,
		rttInflation: latency?.rttInflation ?? null,
		jitterMs: latency?.jitterMs ?? null,
		lossRate: latency?.lossRate ?? null,
		fanoutSuccess: fanout?.fanoutSuccess ?? null,
		freshConnectionMs: fanout?.freshConnectionMs ?? null,
		uplinkMbps: uplink?.sustainedMbps ?? null,
	}
}

function downloadUrl(template, bytes) {
	return template.includes('{bytes}')
		? template.replace('{bytes}', String(bytes))
		: `${template}${template.includes('?') ? '&' : '?'}bytes=${bytes}`
}

async function measureIdleLatency({ client, url, samples }) {
	const values = []
	let failures = 0
	for (let index = 0; index < samples; index += 1) {
		const result = await client.request(url, { maxBytes: 64 * 1024 })
		if (result.ok && typeof result.ttfbMs === 'number') values.push(result.ttfbMs)
		else failures += 1
	}
	return { values, failures }
}

/**
 * Run the full real-load probe through an already-running tunnel.
 *
 * @param {object} options
 * @param {{host: string, port: number}|null} options.proxy local SOCKS proxy of the tunnel
 * @param {object} [options.endpoints] download/upload/ping/control URL templates
 * @param {number} [options.durationMs] saturating downlink budget
 * @param {number} [options.chunkBytes] bytes per timed window, per flow
 * @param {number} [options.flows] parallel download flows used to saturate
 * @param {number} [options.uploadBytes] total uplink payload
 * @param {number} [options.fanoutRequests] parallel browser-like requests
 * @param {boolean} [options.control] also measure a non-Cloudflare control download
 */
export async function runLoadProbe({
	proxy = null,
	endpoints = DEFAULT_LOAD_ENDPOINTS,
	durationMs = 20000,
	chunkBytes = 2 * 1024 * 1024,
	flows = 4,
	uploadBytes = 2 * 1024 * 1024,
	uploadFlows = 2,
	fanoutRequests = 8,
	idleSamples = 4,
	timeoutMs = 20000,
	control = false,
	controlBytes = 8 * 1024 * 1024,
} = {}) {
	const pingUrl = endpoints.ping || DEFAULT_LOAD_ENDPOINTS.ping
	const downTemplate = endpoints.download || DEFAULT_LOAD_ENDPOINTS.download
	const uploadUrl = endpoints.upload || DEFAULT_LOAD_ENDPOINTS.upload
	const controlUrl = endpoints.control || DEFAULT_LOAD_ENDPOINTS.control
	const flowCount = Math.max(1, Math.floor(flows))
	const uploadFlowCount = Math.max(1, Math.floor(uploadFlows))

	const pingClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
	// One client per flow, each with its own socket: this is what actually
	// creates parallel TCP connections instead of queueing on one.
	const bulkClients = Array.from({ length: flowCount }, () =>
		createHttpClient({ proxy, timeoutMs, maxSockets: 1 }),
	)
	const uploadClients = Array.from({ length: uploadFlowCount }, () =>
		createHttpClient({ proxy, timeoutMs, maxSockets: 1 }),
	)
	const fanoutClient = createHttpClient({ proxy, timeoutMs, maxSockets: fanoutRequests })

	try {
		// 1. Idle latency baseline.
		const idle = await measureIdleLatency({ client: pingClient, url: pingUrl, samples: idleSamples })

		// 2. Saturating parallel downlink with latency probes running concurrently.
		const loadedLatency = []
		let loadedFailures = 0
		let loadedAttempts = 0
		let probing = true
		const saturationStart = performance.now()
		const latencyLoop = (async () => {
			while (probing) {
				loadedAttempts += 1
				const result = await pingClient.request(pingUrl, { maxBytes: 64 * 1024 })
				if (result.ok && typeof result.ttfbMs === 'number') loadedLatency.push(result.ttfbMs)
				else loadedFailures += 1
				await new Promise((resolve) => setTimeout(resolve, 250))
			}
		})()

		const windows = []
		const deadline = saturationStart + durationMs
		await Promise.all(
			bulkClients.map(async (client, flowIndex) => {
				let consecutiveFailures = 0
				while (performance.now() < deadline && consecutiveFailures < 2) {
					const url = downloadUrl(downTemplate, chunkBytes)
					const result = await client.request(url, { maxBytes: chunkBytes * 2 })
					// Time the payload only, so connection setup is not charged to throughput.
					const payloadMs =
						typeof result.ttfbMs === 'number' && typeof result.totalMs === 'number'
							? Math.max(result.totalMs - result.ttfbMs, 1)
							: result.totalMs
					const ok = Boolean(result.ok) && result.bytes > 0
					consecutiveFailures = ok ? 0 : consecutiveFailures + 1
					windows.push({
						flow: flowIndex,
						bytes: result.bytes,
						ms: payloadMs,
						ok,
						offsetMs: round(performance.now() - saturationStart),
					})
				}
			}),
		)
		const saturationWall = performance.now() - saturationStart
		probing = false
		await latencyLoop

		// 3. Browser-like parallel fan-out on fresh connections.
		const fanoutStarted = performance.now()
		const fanoutResults = await Promise.all(
			Array.from({ length: fanoutRequests }, () =>
				fanoutClient.request(downloadUrl(downTemplate, 128 * 1024), {
					maxBytes: 512 * 1024,
					keepAlive: false,
				}),
			),
		)
		const fanoutWall = performance.now() - fanoutStarted

		// 4. Sustained uplink, also parallel: a single POST stream hits the same
		//    bandwidth-delay ceiling as a single download stream did.
		const uploadChunk = Math.min(Math.max(uploadBytes, 256 * 1024), 2 * 1024 * 1024)
		const payload = Buffer.alloc(uploadChunk, 0x61)
		const perFlowBudget = Math.max(uploadChunk, Math.ceil(uploadBytes / uploadFlowCount))
		const uploadWindows = []
		const uploadStart = performance.now()
		await Promise.all(
			uploadClients.map(async (client, flowIndex) => {
				let uploaded = 0
				while (uploaded < perFlowBudget) {
					const result = await client.request(uploadUrl, {
						method: 'POST',
						body: payload,
						maxBytes: 256 * 1024,
					})
					uploadWindows.push({
						flow: flowIndex,
						bytes: result.ok ? payload.length : 0,
						ms: result.totalMs,
						ok: Boolean(result.ok),
						offsetMs: round(performance.now() - uploadStart),
					})
					uploaded += payload.length
					if (!result.ok) break
				}
			}),
		)
		const uploadWall = performance.now() - uploadStart

		// 5. Optional control download outside Cloudflare.
		let controlSummary = null
		if (control) {
			const controlClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
			try {
				const result = await controlClient.request(controlUrl, { maxBytes: controlBytes })
				const payloadMs =
					typeof result.ttfbMs === 'number' && typeof result.totalMs === 'number'
						? Math.max(result.totalMs - result.ttfbMs, 1)
						: result.totalMs
				controlSummary = summarizeControl({
					edgeMbps: summarizeSaturation({ windows, wallClockMs: saturationWall, flows: flowCount })
						.sustainedMbps,
					controlMbps: result.ok ? toMbps(result.bytes, payloadMs) : null,
				})
			} finally {
				controlClient.close()
			}
		}

		const downlink = summarizeSaturation({ windows, wallClockMs: saturationWall, flows: flowCount })
		const latency = summarizeLatency({
			idle: idle.values,
			loaded: loadedLatency,
			attempts: idleSamples + loadedAttempts,
			failures: idle.failures + loadedFailures,
		})
		const fanout = summarizeFanout(fanoutResults, fanoutWall)
		const uplink = summarizeSaturation({
			windows: uploadWindows,
			wallClockMs: uploadWall,
			flows: uploadFlowCount,
		})

		return {
			ok: downlink.samples > 0,
			downlink,
			latency,
			fanout,
			uplink,
			control: controlSummary,
			gateMetrics: toGateMetrics({ downlink, latency, fanout, uplink }),
			budget: { durationMs, chunkBytes, flows: flowCount, uploadBytes, uploadFlows: uploadFlowCount, fanoutRequests },
		}
	} finally {
		pingClient.close()
		fanoutClient.close()
		for (const client of bulkClients) client.close()
		for (const client of uploadClients) client.close()
	}
}
