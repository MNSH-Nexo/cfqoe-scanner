import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWindows, summarizeLatency, summarizeFanout, toGateMetrics, quantile, loadLatencyTimeout } from '../src/probe/load.js';
import { evaluateGates, capScore, buildVerdict, SCORE_CAPS } from '../src/measurement/gates.js';
import { summarizeLoad, scoreLoad, applyTunnelResults, rankCandidates } from '../src/report.js';
import { createDefaultSettings, migrateSettings, estimateTrafficBytes, SETTINGS_VERSION } from '../src/config/settings.js';
const MB = 1024 * 1024;

test('single-flow windows preserve transfer history',()=>{
  const windows=Array.from({length:6},()=>({bytes:2*MB,ms:1000,ok:true}));
  const result=summarizeWindows(windows); assert.equal(result.totalBytes,12*MB); assert.ok(result.sustainedMbps>16); assert.equal(result.shapingRatio,1);
});
test('latency reports inflation, jitter and loss',()=>{
  const result=summarizeLatency({idle:[40,42,44,46],loaded:[120,130,140,600],attempts:10,failures:2});
  assert.equal(result.idleRttMs,43); assert.equal(result.loadedRttMs,135); assert.ok(result.jitterMs>200); assert.equal(result.lossRate,.2);
});
test('quantile and fanout helpers are defensive',()=>{
  assert.equal(quantile([10,20],.5),15); assert.equal(quantile([],.5),null);
  const result=summarizeFanout([{ok:true,ttfbMs:300},{ok:true,ttfbMs:500},{ok:false}],1000); assert.equal(result.fanoutSuccess,.6667);
});
test('absolute gates fail a path that collapses under load',()=>{
  const result=evaluateGates(toGateMetrics({downlink:{sustainedMbps:18,shapingRatio:.2},latency:{rttIncreaseMs:810,rpm:66,rttInflation:6,jitterMs:300,lossRate:.15},fanout:{fanoutSuccess:.5,freshConnectionMs:2600},uplink:{sustainedMbps:.1}}));
  assert.equal(result.status,'fail'); assert.ok(result.failures.includes('shapingRatio')); assert.equal(capScore(96.4,result),SCORE_CAPS.fail); assert.equal(buildVerdict({gateResult:result,cappedScore:45}).label,'unusable');
});
test('healthy loaded path can pass',()=>{
  const result=evaluateGates({sustainedMbps:30,shapingRatio:.95,rpm:700,rttIncreaseMs:40,rttInflation:1.2,jitterMs:25,lossRate:0,fanoutSuccess:1,freshConnectionMs:350,uplinkMbps:4});
  assert.equal(result.status,'pass'); assert.equal(capScore(88.2,result),88.2);
});
test('primary limiter prefers the most severe failure instead of definition order',()=>{
  const result=evaluateGates({sustainedMbps:1.9,shapingRatio:1,rpm:700,rttIncreaseMs:40,rttInflation:1.2,jitterMs:500,lossRate:0,fanoutSuccess:1,freshConnectionMs:350,uplinkMbps:4});
  assert.equal(result.status,'fail'); assert.equal(result.limiting,'jitterMs');
});
test('load summary uses parallel throughput and RPM',()=>{
  const load=summarizeLoad([{ok:true,downlink:{sustainedMbps:24,perFlowMbps:4,shapingRatio:.88,totalBytes:12*MB,flows:6},latency:{rttIncreaseMs:40,rttInflation:1.3,rpm:300,jitterMs:30,lossRate:0},fanout:{fanoutSuccess:1,freshConnectionMs:420},uplink:{sustainedMbps:3,totalBytes:3*MB}}]);
  assert.equal(load.bytes,15*MB); assert.equal(load.flows,6); assert.ok(scoreLoad(load)>60);
});
function base(ip){return {ip,range:'x',eligibility:{attempts:8,successes:8,successRate:1,confidence95:{lower:.68,upper:1},confidence:'medium',handshakeMedianMs:120,pops:{dominant:'FRA'},errors:{}}};}
test('measured partial ranks above eligibility-only and keeps capped score',()=>{
  const measured=applyTunnelResults(base('94.156.10.199'),{
    browsing:[{score:82,bytes:2*MB}],streaming:[{score:null,error:'manifest_failed'}],
    load:[{ok:true,downlink:{sustainedMbps:37.84,shapingRatio:1.1,totalBytes:120*MB,flows:6},latency:{rttIncreaseMs:140,rttInflation:1.76,rpm:185,jitterMs:40,lossRate:0},fanout:{fanoutSuccess:1,freshConnectionMs:500},uplink:{sustainedMbps:null,totalBytes:0}}]
  },{browsing:true,streaming:true,load:true});
  const unmeasured=applyTunnelResults(base('8.34.146.168'),null,{browsing:true,streaming:true,load:true});
  assert.equal(measured.measurement.status,'partial'); assert.ok(Number.isFinite(measured.scores.overall)); assert.ok(measured.scores.overall<=70);
  assert.equal(unmeasured.measurement.status,'unmeasured'); assert.equal(rankCandidates([unmeasured,measured])[0].ip,'94.156.10.199');
});
test('old settings migrate to multi-megabyte load defaults',()=>{
  const migrated=migrateSettings({version:2,streaming:{maxSegments:10}},'linux'); assert.equal(migrated.version,SETTINGS_VERSION); assert.equal(migrated.load.enabled,true);
  assert.ok(estimateTrafficBytes(createDefaultSettings('linux'))>30*MB);
});

test('loaded-latency requests cannot extend a candidate by the full bulk timeout',()=>{
  assert.equal(loadLatencyTimeout(20000),3000);
  assert.equal(loadLatencyTimeout(1500),1500);
});
