import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTunnelResults, buildCandidateSummary, buildEligibilitySummary, countLimitingFactors, rankCandidates, writeReport, renderTopList, REPORT_SCHEMA } from '../src/report.js';
function candidate(ip, { browsingScore, streamingScore, ok = true }) { return buildCandidateSummary({ ip, range: 'x', eligibility: [{ ok, handshakeMs: 120, connectMs: 40, cfRay: 'x-FRA' }, { ok, handshakeMs: 130, connectMs: 45, cfRay: 'y-FRA' }], tunnel: { browsing: [{ score: browsingScore, bytes: 1000 }], streaming: [{ score: streamingScore, sustainableMbps: 8, quality: '1080p', bytes: 5000 }] } }); }
test('candidate summary aggregates stages',()=>{const s=candidate('1.1.1.1',{browsingScore:80,streamingScore:90});assert.equal(s.measurement.status,'complete');assert.ok(s.scores.overall>80);});
test('eligibility-only is unmeasured without manufactured load gates',()=>{const s=buildCandidateSummary({ip:'2.2.2.2',range:'x',eligibility:[{ok:true}],tunnel:null,requirements:{browsing:true,streaming:true,load:true}});assert.equal(s.measurement.status,'unmeasured');assert.equal(s.scores.overall,null);assert.equal(s.gates,null);assert.equal(s.limitingFactor,null);assert.equal(s.measurement.qoeConfidence,'none');assert.equal(s.verdict.label,'unverified');assert.equal(s.verdict.limiting,null);});
test('complete ranks above unmeasured',()=>{const ranked=rankCandidates([buildCandidateSummary({ip:'3.3.3.3',range:'x',eligibility:[{ok:true}],tunnel:null}),candidate('1.1.1.1',{browsingScore:50,streamingScore:50})]);assert.equal(ranked[0].ip,'1.1.1.1');});
test('report identifies v0.8.6 and schema 10',()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cfqoe-'));const written=writeReport({directory,runId:'test',target:{},settings:{},candidates:[candidate('1.1.1.1',{browsingScore:70,streamingScore:60})],startedAt:new Date().toISOString()});const parsed=JSON.parse(fs.readFileSync(written.jsonPath));assert.equal(parsed.schema,REPORT_SCHEMA);assert.equal(parsed.schema,10);assert.equal(parsed.version,'0.8.6');});
test('top list exposes capped, raw and separate confidence evidence',()=>{const rendered=renderTopList([candidate('1.1.1.1',{browsingScore:50,streamingScore:50})]);for(const label of ['RawConservative','RawOverall','EligibilityConfidence','QoEConfidence'])assert.ok(rendered.includes(label));});
test('raw conservative score breaks capped ties before throughput',()=>{
  const common={measurement:{status:'complete',completeness:1},verdict:{label:'usable'},eligibility:{handshakeMedianMs:100}};
  const higherRaw={...common,ip:'higher-raw',scores:{conservative:75,conservativeUncapped:80,overallUncapped:85},load:{sustainedMbps:26,rpm:315}};
  const higherMbps={...common,ip:'higher-mbps',scores:{conservative:75,conservativeUncapped:79.8,overallUncapped:84.5},load:{sustainedMbps:30,rpm:229}};
  assert.equal(rankCandidates([higherMbps,higherRaw])[0].ip,'higher-raw');
});
test('eligibility-only rows do not pollute limiting-factor totals',()=>{
  const rows=[
    {measurement:{status:'unmeasured'},gates:{limiting:'sustainedMbps'}},
    {measurement:{status:'complete'},gates:{limiting:'rpm'}},
  ];
  assert.deepEqual(countLimitingFactors(rows),{rpm:1});
});
