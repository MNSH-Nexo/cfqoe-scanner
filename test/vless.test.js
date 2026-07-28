import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVlessUri, toProbeTarget } from '../src/config/vless.js';

test('VLESS parsing exposes only probe metadata', () => {
  const parsed = parseVlessUri('vless://00000000-0000-0000-0000-000000000000@edge.example.com:2052?encryption=none&security=none&type=ws&host=edge.example.com&path=%2Fvideo.mp4#Demo');
  assert.equal(parsed.host, 'edge.example.com');
  assert.equal(parsed.port, 2052);
  assert.equal(parsed.path, '/video.mp4');
  assert.equal(parsed.credentialPresent, true);
  const target = toProbeTarget(parsed);
  assert.equal('uuid' in target, false);
});

test('invalid ports are rejected clearly', () => {
  assert.throws(() => parseVlessUri('vless://id@host:99999?type=ws'), /malformed|port/i);
});
