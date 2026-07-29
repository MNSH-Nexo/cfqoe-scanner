import test from 'node:test';
import assert from 'node:assert/strict';
import { xrayAssetName } from '../src/platform/xray-release.js';

test('selects official Android Xray archives', () => {
  assert.equal(xrayAssetName('android', 'arm64'), 'Xray-android-arm64-v8a.zip');
  assert.equal(xrayAssetName('android', 'x64'), 'Xray-android-amd64.zip');
});

test('keeps desktop Xray selection intact', () => {
  assert.equal(xrayAssetName('linux', 'arm64'), 'Xray-linux-arm64-v8a.zip');
  assert.equal(xrayAssetName('win32', 'x64'), 'Xray-windows-64.zip');
});

test('rejects unsupported Xray targets clearly', () => {
  assert.throws(() => xrayAssetName('darwin', 'arm64'), /Unsupported platform/);
  assert.throws(() => xrayAssetName('android', 'arm'), /Unsupported architecture/);
});
