import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { manageConfig } from '../src/menu/index.js'; import { readSecretFile } from '../src/platform/paths.js'; import { parseVlessUri } from '../src/config/vless.js';
const SAMPLE='vless://11111111-2222-3333-4444-555555555555@edge.example.com:2052?type=ws&security=none&host=edge.example.com&path=%2Fws#Termux';
function scriptedReadline(answers){const queue=answers.slice();return{async question(){return queue.shift()??'';}}}
function tempLayout(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cfqoe-menu-'));return{root,secretFile:path.join(root,'data','config.secret.uri')}}
test('menu option 6/1 accepts a Termux clipboard URI and verifies persistence',async()=>{const layout=tempLayout();const messages=[];const result=await manageConfig({rl:scriptedReadline(['1',`\u200f\u001b[200~\`${SAMPLE}\`\u001b[201~`]),layout,print:(message)=>messages.push(message)});assert.equal(result.status,'saved');assert.equal(parseVlessUri(readSecretFile(layout.secretFile)).transport,'ws');assert.ok(messages.some((message)=>message.includes('Saved and verified')));});
test('invalid input is retried without returning to the main menu',async()=>{const layout=tempLayout();const messages=[];const result=await manageConfig({rl:scriptedReadline(['1','not-a-uri',SAMPLE]),layout,print:(message)=>messages.push(message)});assert.equal(result.status,'saved');assert.ok(messages.some((message)=>message.includes('Invalid configuration')));assert.equal(readSecretFile(layout.secretFile),SAMPLE);});
test('unsupported transports are not saved',async()=>{const layout=tempLayout();const tcp=SAMPLE.replace('type=ws','type=tcp');const result=await manageConfig({rl:scriptedReadline(['1',tcp,'0']),layout,print:()=>{}});assert.equal(result.status,'cancelled');assert.equal(fs.existsSync(layout.secretFile),false);});
