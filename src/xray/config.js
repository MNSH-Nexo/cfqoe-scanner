export function buildXrayConfig(runtime, candidateIp, socksPort) {
  if (!runtime?.id) throw new Error('VLESS runtime credential is required');
  if (!candidateIp) throw new Error('Candidate IP is required');
  const p = runtime.params || {};
  const network = runtime.transport;
  const security = runtime.security;
  const stream = { network, security };

  if (security === 'tls') {
    stream.tlsSettings = {
      serverName: runtime.sni,
      allowInsecure: ['1', 'true'].includes(String(p.allowInsecure || '').toLowerCase()),
      fingerprint: runtime.fingerprint || 'chrome',
    };
    if (p.alpn) stream.tlsSettings.alpn = p.alpn.split(',').map((item) => item.trim()).filter(Boolean);
  } else if (security === 'reality') {
    stream.realitySettings = {
      serverName: runtime.sni,
      fingerprint: runtime.fingerprint || 'chrome',
      publicKey: p.pbk || '',
      shortId: p.sid || '',
      spiderX: decodeURIComponent(p.spx || '/'),
    };
  } else if (security !== 'none') {
    throw new Error(`Unsupported VLESS security: ${security}`);
  }

  if (network === 'ws') {
    stream.wsSettings = {
      path: runtime.path,
      headers: { Host: runtime.host },
    };
  } else if (network === 'grpc') {
    stream.grpcSettings = {
      serviceName: decodeURIComponent(p.serviceName || ''),
      multiMode: p.mode === 'multi',
      authority: p.authority || undefined,
    };
  } else if (network === 'httpupgrade') {
    stream.httpupgradeSettings = { path: runtime.path, host: runtime.host };
  } else if (network === 'xhttp' || network === 'splithttp') {
    stream.xhttpSettings = {
      path: runtime.path,
      host: runtime.host,
      mode: p.mode || 'auto',
      extra: p.extra ? JSON.parse(decodeURIComponent(p.extra)) : undefined,
    };
  } else if (network !== 'tcp') {
    throw new Error(`Unsupported VLESS transport: ${network}`);
  }

  return {
    log: { loglevel: 'warning' },
    inbounds: [{
      tag: 'cfqoe-socks', listen: '127.0.0.1', port: socksPort,
      protocol: 'socks', settings: { auth: 'noauth', udp: false },
      sniffing: { enabled: true, destOverride: ['http', 'tls'] },
    }],
    outbounds: [{
      tag: 'candidate-vless', protocol: 'vless',
      settings: {
        vnext: [{
          address: candidateIp,
          port: runtime.port,
          users: [{ id: runtime.id, encryption: runtime.encryption || 'none', flow: runtime.flow || '' }],
        }],
      },
      streamSettings: stream,
    }],
  };
}
