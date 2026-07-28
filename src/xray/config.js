// Builds a temporary Xray config that dials a specific candidate edge IP
// while preserving the WebSocket metadata of the user configuration.
export function buildXrayConfig({ vless, candidateIp, socksPort, logLevel = 'warning' }) {
  if (!candidateIp) throw new Error('candidateIp is required');
  if (!Number.isInteger(socksPort)) throw new Error('socksPort must be an integer');

  const streamSettings = {
    network: vless.transport === 'ws' ? 'ws' : vless.transport,
    security: vless.security === 'tls' ? 'tls' : 'none',
  };

  if (streamSettings.network === 'ws') {
    streamSettings.wsSettings = {
      path: vless.path,
      headers: { Host: vless.host },
    };
  }

  if (streamSettings.security === 'tls') {
    streamSettings.tlsSettings = {
      serverName: vless.sni || vless.host,
      allowInsecure: Boolean(vless.allowInsecure),
      ...(vless.fingerprint ? { fingerprint: vless.fingerprint } : {}),
    };
  }

  return {
    log: { loglevel: logLevel },
    inbounds: [
      {
        tag: 'cfqoe-socks',
        listen: '127.0.0.1',
        port: socksPort,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: false },
      },
    ],
    outbounds: [
      {
        tag: 'cfqoe-vless',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: candidateIp,
              port: vless.port,
              users: [
                {
                  id: vless.id,
                  encryption: vless.encryption || 'none',
                  ...(vless.flow ? { flow: vless.flow } : {}),
                },
              ],
            },
          ],
        },
        streamSettings,
      },
    ],
  };
}

// Non-sensitive view for reports and logs.
export function describeXrayConfig(config) {
  const outbound = config.outbounds[0];
  return {
    candidateIp: outbound.settings.vnext[0].address,
    port: outbound.settings.vnext[0].port,
    network: outbound.streamSettings.network,
    security: outbound.streamSettings.security,
    socksPort: config.inbounds[0].port,
  };
}
