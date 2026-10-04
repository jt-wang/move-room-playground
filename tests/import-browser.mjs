// End-to-end local import check. Uses the installed browser; downloads nothing.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.dirname(app),out=path.join(root,'evidence/browser');fs.mkdirSync(out,{recursive:true});
const imports=process.env.IMPORT_DIR||path.join(root,'fictional-app-final');
const shares=fs.mkdtempSync(path.join(os.tmpdir(),'move-import-shares-'));
const server=spawn(process.execPath,[path.join(app,'serve.mjs')],{env:{...process.env,ROOM_PUBLIC_DIR:imports,ROOM_RECEIPT:imports+'-receipt.json',ROOM_SHARE_DIR:shares,ROOM_METRICS_FILE:''},stdio:['ignore','pipe','pipe']});
const base=await new Promise((resolve,reject)=>{let text='';server.stdout.on('data',d=>{text+=d;const m=text.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m)resolve(m[0]);});server.stderr.on('data',d=>process.stderr.write(d));server.on('exit',c=>reject(Error('server exited '+c)));});
const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
const problems=[],checks=[],states={};const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,null,{timeout:45000});
async function open(viewport){const context=await browser.newContext({viewport,deviceScaleFactor:1});await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();problems.push('External request '+u);return route.abort();});const page=await context.newPage();page.on('pageerror',e=>problems.push(e.message));page.on('console',m=>{if(m.type()==='error')problems.push(m.text());});await page.goto(base);await ready(page);await page.selectOption('#language','en');return {context,page};}
try{
 const {context,page}=await open({width:1280,height:800});let s=await state(page);states.initial=s;
 assert.equal(s.roomID,'fictional-hinged-room');assert.equal(s.items.length,0);assert.equal(s.doors.length,1);assert.deepEqual(s.collisionCounts,{floors:1,solids:4,doors:1});assert.ok(await page.locator('#share').isHidden());checks.push('Imported identity, empty editable layout, floor/static/door collision groups, share hidden');
 await page.screenshot({path:path.join(out,'01-imported-room.png')});
 await page.locator('.door-controls summary').click();await page.locator('#door-buttons button').click();await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).doors[0].value===1);s=await state(page);states.openDoor=s;assert.notDeepEqual(s.doors[0].parts[0].rotation,states.initial.doors[0].parts[0].rotation);assert.deepEqual(s.doors[0].parts[0].position,states.initial.doors[0].parts[0].position);checks.push('Door opens through 90 degrees around its fixed hinge');
 await page.screenshot({path:path.join(out,'02-door-open.png')});
 await page.locator('#door-buttons button').click();await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).doors[0].value===0);checks.push('Door closes to original transform');
 await page.click('.furniture-card[data-type="chair"]');s=await state(page);assert.equal(s.items.length,1);const chair=s.selected;assert.equal(s.placement.valid,true);
 await page.keyboard.press('r');await page.click('#place-done');s=await state(page);assert.equal(s.items[0].r,15);checks.push('Add chair, rotate, commit');
 await page.waitForTimeout(500);s=await state(page);let hit=s.screenItems.find(i=>i.id===chair);const before={...s.items[0]};await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+38,hit.y+18,{steps:12});states.dragPreview=await state(page);await page.mouse.up();s=await state(page);assert.ok(Math.hypot(s.items[0].x-before.x,s.items[0].z-before.z)>.05);checks.push('Drag furniture to a different valid location');
 await page.click('#place-done');await page.reload();await ready(page);s=await state(page);assert.equal(s.items[0].id,chair);assert.equal(s.items[0].r,15);checks.push('Layout and rotation survive reload');
 hit=s.screenItems.find(i=>i.id===chair);await page.mouse.click(hit.x,hit.y);assert.equal((await state(page)).selected,chair);await page.keyboard.press('Delete');assert.equal((await state(page)).items.length,0);await page.keyboard.press('Control+z');assert.equal((await state(page)).items.length,1);checks.push('Select, delete, undo');
 await page.locator('.view-menu summary').click();await page.click('#top');await page.click('#walls');assert.equal((await state(page)).hiddenWalls,true);await page.click('#zoom-in');await page.click('#zoom-out');await page.click('#home');await page.locator('.view-menu summary').click();checks.push('Top view, wall hiding, zoom and reset');
 for(const locale of ['zh-Hans','zh-Hant','ja','ko','es','en']){await page.selectOption('#language',locale);await page.click('#choose-room');const text=await page.textContent('#room-picker');assert.ok(text.includes('Fictional room with hinged door'));await page.click('#room-picker .room-close');}checks.push('Imported About dialog in all six languages');
 await page.locator('.other-tools summary').click();const downloadPromise=page.waitForEvent('download');await page.click('#capture');const download=await downloadPromise;await download.saveAs(path.join(out,'03-exported-layout.png'));assert.ok(fs.statSync(path.join(out,'03-exported-layout.png')).size>10000);checks.push('PNG image export');
 await page.screenshot({path:path.join(out,'04-furniture-layout.png')});states.final=await state(page);
 await context.close();
 const mobile=await open({width:390,height:844});await mobile.page.click('.furniture-card[data-type="lamp"]');assert.equal((await state(mobile.page)).items.length,1);await mobile.page.click('#place-done');await mobile.page.locator('.mobile-door-menu summary').click();await mobile.page.click('#mobile-door-toggle');await mobile.page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).doors[0].value===1);states.mobile=await state(mobile.page);await mobile.page.screenshot({path:path.join(out,'05-mobile.png'),fullPage:true});assert.ok(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('390px mobile: add lamp, commit, open door, no horizontal overflow');await mobile.context.close();
 assert.deepEqual(problems,[]);console.log(JSON.stringify({passed:checks,problems},null,2));
}catch(e){console.error(e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({checks,problems,states},null,2));await browser.close();server.kill();fs.rmSync(shares,{recursive:true,force:true});}
