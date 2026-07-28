function required(value, label) {
  if (!value) throw new Error(`${label} is missing from the VLESS URI`);
  return value;
}

function parseCore(raw) {
  const uri = String(raw ?? '').trim();
  if (!uri.startsWith('vless://')) throw new Error('Only vless:// URIs are supported');
  let parsed;
  try { parsed = new URL(uri); }
  catch { throw new Error('The VLESS URI is malformed'); }

  const port = Number(parsed.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The VLESS port must be between 1 and 65535');
  }
  const params = Object.fromEntries(parsed.searchParams.entries());
  const security = (params.security || 'none').toLowerCase();
  const transport = (params.type || params.net || 'tcp').toLowerCase();
  const host = params.host || parsed.hostname;
  const resourcePath = decodeURIComponent(params.path || '/');
  return {
    uri,
    id: decodeURIComponent(parsed.username || ''),
    host: required(host, 'Host'),
    address: required(parsed.hostname, 'Address'),
    port,
    security,
    transport,
    path: resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`,
    sni: params.sni || params.peer || host,
    fingerprint: params.fp || 'chrome',
    name: decodeURIComponent(parsed.hash.slice(1) || parsed.hostname),
    encryption: params.encryption || 'none',
    flow: params.flow || '',
    params,
  };
}

export function parseVlessUri(raw) {
  const parsed = parseCore(raw);
  return {
    host: parsed.host,
    address: parsed.address,
    port: parsed.port,
    security: parsed.security,
    transport: parsed.transport,
    path: parsed.path,
    sni: parsed.sni,
    fingerprint: parsed.fingerprint,
    name: parsed.name,
    credentialPresent: Boolean(parsed.id),
  };
}

export function parseVlessRuntime(raw) {
  const parsed = parseCore(raw);
  if (!parsed.id) throw new Error('VLESS credential/UUID is missing');
  return parsed;
}

export function toProbeTarget(config) {
  if (!config || typeof config !== 'object') throw new Error('Target configuration is missing');
  const port = Number(config.port || (config.security === 'none' ? 80 : 443));
  if (!config.host) throw new Error('Target host is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid target port');
  return {
    host: String(config.host),
    port,
    security: String(config.security || 'none').toLowerCase(),
    transport: String(config.transport || 'ws').toLowerCase(),
    path: String(config.path || '/').startsWith('/') ? String(config.path || '/') : `/${config.path}`,
    sni: String(config.sni || config.host),
  };
}

export function redactTarget(target) {
  return {
    host: target.host,
    port: target.port,
    security: target.security,
    transport: target.transport,
    path: target.path,
    sni: target.sni,
  };
}
