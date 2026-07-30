import { performance } from 'node:perf_hooks'
import { createHttpClient } from '../net/http.js'

const MIB = 1024 * 1024
export const DEFAULT_MAX_DOWNLOAD_BYTES = 24 * MIB
export const DEFAULT_LOAD_ENDPOINTS = {
	download: 'https://speed.cloudflare.com/__down',
	upload: 'https://speed.cloudflare.com/__up',
	ping: 'https://speed.cloudflare.com/__down?bytes=1000',
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

export function createByteBudget(limitBytes) {
	const limit = Math.max(0, Math.floor(Number(limitBytes) || 0))
	let reserved = 0
	return {
		reserve(wantedBytes) {
			const remaining = Math.max(0, limit - reserved)
			const granted = Math.min(remaining, Math.max(0, Math.floor(Number(wantedBytes) || 0)))
			reserved += granted
			return granted
		},
		get limitBytes() { return limit },
		get reservedBytes() { return reserved },
		get remainingBytes() { return Math.max(0, limit - reserved) },
	}
}

export function summarizeWindows(windows = []) {
	const usable = windows.filter((window) => window && window.ok && window.ms > 0 && window.bytes > 0)
	const empty = { samples: 0, sustainedMbps: null, peakMbps: null, earlyMbps: null, lateMbps: null, shapingRatio: null, totalBytes: 0, totalMs: 0, failures: windows.length - usable.length }
	if (usable.length === 0) return empty
	const totalBytes = usable.reduce((sum, window) => sum + window.bytes, 0)
	const totalMs = usable.reduce((sum, window) => sum + window.ms, 0)
	const rates = usable.map((window) => toMbps(window.bytes, window.ms))
	const edge = Math.max(1, Math.floor(usable.length / 3))
	const earlyMbps = quantile(rates.slice(0, edge), 0.5)
	const lateMbps = quantile(rates.slice(-edge), 0.5)
	const comparable = usable.length >= 3 && earlyMbps > 0
	return {
		samples: usable.length, sustainedMbps: round(toMbps(totalBytes, totalMs)), peakMbps: round(Math.max(...rates)),
		earlyMbps: round(earlyMbps), lateMbps: round(lateMbps),
		shapingRatio: comparable ? round(Math.min(lateMbps / earlyMbps, 2), 3) : null,
		totalBytes, totalMs: round(totalMs), failures: windows.length - usable.length,
	}
}

export function summarizeSaturation({ windows = [], wallClockMs = null, flows = 1 } = {}) {
	const usable = windows.filter((window) => window && window.ok && window.bytes > 0)
	const failures = windows.length - usable.length
	if (usable.length === 0 || !Number.isFinite(wallClockMs) || wallClockMs <= 0) {
		return { flows, samples: 0, failures, totalBytes: 0, wallClockMs: round(wallClockMs), sustainedMbps: null, peakMbps: null, earlyMbps: null, lateMbps: null, shapingRatio: null, perFlowMbps: null }
	}
	const totalBytes = usable.reduce((sum, window) => sum + window.bytes, 0)
	const perWindowMbps = usable.map((window) => toMbps(window.bytes, window.ms)).filter((value) => value !== null)
	const byFlow = new Map()
	for (const window of usable) {
		const key = Number.isFinite(window.flow) ? window.flow : 0
		if (!byFlow.has(key)) byFlow.set(key, [])
		byFlow.get(key).push(window)
	}
	let earlyMbps = null
	let lateMbps = null
	const comparableFlows = [...byFlow.values()].filter((items) => items.length >= 2)
	if (comparableFlows.length > 0) {
		earlyMbps = quantile(comparableFlows.map((items) => toMbps(items[0].bytes, items[0].ms)), 0.5)
		lateMbps = quantile(comparableFlows.map((items) => { const last = items.at(-1); return toMbps(last.bytes, last.ms) }), 0.5)
	}
	const comparable = typeof earlyMbps === 'number' && earlyMbps > 0 && typeof lateMbps === 'number'
	const sustainedMbps = toMbps(totalBytes, wallClockMs)
	return {
		flows, samples: usable.length, failures, totalBytes, wallClockMs: round(wallClockMs),
		sustainedMbps: round(sustainedMbps), peakMbps: perWindowMbps.length ? round(Math.max(...perWindowMbps)) : null,
		earlyMbps: round(earlyMbps), lateMbps: round(lateMbps),
		shapingRatio: comparable ? round(Math.min(lateMbps / earlyMbps, 2), 3) : null,
		perFlowMbps: round(sustainedMbps / Math.max(1, flows)),
	}
}

export function responsivenessRpm(loadedRttMs) {
	if (typeof loadedRttMs !== 'number' || !Number.isFinite(loadedRttMs) || loadedRttMs <= 0) return null
	return round(60000 / loadedRttMs)
}
export function summarizeLatency({ idle = [], loaded = [], attempts = 0, failures = 0 } = {}) {
	const idleRttMs = quantile(idle, 0.5)
	const loadedRttMs = quantile(loaded, 0.5)
	const loadedP95 = quantile(loaded, 0.95)
	const totalAttempts = attempts || idle.length + loaded.length + failures
	const hasBoth = typeof idleRttMs === 'number' && typeof loadedRttMs === 'number'
	return {
		idleRttMs: round(idleRttMs), loadedRttMs: round(loadedRttMs), loadedP95Ms: round(loadedP95),
		rttIncreaseMs: hasBoth ? round(Math.max(0, loadedRttMs - idleRttMs)) : null,
		rttInflation: hasBoth && idleRttMs > 0 ? round(Math.max(1, loadedRttMs / idleRttMs), 2) : null,
		rpm: responsivenessRpm(loadedRttMs), idleRpm: responsivenessRpm(idleRttMs),
		jitterMs: typeof loadedP95 === 'number' && typeof loadedRttMs === 'number' ? round(loadedP95 - loadedRttMs) : null,
		lossRate: totalAttempts > 0 ? round(failures / totalAttempts, 4) : null,
		samples: { idle: idle.length, loaded: loaded.length, attempts: totalAttempts, failures },
	}
}
export function summarizeFanout(results = [], wallClockMs = null) {
	if (results.length === 0) return { requests: 0, fanoutSuccess: null, freshConnectionMs: null, wallClockMs: null }
	const successes = results.filter((result) => result && result.ok)
	const setupTimes = successes.map((result) => typeof result.ttfbMs === 'number' ? result.ttfbMs : result.totalMs).filter(Number.isFinite)
	return { requests: results.length, fanoutSuccess: round(successes.length / results.length, 4), freshConnectionMs: round(quantile(setupTimes, 0.9)), wallClockMs: round(wallClockMs) }
}
export function summarizeControl({ edgeMbps, controlMbps } = {}) {
	const usable = typeof edgeMbps === 'number' && Number.isFinite(edgeMbps) && typeof controlMbps === 'number' && Number.isFinite(controlMbps) && controlMbps > 0
	return { controlMbps: round(controlMbps), edgeMbps: round(edgeMbps), edgeShare: usable ? round(edgeMbps / controlMbps, 3) : null, bottleneck: usable ? (edgeMbps / controlMbps < 0.6 ? 'cloudflare-edge' : 'local-or-server') : null }
}
export function toGateMetrics({ downlink, latency, fanout, uplink } = {}) {
	return {
		sustainedMbps: downlink?.sustainedMbps ?? null, shapingRatio: downlink?.shapingRatio ?? null,
		rpm: latency?.rpm ?? null, rttIncreaseMs: latency?.rttIncreaseMs ?? null, rttInflation: latency?.rttInflation ?? null,
		jitterMs: latency?.jitterMs ?? null, lossRate: latency?.lossRate ?? null,
		fanoutSuccess: fanout?.fanoutSuccess ?? null, freshConnectionMs: fanout?.freshConnectionMs ?? null,
		uplinkMbps: uplink?.sustainedMbps ?? null,
	}
}
function downloadUrl(template, bytes) {
	return template.includes('{bytes}') ? template.replace('{bytes}', String(bytes)) : `${template}${template.includes('?') ? '&' : '?'}bytes=${bytes}`
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

export async function runLoadProbe({
	proxy = null, endpoints = DEFAULT_LOAD_ENDPOINTS, durationMs = 12000,
	chunkBytes = 1 * MIB, maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
	flows = 4, uploadBytes = 2 * MIB, uploadFlows = 2, fanoutRequests = 6,
	idleSamples = 4, timeoutMs = 20000, control = false, controlBytes = 6 * MIB,
} = {}) {
	const pingUrl = endpoints.ping || DEFAULT_LOAD_ENDPOINTS.ping
	const downTemplate = endpoints.download || DEFAULT_LOAD_ENDPOINTS.download
	const uploadUrl = endpoints.upload || DEFAULT_LOAD_ENDPOINTS.upload
	const controlUrl = endpoints.control || DEFAULT_LOAD_ENDPOINTS.control
	const flowCount = Math.max(1, Math.floor(flows))
	const uploadFlowCount = Math.max(1, Math.floor(uploadFlows))
	const downloadBudget = createByteBudget(maxDownloadBytes)
	const pingClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
	const bulkClients = Array.from({ length: flowCount }, () => createHttpClient({ proxy, timeoutMs, maxSockets: 1 }))
	const uploadClients = Array.from({ length: uploadFlowCount }, () => createHttpClient({ proxy, timeoutMs, maxSockets: 1 }))
	const fanoutClient = createHttpClient({ proxy, timeoutMs, maxSockets: fanoutRequests })
	try {
		const idle = await measureIdleLatency({ client: pingClient, url: pingUrl, samples: idleSamples })
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
		await Promise.all(bulkClients.map(async (client, flowIndex) => {
			let consecutiveFailures = 0
			while (performance.now() < deadline && consecutiveFailures < 2) {
				const requestBytes = downloadBudget.reserve(chunkBytes)
				if (requestBytes <= 0) break
				const result = await client.request(downloadUrl(downTemplate, requestBytes), { maxBytes: requestBytes })
				const payloadMs = typeof result.ttfbMs === 'number' && typeof result.totalMs === 'number' ? Math.max(result.totalMs - result.ttfbMs, 1) : result.totalMs
				const ok = Boolean(result.ok) && result.bytes > 0
				consecutiveFailures = ok ? 0 : consecutiveFailures + 1
				windows.push({ flow: flowIndex, bytes: result.bytes, requestedBytes: requestBytes, ms: payloadMs, ok, offsetMs: round(performance.now() - saturationStart) })
			}
		}))
		const saturationWall = performance.now() - saturationStart
		probing = false
		await latencyLoop
		const fanoutStarted = performance.now()
		const fanoutResults = await Promise.all(Array.from({ length: fanoutRequests }, () => fanoutClient.request(downloadUrl(downTemplate, 128 * 1024), { maxBytes: 128 * 1024, keepAlive: false })))
		const fanoutWall = performance.now() - fanoutStarted
		const perFlowBudget = Math.max(1, Math.ceil(uploadBytes / uploadFlowCount))
		const uploadChunk = Math.min(perFlowBudget, 512 * 1024)
		const uploadWindows = []
		const uploadStart = performance.now()
		await Promise.all(uploadClients.map(async (client, flowIndex) => {
			let uploaded = 0
			while (uploaded < perFlowBudget) {
				const bytesThisRequest = Math.min(uploadChunk, perFlowBudget - uploaded)
				const payload = Buffer.alloc(bytesThisRequest, 0x61)
				const result = await client.request(uploadUrl, { method: 'POST', body: payload, maxBytes: 128 * 1024 })
				uploadWindows.push({ flow: flowIndex, bytes: result.ok ? bytesThisRequest : 0, ms: result.totalMs, ok: Boolean(result.ok), offsetMs: round(performance.now() - uploadStart) })
				uploaded += bytesThisRequest
				if (!result.ok) break
			}
		}))
		const uploadWall = performance.now() - uploadStart
		const downlink = summarizeSaturation({ windows, wallClockMs: saturationWall, flows: flowCount })
		let controlSummary = null
		if (control) {
			const controlClient = createHttpClient({ proxy, timeoutMs, maxSockets: 1 })
			try {
				const result = await controlClient.request(controlUrl, { maxBytes: controlBytes })
				const payloadMs = typeof result.ttfbMs === 'number' && typeof result.totalMs === 'number' ? Math.max(result.totalMs - result.ttfbMs, 1) : result.totalMs
				controlSummary = summarizeControl({ edgeMbps: downlink.sustainedMbps, controlMbps: result.ok ? toMbps(result.bytes, payloadMs) : null })
			} finally { controlClient.close() }
		}
		const latency = summarizeLatency({ idle: idle.values, loaded: loadedLatency, attempts: idleSamples + loadedAttempts, failures: idle.failures + loadedFailures })
		const fanout = summarizeFanout(fanoutResults, fanoutWall)
		const uplink = summarizeSaturation({ windows: uploadWindows, wallClockMs: uploadWall, flows: uploadFlowCount })
		return {
			ok: downlink.samples > 0, downlink, latency, fanout, uplink, control: controlSummary,
			gateMetrics: toGateMetrics({ downlink, latency, fanout, uplink }),
			budget: {
				durationMs, chunkBytes, flows: flowCount,
				maxDownloadBytes: downloadBudget.limitBytes, reservedDownloadBytes: downloadBudget.reservedBytes,
				uploadBytes, uploadFlows: uploadFlowCount, fanoutRequests,
			},
		}
	} finally {
		pingClient.close(); fanoutClient.close()
		for (const client of bulkClients) client.close()
		for (const client of uploadClients) client.close()
	}
}
