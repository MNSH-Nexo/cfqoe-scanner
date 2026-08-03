// Runtime-only VLESS parser. The full URI and UUID never leave memory.

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Android share sheets, messaging apps and some terminal emulators may wrap a
// copied URI in bidi/zero-width marks, Markdown quotes, or bracketed-paste
// control sequences. Normalise only transport artefacts; URI payload bytes are
// otherwise left untouched.
export function normalizeVlessInput(value) {
  let text = String(value ?? '')
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\r?\n/g, '')
    .trim();

  const wrappers = new Map([
    ['`', '`'], ['"', '"'], ["'", "'"],
    ['“', '”'], ['‘', '’'], ['«', '»'],
  ]);
  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;
    const closing = wrappers.get(text[0]);
    if (closing && text.endsWith(closing)) {
      text = text.slice(1, -1).trim();
      changed = true;
    }
  }
  return text;
}

export function parseVlessUri(uri) {
  const text = normalizeVlessInput(uri);
  if (!text.toLowerCase().startsWith('vless://')) {
    throw new Error('Configuration must start with vless://');
  }

  const withoutScheme = text.slice('vless://'.length);
  const hashIndex = withoutScheme.indexOf('#');
  const label = hashIndex === -1 ? '' : decode(withoutScheme.slice(hashIndex + 1));
  const body = hashIndex === -1 ? withoutScheme : withoutScheme.slice(0, hashIndex);

  const atIndex = body.lastIndexOf('@');
  if (atIndex === -1) throw new Error('VLESS configuration is missing credentials');

  const uuid = decode(body.slice(0, atIndex)).trim();
  if (!/^[0-9a-fA-F-]{8,}$/.test(uuid)) throw new Error('VLESS configuration has an invalid id');

  const rest = body.slice(atIndex + 1);
  const questionIndex = rest.indexOf('?');
  const authority = questionIndex === -1 ? rest : rest.slice(0, questionIndex);
  const queryText = questionIndex === -1 ? '' : rest.slice(questionIndex + 1);

  const colonIndex = authority.lastIndexOf(':');
  if (colonIndex === -1) throw new Error('VLESS configuration is missing a port');
  const address = authority.slice(0, colonIndex).replace(/^\[|\]$/g, '');
  const port = Number(authority.slice(colonIndex + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VLESS port is invalid: ${authority.slice(colonIndex + 1)}`);
  }

  const params = new URLSearchParams(queryText);
  const transport = (params.get('type') || 'tcp').toLowerCase();
  const security = (params.get('security') || 'none').toLowerCase();
  const host = decode(params.get('host') || address);
  const sni = decode(params.get('sni') || (security === 'tls' ? host : ''));
  const path = decode(params.get('path') || '/');

  return {
    id: uuid,
    address,
    port,
    host,
    sni: sni || host,
    path: path.startsWith('/') ? path : `/${path}`,
    transport,
    security,
    encryption: params.get('encryption') || 'none',
    flow: params.get('flow') || '',
    fingerprint: params.get('fp') || '',
    allowInsecure: params.get('allowInsecure') === '1',
    label,
  };
}

export function describeVless(config) {
  return {
    address: config.address,
    port: config.port,
    host: config.host,
    sni: config.sni,
    path: config.path,
    transport: config.transport,
    security: config.security,
    label: config.label || null,
    idPresent: Boolean(config.id),
  };
}

export function assertWebsocketCapable(config) {
  if (config.transport !== 'ws') {
    throw new Error(`Only WebSocket transport is supported for scanning, found: ${config.transport}`);
  }
  return true;
}
