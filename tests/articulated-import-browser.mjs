// Imported invented articulated room: live door poses must equal the shared kinematics.
// Usage: IMPORT_DIR=/path/to/imported-app node tests/articulated-import-browser.mjs
// Uses the installed Chrome via Playwright; downloads nothing.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {doorPoses} from '../door-kinematics.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const imports=process.env.IMPORT_DIR;if(!imports)throw Error('Set IMPORT_DIR to the folder written by scripts/import-skill.py');
const out=process.env.OUTPUT_DIR||path.join(app,'output/articulated-browser');fs.mkdirSync(out,{recursive:true});
const shares=fs.mkdtempSync(path.join(os.tmpdir(),'move-articulated-shares-'));
const server=spawn(process.execPath,[path.join(app,'serve.mjs')],{env:{...process.env,ROOM_PUBLIC_DIR:imports,ROOM_RECEIPT:imports+'-receipt.json',ROOM_SHARE_DIR:shares,ROOM_METRICS_FILE:''},stdio:['ignore','pipe','pipe']});
const base=await new Promise((resolve,reject)=>{let text='';server.stdout.on('data',d=>{text+=d;const m=text.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m)resolve(m[0]);});server.stderr.on('data',d=>process.stderr.write(d));server.on('exit',c=>reject(Error('server exited '+c)));});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',args:['--enable-unsafe-swiftshader']});
const problems=[],checks=[];const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
const close=(a,b,tol=1e-4)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=tol);
// q and -q are the same rotation.
const sameRotation=(a,b)=>close(a,b)||close(a,b.map(v=>-v));
try{
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base)||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();problems.push('External request '+u);return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>problems.push(e.message));page.on('console',m=>{if(m.type()==='error')problems.push(m.text());});
 await page.goto(base);await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,null,{timeout:45000});
 await page.selectOption('#language','en');
 const meta=await (await fetch(base+'assets/room.json')).json();
 const initial=await state(page);
 assert.equal(initial.doors.length,meta.doors.length);assert.ok(meta.doors.every(d=>d.parts.every(p=>p.angle===undefined)),'schema 2 import writes explicit yaw/slide');
 checks.push(`${meta.doors.length} imported doors with explicit web yaw/slide`);
 await page.locator('.door-controls summary').click();
 for(const door of meta.doors){
  const closed=initial.doors.find(d=>d.id===door.id);
  const origins=new Map(closed.parts.map(p=>[p.name,{position:p.position,rotation:p.rotation}]));
  await page.locator(`[data-door="${door.id}"]`).click();
  await page.waitForFunction(id=>JSON.parse(window.render_game_to_text()).doors.find(d=>d.id===id).value===1,door.id,{timeout:7000});
  const opened=(await state(page)).doors.find(d=>d.id===door.id),expected=doorPoses(door.parts,origins,1);
  for(const part of opened.parts){const want=expected.get(part.name);
   assert.ok(close(part.position,want.position),`${door.id}/${part.name} position ${part.position} vs ${want.position}`);
   assert.ok(sameRotation(part.rotation,want.rotation),`${door.id}/${part.name} rotation ${part.rotation} vs ${want.rotation}`);}
  checks.push(`Door ${door.id}: rendered open pose equals the shared kinematics for ${door.parts.length} part(s)`);
 }
 await page.screenshot({path:path.join(out,'doors-open.png')});
 for(const door of meta.doors){await page.locator(`[data-door="${door.id}"]`).click();await page.waitForFunction(id=>JSON.parse(window.render_game_to_text()).doors.find(d=>d.id===id).value===0,door.id,{timeout:7000});}
 const reclosed=await state(page);
 for(const door of reclosed.doors){const before=initial.doors.find(d=>d.id===door.id);for(const [i,part] of door.parts.entries()){assert.ok(close(part.position,before.parts[i].position));assert.ok(sameRotation(part.rotation,before.parts[i].rotation));}}
 checks.push('All doors return to their closed transforms');
 // Invented example entry doorway: Blender x 0.5-1.3 in the wall y -0.1..0 (web z 0..0.1). Static collision is
 // one box per exported mesh, so wall strips and jambs must be separate meshes for the doorway to stay open.
 const doorway=await page.evaluate(async()=>{const {captureRoomCollision,boxesOverlap}=await import('/collision.mjs');const meta=await (await fetch('/assets/room.json')).json();
  const room=captureRoomCollision(pc,pc.Application.getApplication().root,meta),probe=x=>({x,y:.9,z:.05,hx:.04,hy:.04,hz:.04,angle:0});
  return {doorwayBlocked:room.solids.some(b=>boxesOverlap(probe(.9),b)),wallBlocked:room.solids.some(b=>boxesOverlap(probe(.2),b))};});
 assert.equal(doorway.wallBlocked,true,'wall beside the entry doorway must block');assert.equal(doorway.doorwayBlocked,false,'open entry doorway must not be a static obstacle');
 checks.push('Open entry doorway clear while the neighbouring wall blocks');
 await context.close();
 assert.deepEqual(problems,[]);console.log(JSON.stringify({passed:checks,problems},null,2));
}catch(e){console.error(e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,problems},null,2));await browser.close();server.kill();fs.rmSync(shares,{recursive:true,force:true});}
