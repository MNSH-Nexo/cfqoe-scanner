import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSaturation, summarizeWindows, summarizeLatency, summarizeControl, responsivenessRpm, toGateMetrics } from '../src/probe/load.js';
import { evaluateGates, resolveGateOverrides, GATE_PROFILES } from '../src/measurement/gates.js';
import { qualityLabel, ladderCeilingMbps } from '../src/streaming/probe.js';
import { summarizeLoad, scoreLoad, limitingFactor } from '../src/report.js';
const MB = 1024 * 1024;

test('parallel flows aggregate over wall clock', () => {
  const windows=[]; for(let flow=0;flow<4;flow++){windows.push({flow,bytes:2*MB,ms:4000,ok:true});windows.push({flow,bytes:2*MB,ms:4000,ok:true});}
  const result=summarizeSaturation({windows,wallClockMs:8000,flows:4});
  assert.ok(result.sustainedMbps>16&&result.sustainedMbps<17.5); assert.ok(summarizeWindows(windows).sustainedMbps<result.sustainedMbps/3);
});
test('shaping compares first and last window of each flow', () => {
  const windows=[{flow:0,bytes:3*MB,ms:2000,ok:true},{flow:1,bytes:3*MB,ms:2000,ok:true},{flow:0,bytes:1*MB,ms:3000,ok:true},{flow:1,bytes:.5*MB,ms:3000,ok:true}];
  const result=summarizeSaturation({windows,wallClockMs:9000,flows:2}); assert.ok(result.earlyMbps>result.lateMbps); assert.ok(result.shapingRatio<.4);
});
test('empty saturation remains unknown',()=>{const r=summarizeSaturation({windows:[{bytes:0,ms:100,ok:false}],wallClockMs:5000,flows:4});assert.equal(r.sustainedMbps,null);assert.equal(r.shapingRatio,null);});
test('responsiveness is RPM',()=>{assert.equal(responsivenessRpm(200),300);assert.equal(responsivenessRpm(0),null);});
test('latency uses added delay and clamps warm-up noise',()=>{
  const healthy=summarizeLatency({idle:[200,205,210,215],loaded:[220,230,240,260],attempts:12}); assert.equal(healthy.rttIncreaseMs,27.5);
  const noisy=summarizeLatency({idle:[470,480],loaded:[310,320],attempts:4}); assert.equal(noisy.rttIncreaseMs,0); assert.equal(noisy.rttInflation,1);
});
test('healthy long-haul tunnel is not failed for distance',()=>{
  const metrics=toGateMetrics({downlink:{sustainedMbps:24,shapingRatio:.92},latency:{rttIncreaseMs:25,rttInflation:1.13,rpm:279,jitterMs:35,lossRate:0},fanout:{fanoutSuccess:1,freshConnectionMs:620},uplink:{sustainedMbps:6}});
  assert.notEqual(evaluateGates(metrics,{profile:'balanced'}).status,'fail'); assert.equal(evaluateGates(metrics,{profile:'strict'}).status,'warn');
});
test('gate profiles merge explicit overrides',()=>{const o=resolveGateOverrides('tolerant',{sustainedMbps:{fail:.5}});assert.equal(o.sustainedMbps.fail,.5);assert.equal(o.rpm.fail,GATE_PROFILES.tolerant.rpm.fail);});
test('limiting gate is explained',()=>{const r=evaluateGates({sustainedMbps:1.2,shapingRatio:.9,rpm:250,rttIncreaseMs:40,rttInflation:1.2,jitterMs:30,lossRate:0,fanoutSuccess:1,freshConnectionMs:500,uplinkMbps:2});assert.equal(r.limiting,'sustainedMbps');assert.match(limitingFactor(r),/1.2 Mbps/);});
test('quality claim is capped by reference ladder',()=>{assert.equal(qualityLabel(20,6),'1080p');assert.equal(qualityLabel(20,25),'4K');assert.equal(ladderCeilingMbps([{bandwidth:9500000}]),9.5);});
test('load score uses responsiveness',()=>{const l=summarizeLoad([{ok:true,downlink:{sustainedMbps:26,perFlowMbps:4.3,shapingRatio:.96,totalBytes:40*MB,flows:6},latency:{rttIncreaseMs:20,rttInflation:1.1,rpm:285,jitterMs:25,lossRate:0},fanout:{fanoutSuccess:1,freshConnectionMs:480},uplink:{sustainedMbps:7,totalBytes:6*MB}}]);assert.ok(scoreLoad(l)>60);});
test('control identifies edge bottleneck',()=>{assert.equal(summarizeControl({edgeMbps:3,controlMbps:30}).bottleneck,'cloudflare-edge');});
