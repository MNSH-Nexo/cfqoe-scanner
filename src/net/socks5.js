import net from 'node:net';

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('end', () => this.rejectAll(new Error('SOCKS proxy closed the connection')));
  }

  read(length) {
    if (this.buffer.length >= length) {
      const value = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      return Promise.resolve(value);
    }
    return new Promise((resolve, reject) => this.waiters.push({ length, resolve, reject }));
  }

  flush() {
    while (this.waiters.length && this.buffer.length >= this.waiters[0].length) {
      const waiter = this.waiters.shift();
      const value = this.buffer.subarray(0, waiter.length);
      this.buffer = this.buffer.subarray(waiter.length);
      waiter.resolve(value);
    }
  }

  rejectAll(error) {
    while (this.waiters.length) this.waiters.shift().reject(error);
  }
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('SOCKS proxy connect timeout')), timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function addressBuffer(host) {
  const family = net.isIP(host);
  if (family === 4) return Buffer.from([0x01, ...host.split('.').map(Number)]);
  if (family === 6) throw new Error('SOCKS IPv6 targets are not implemented yet');
  const encoded = Buffer.from(host, 'utf8');
  if (!encoded.length || encoded.length > 255) throw new Error('Invalid SOCKS target hostname');
  return Buffer.concat([Buffer.from([0x03, encoded.length]), encoded]);
}

export async function connectSocks5(proxy, target, timeoutMs = 8000) {
  const socket = await connectTcp(proxy.host || '127.0.0.1', proxy.port, timeoutMs);
  const reader = new SocketReader(socket);
  const timer = setTimeout(() => socket.destroy(new Error('SOCKS handshake timeout')), timeoutMs);
  try {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) throw new Error('SOCKS proxy rejected no-authentication mode');

    const port = Number(target.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SOCKS target port');
    const request = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      addressBuffer(target.host),
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]);
    socket.write(request);
    const response = await reader.read(4);
    if (response[0] !== 0x05 || response[1] !== 0x00) throw new Error(`SOCKS connect failed with code ${response[1]}`);
    if (response[3] === 0x01) await reader.read(4);
    else if (response[3] === 0x03) await reader.read((await reader.read(1))[0]);
    else if (response[3] === 0x04) await reader.read(16);
    else throw new Error('SOCKS proxy returned an unknown address type');
    await reader.read(2);
    clearTimeout(timer);
    socket.removeAllListeners('data');
    if (reader.buffer.length) socket.unshift(reader.buffer);
    return socket;
  } catch (error) {
    clearTimeout(timer);
    socket.destroy();
    throw error;
  }
}
