import net from 'node:net';

// Minimal SOCKS5 CONNECT client used to route workloads through the local Xray inbound.
export function connectSocks5(proxy, target, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let stage = 'greeting';
    let settled = false;
    let buffer = Buffer.alloc(0);

    const timer = setTimeout(() => fail(new Error('socks_timeout')), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.removeListener('close', onClose);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function onClose() {
      fail(new Error('socks_closed'));
    }

    function succeed() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        if (buffer[0] !== 0x05 || buffer[1] !== 0x00) return fail(new Error('socks_auth_unsupported'));
        buffer = buffer.subarray(2);
        stage = 'connect';
        socket.write(buildConnectRequest(target));
      }

      if (stage === 'connect') {
        if (buffer.length < 4) return;
        if (buffer[0] !== 0x05) return fail(new Error('socks_bad_version'));
        if (buffer[1] !== 0x00) return fail(new Error(`socks_error_${buffer[1]}`));
        const addressType = buffer[3];
        let needed = 4 + 2;
        if (addressType === 0x01) needed += 4;
        else if (addressType === 0x04) needed += 16;
        else if (addressType === 0x03) {
          if (buffer.length < 5) return;
          needed += 1 + buffer[4];
        } else return fail(new Error('socks_bad_address'));
        if (buffer.length < needed) return;
        succeed();
      }
    }

    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
    socket.on('data', onData);
    socket.on('error', fail);
    socket.on('close', onClose);
  });
}

function buildConnectRequest(target) {
  const header = Buffer.from([0x05, 0x01, 0x00]);
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(target.port, 0);

  if (net.isIPv4(target.host)) {
    const octets = target.host.split('.').map(Number);
    return Buffer.concat([header, Buffer.from([0x01]), Buffer.from(octets), portBuffer]);
  }
  const hostBuffer = Buffer.from(target.host, 'utf8');
  if (hostBuffer.length > 255) throw new Error('socks_host_too_long');
  return Buffer.concat([
    header,
    Buffer.from([0x03, hostBuffer.length]),
    hostBuffer,
    portBuffer,
  ]);
}
