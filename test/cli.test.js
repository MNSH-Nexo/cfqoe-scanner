import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, applyOptions } from '../src/cli.js';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { quickProfile } from '../src/menu/index.js';

test('parseArgs separates flags, values and positionals', () => { const options=parseArgs(['--max','30','--no-tunnel','extra','--debug']); assert.equal(options.values.get('max'),'30'); assert.ok(options.flags.has('no-tunnel')); assert.ok(options.flags.has('debug')); assert.deepEqual(options.positional,['extra']); });
test('parseArgs rejects options with a missing value', () => { assert.throws(()=>parseArgs(['--max']),/Missing value/); assert.throws(()=>parseArgs(['--rounds','--debug']),/Missing value/); });
test('applyOptions overrides settings without mutating the source', () => { const originalMax=DEFAULT_SETTINGS.scan.maxCandidates; const next=applyOptions(DEFAULT_SETTINGS,parseArgs(['--max','5','--tunnel-limit','2','--no-streaming'])); assert.equal(next.scan.maxCandidates,5); assert.equal(next.tunnel.limit,2); assert.equal(next.streaming.enabled,false); assert.equal(DEFAULT_SETTINGS.scan.maxCandidates,originalMax); assert.equal(DEFAULT_SETTINGS.streaming.enabled,true); });
test('applyOptions validates numeric input', () => { assert.throws(()=>applyOptions(DEFAULT_SETTINGS,parseArgs(['--max','abc'])),/positive number/); assert.throws(()=>applyOptions(DEFAULT_SETTINGS,parseArgs(['--rounds','-2'])),/positive number/); });
test('debug flag and explicit xray path are honoured', () => { const next=applyOptions(DEFAULT_SETTINGS,parseArgs(['--debug','--xray-path','/tmp/xray'])); assert.equal(next.logging.level,'debug'); assert.equal(next.tunnel.xrayPath,'/tmp/xray'); });
test('lowest-variant flag is explicit and the abr alias remains compatible', () => { assert.equal(applyOptions(DEFAULT_SETTINGS,parseArgs(['--lowest-variant'])).streaming.variantMode,'lowest'); assert.equal(applyOptions(DEFAULT_SETTINGS,parseArgs(['--abr'])).streaming.variantMode,'lowest'); });
test('quickProfile reduces the workload for a fast run', () => { const quick=quickProfile(DEFAULT_SETTINGS); assert.ok(quick.scan.maxCandidates<DEFAULT_SETTINGS.scan.maxCandidates); assert.ok(quick.tunnel.limit<DEFAULT_SETTINGS.tunnel.limit); assert.equal(quick.tunnel.rounds,1); });
