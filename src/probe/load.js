// Real-load probe.
//
// 0.6.0 measured short single-connection downlink bursts, which is exactly the
// part of the path that always looks good: the first megabyte, one socket, no
// competing traffic, no uplink. This module measures what actually decides
// whether pages open and video plays:
//
//   1. sustained downlink over tens of seconds and several megabytes,
//   2. how throughput decays over time (traffic shaping / policing),
//   3. round-trip latency, jitter and request loss WHILE the link is busy,
//   4. browser-like parallel fan-out with fresh connections,
//   5. sustained uplink.
//
// All pure summarisation helpers are exported separately so they can be tested
// offline without any network access.

import { performance } from 'node:perf_hooks'
import { createHttpClient } from '../net/http.js'

export const DEFAULT_LOAD_ENDPOINTS = {
	download: 'https://speed.cloudflare.com/__down',
	upload: 'https://speed.cloudflare.com/__up',
	ping: 'https://speed.cloudflare.com/__down?bytes=1000',
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
 * Summarise a sequence of timed transfer windows.
 * Windows are chronological; each is { bytes, ms, ok }.
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
 * Summarise latency samples taken while idle and while the link is loaded.
 */
export function summarizeLatency({ idle = [], loaded = [], attempts = 0, failures = 0 } = {}) {
	const idleRttMs = quantile(idle, 0.5)
	const loadedRttMs = quantile(loaded, 0.5)
	const loadedP95 = quantile(loaded, 0.95)
	const totalAttempts = attempts || idle.length + loaded.length + failures
	return {
		idleRttMs: round(idleRttMs),
		loadedRttMs: round(loadedRttMs),
		loadedP95Ms: round(loadedP95),
		rttInflation:
			typeof idleRttMs === 'number' && idleRttMs > 0 && typeof loadedRttMs === 'number'
				? round(loadedRttMs / idleRttMs, 2)
				: null,
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
 * Flatten the stage results into the metric names used by the absolute gates.
 */
export function toGateMetrics({ downlink, latency, fanout, uplink } = {}) {
	return {
		sustainedMbps: downlink?.sustainedMbps ?? null,
		shapingRatio: downlink?.shapingRatio ?? null,
		loadedRttMs: latency?.loadedRttMs ?? null,
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

async function measureIdleLatency({ client, url, samples, timeoutMs }) {
	const values = []
	let failures = 0
	for (let index = 0; index < samples; index += 1) {
		const result = await client.request(url, { maxBytes: 64 * 1024, timeoutMs })
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
 * @param {object} [options.endpoints] download/upload/ping URL templates
 * @param {number} [options.durationMs] sustained downlink budget
 * @param {number} [options.chunkBytes] bytes per timed window
 * @param {number} [options.uploadBytes] total uplink payload
 * @param {number} [options.fanoutRequests] parallel browser-like requests
 */
export async function runLoadProbe({
	proxy = null,
	endpoints = DEFAULT_LOAD_ENDPOINTS,
	durationMs = 20000,
	chunkBytes = 2 * 1024 * 1024,
	uploadBytes = 2 * 1024 * 1024,
	fanoutRequests = 8,
	idleSamples = 4,
	timeoutMs = 20000,
} = {}) {
	const pingUrl = endpoints.ping || DEFAULT_LOAD_ENDPOINTS.ping
	const downTemplate = endpoints.download || DEFAULT_LOAD_ENDPOINTS.download
	const uploadUrl = endpoints.upload || DEFAULT_LOAD_ENDPOINTS.upload

	const pingClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
	const bulkClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
	const fanoutClient = createHttpClient({ proxy, timeoutMs, maxSockets: fanoutRequests })

	try {
		// 1. Idle latency baseline.
		const idle = await measureIdleLatency({
			client: pingClient,
			url: pingUrl,
			samples: idleSamples,
			timeoutMs,
		})

		// 2. Sustained downlink with latency probes running concurrently.
		const loadedLatency = []
		let loadedFailures = 0
		let loadedAttempts = 0
		let probing = true
		const latencyLoop = (async () => {
			while (probing) {
				loadedAttempts += 1
				const result = await pingClient.request(pingUrl, { maxBytes: 64 * 1024, timeoutMs })
				if (result.ok && typeof result.ttfbMs === 'number') loadedLatency.push(result.ttfbMs)
				else loadedFailures += 1
				await new Promise((resolve) => setTimeout(resolve, 250))
			}
		})()

		const windows = []
		const startedAt = performance.now()
		while (performance.now() - startedAt < durationMs) {
			const url = downloadUrl(downTemplate, chunkBytes)
			const result = await bulkClient.request(url, { maxBytes: chunkBytes * 2, timeoutMs })
			// Time the payload only, so connection setup is not charged to throughput.
			const payloadMs =
				typeof result.ttfbMs === 'number' && typeof result.totalMs === 'number'
					? Math.max(result.totalMs - result.ttfbMs, 1)
					: result.totalMs
			windows.push({ bytes: result.bytes, ms: payloadMs, ok: Boolean(result.ok) && result.bytes > 0 })
			if (!result.ok && windows.filter((window) => !window.ok).length >= 3) break
		}
		probing = false
		await latencyLoop

		// 3. Browser-like parallel fan-out on fresh connections.
		const fanoutStarted = performance.now()
		const fanoutResults = await Promise.all(
			Array.from({ length: fanoutRequests }, () =>
				fanoutClient.request(downloadUrl(downTemplate, 128 * 1024), {
					maxBytes: 512 * 1024,
					keepAlive: false,
					timeoutMs,
				}),
			),
		)
		const fanoutWall = performance.now() - fanoutStarted

		// 4. Sustained uplink.
		const uploadWindows = []
		const uploadChunk = Math.min(uploadBytes, 1024 * 1024)
		const payload = Buffer.alloc(uploadChunk, 0x61)
		let uploaded = 0
		while (uploaded < uploadBytes) {
			const result = await bulkClient.request(uploadUrl, {
				method: 'POST',
				body: payload,
				maxBytes: 256 * 1024,
				timeoutMs,
			})
			uploadWindows.push({
				bytes: result.ok ? payload.length : 0,
				ms: result.totalMs,
				ok: Boolean(result.ok),
			})
			uploaded += payload.length
			if (!result.ok) break
		}

		const downlink = summarizeWindows(windows)
		const latency = summarizeLatency({
			idle: idle.values,
			loaded: loadedLatency,
			attempts: idleSamples + loadedAttempts,
			failures: idle.failures + loadedFailures,
		})
		const fanout = summarizeFanout(fanoutResults, fanoutWall)
		const uplink = summarizeWindows(uploadWindows)

		return {
			ok: downlink.samples > 0,
			downlink,
			latency,
			fanout,
			uplink,
			gateMetrics: toGateMetrics({ downlink, latency, fanout, uplink }),
			budget: { durationMs, chunkBytes, uploadBytes, fanoutRequests },
		}
	} finally {
		pingClient.close()
		bulkClient.close()
		fanoutClient.close()
	}
}
