// Browser smoke test against the local server. Needs a build and an installed Chrome; nothing is downloaded.
// Usage: npm run build:public && npm run test:browser          (public/, full interaction checks)
//        npm run build && node tests/browser-smoke.mjs --release (release-public/, load + screenshot only)
// PLAYWRIGHT_CHANNEL=chromium uses Playwright's own browser instead of Chrome, if one is installed.
// Screenshots go to output/browser/.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=process.argv.includes('--release');
const shots=path.join(root,'output','browser');fs.mkdirSync(shots,{recursive:true});
const shareDir=fs.mkdtempSync(path.join(os.tmpdir(),'move-smoke-shares-'));
const server=spawn(process.execPath,[path.join(root,'serve.mjs'),...(release?['--release']:[])],{env:{...process.env,ROOM_SHARE_DIR:shareDir,ROOM_METRICS_FILE:''},stdio:['ignore','pipe','inherit']});
const base=await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',d=>{out+=d;const m=out.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m)resolve(m[0]);});server.on('exit',code=>reject(Error('server exited '+code)));});
const channel=process.env.PLAYWRIGHT_CHANNEL??'chrome';
const browser=await chromium.launch({...(channel&&channel!=='chromium'?{channel}:{}),args:['--enable-unsafe-swiftshader']});
const problems=[];
function watch(page,label){
 page.on('console',m=>{if(m.type()==='error')problems.push(`${label} console: ${m.text()}`);});
 page.on('pageerror',e=>problems.push(`${label} pageerror: ${e.message}`));
 // The demo must never contact another host.
 page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))problems.push(`${label} external request: ${r.url()}`);});
}
const state=page=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const ready=page=>page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,null,{timeout:45000});
async function open(viewport,label,url=base){const context=await browser.newContext({viewport,deviceScaleFactor:1});const page=await context.newPage();watch(page,label);await page.goto(url);return {context,page};}

try{
 if(release){
  const {context,page}=await open({width:1280,height:800},'release');
  await page.waitForSelector('#loading',{state:'hidden',timeout:45000});await page.waitForTimeout(500);
  await page.screenshot({path:path.join(shots,'release-desktop.png')});await context.close();
 }else{
  const {context,page}=await open({width:1280,height:800},'desktop');await ready(page);await page.waitForTimeout(500);
  let s=await state(page);
  assert.equal(s.roomID,'practice-room');assert.equal(s.items.length,6);assert.equal(s.doors.length,0);assert.ok(s.clayMaterials>0);
  assert.ok(s.collisionCounts.floors>0&&s.collisionCounts.solids>0);assert.equal(s.placement,null);
  assert.ok(await page.locator('.door-controls').isHidden(),'door controls must be hidden without doors');
  await page.screenshot({path:path.join(shots,'desktop-default.png')});
  // Add, rotate and place a lamp.
  await page.click('.furniture-card[data-type="lamp"]');s=await state(page);assert.equal(s.items.length,7);const lamp=s.selected;assert.ok(lamp);
  await page.keyboard.press('r');await page.click('#place-done');s=await state(page);assert.equal(s.items.find(i=>i.id===lamp).r,15);
  // Local save survives a reload.
  await page.reload();await ready(page);s=await state(page);assert.equal(s.items.length,7);assert.equal(s.items.find(i=>i.id===lamp)?.r,15);
  // Select by clicking the lamp on screen, delete it, then undo.
  const target=s.screenItems.find(i=>i.id===lamp);await page.mouse.click(target.x,target.y);s=await state(page);assert.equal(s.selected,lamp,'lamp selected by click');
  await page.keyboard.press('Delete');s=await state(page);assert.equal(s.items.length,6);
  await page.keyboard.press('Control+z');s=await state(page);assert.equal(s.items.length,7);
  // All six languages render without missing strings.
  for(const [locale,share] of [['zh-Hant','分享我的佈置 ↗'],['ja','配置を共有 ↗'],['ko','배치 공유 ↗'],['es','Compartir ↗'],['zh-Hans','分享我的布置 ↗'],['en','Share layout ↗']]){await page.selectOption('#language',locale);assert.equal(await page.textContent('#share'),share);assert.equal((await state(page)).language,locale);}
  assert.equal(await page.textContent('#choose-room'),'About this room');
  await page.click('#choose-room');assert.match(await page.textContent('#room-picker'),/invented practice room/);await page.screenshot({path:path.join(shots,'desktop-picker-en.png')});await page.click('#room-picker .room-close');
  // Short share link opens the same layout in a fresh browser profile.
  await page.click('#share');await page.waitForSelector('#share-dialog[open]');const link=await page.inputValue('#share-url');assert.match(link,/\?s=[\w-]{16}$/);
  const expected=(await state(page)).items.map(({type,x,z,r,color})=>({type,x,z,r,color}));await context.close();
  const shared=await open({width:1280,height:800},'shared',link);await ready(shared.page);
  assert.deepEqual((await state(shared.page)).items.map(({type,x,z,r,color})=>({type,x,z,r,color})),expected);await shared.context.close();
  const mobile=await open({width:390,height:844},'mobile');await ready(mobile.page);await mobile.page.waitForTimeout(500);
  assert.equal((await state(mobile.page)).items.length,6);await mobile.page.screenshot({path:path.join(shots,'mobile-default.png'),fullPage:true});await mobile.context.close();
 }
 assert.deepEqual(problems,[]);
 console.log(`browser smoke passed (${release?'release':'public'}); screenshots in ${path.relative(root,shots)}/`);
}catch(e){console.error(e);if(problems.length)console.error(problems.join('\n'));process.exitCode=1;}
finally{await browser.close();server.kill();fs.rmSync(shareDir,{recursive:true,force:true});}
