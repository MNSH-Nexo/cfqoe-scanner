const NON_RETRYABLE = [
  /^invalid_candidate_ip$/,
  /^unexpected_status_(400|401|403|404|405|426)$/,
  /CERT_|certificate|tls.*(version|protocol)/i,
];
const RETRYABLE = [
  /timeout/i,
  /reset|ECONNRESET/i,
  /closed_before_upgrade/i,
  /EPIPE|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/i,
  /^unexpected_status_(429|500|502|503|504)$/,
];
const SYSTEMIC = [/ENOTFOUND|EAI_AGAIN/i, /invalid.*config|missing.*credentials/i];

export function classifyProbeError(error) {
  if (!error) return { class: 'success', retryable: false, code: null };
  const code = String(error);
  if (SYSTEMIC.some((pattern) => pattern.test(code))) return { class: 'systemic', retryable: false, code };
  if (NON_RETRYABLE.some((pattern) => pattern.test(code))) return { class: 'non_retryable', retryable: false, code };
  if (RETRYABLE.some((pattern) => pattern.test(code))) return { class: 'retryable', retryable: true, code };
  return { class: 'unknown', retryable: true, code };
}

export function summarizeProbeErrors(observations) {
  const counts = { success: 0, retryable: 0, non_retryable: 0, systemic: 0, unknown: 0 };
  for (const item of observations || []) counts[classifyProbeError(item.ok ? null : item.error).class] += 1;
  return counts;
}
