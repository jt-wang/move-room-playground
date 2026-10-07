// The room must still load when the clay normal map cannot be downloaded, and report one client_error instead of room_failed.
// Usage: npm run build:public && node tests/clay-fallback-browser.mjs
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shareDir=fs.mkdtempSync(path.join(os.tmpdir(),'move-clay-shares-'));
const server=spawn(process.execPath,[path.join(root,'serve.mjs')],{env:{...process.env,ROOM_SHARE_DIR:shareDir,ROOM_METRICS_FILE:''},stdio:['ignore','pipe','inherit']});
const base=await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',d=>{out+=d;const m=out.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m)resolve(m[0]);});server.on('exit',c=>reject(Error('server exited '+c)));});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const browser=await chromium.launch({...(channel&&channel!=='chromium'?{channel}:{}),args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});const events=[];let blocked=0;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/events')events.push(r.postDataJSON());});
 // Telemetry is opt-in in the public demo; opt in so the client_error report can be observed.
 await page.addInitScript(()=>localStorage.setItem('move-demo:telemetry-opt-in','1'));
 await page.route(/clay-normal\.png/,r=>{blocked++;r.abort();});
 await page.goto(base);
 await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,null,{timeout:45000});
 await page.waitForTimeout(500);
 assert.ok(blocked>=2,'our retry ran (PlayCanvas also retries internally): '+blocked);
 assert.ok(!events.some(e=>e.event==='room_failed'),'no room_failed');
 assert.equal(events.filter(e=>e.event==='client_error').length,1,'one client_error; events seen: '+JSON.stringify(events.map(e=>e.event)));
 assert.ok(await page.locator('#loading').isHidden(),'loading screen hidden');
 console.log('PASS room loads without the clay normal map; '+blocked+' blocked requests; 1 client_error; no room_failed');
}finally{await browser.close();server.kill();}
