import test from 'node:test';import assert from 'node:assert/strict';import{parseVlessUri,describeVless,assertWebsocketCapable,normalizeVlessInput}from'../src/config/vless.js';
const SAMPLE='vless://11111111-2222-3333-4444-555555555555@edge.example.com:2052?encryption=none&security=none&type=ws&host=edge.example.com&path=%2Fws#My%20Node';
test('parses a websocket configuration',()=>{const p=parseVlessUri(SAMPLE);assert.equal(p.address,'edge.example.com');assert.equal(p.port,2052);assert.equal(p.transport,'ws');assert.equal(p.path,'/ws');});
test('normalizes a path that misses the leading slash',()=>assert.equal(parseVlessUri(SAMPLE.replace('%2Fws','ws')).path,'/ws'));
test('tls configurations default sni to host',()=>assert.equal(parseVlessUri('vless://11111111-2222-3333-4444-555555555555@a.example.com:443?type=ws&security=tls&host=b.example.com&path=/x').sni,'b.example.com'));
test('rejects malformed input',()=>{assert.throws(()=>parseVlessUri('http://example.com'),/vless/);assert.throws(()=>parseVlessUri('vless://example.com:2052'),/credentials/);});
test('describeVless never exposes the id',()=>assert.equal(JSON.stringify(describeVless(parseVlessUri(SAMPLE))).includes('11111111'),false));
test('assertWebsocketCapable rejects other transports',()=>{assert.throws(()=>assertWebsocketCapable(parseVlessUri('vless://11111111-2222-3333-4444-555555555555@a.example.com:80?type=tcp')),/WebSocket/);});
test('normalizes Android clipboard and terminal paste artefacts',()=>{for(const input of[`\u200f${SAMPLE}`,`\u001b[200~${SAMPLE}\u001b[201~`,`\`${SAMPLE}\``,`“${SAMPLE}”`,`${SAMPLE}\r\n`]){assert.equal(normalizeVlessInput(input),SAMPLE);assert.equal(parseVlessUri(input).transport,'ws');}});
