import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {doorLabel} from '../door-label.mjs';
import {setLocale,t} from '../i18n.mjs';
const root=new URL('../',import.meta.url);
test('the synthetic room declares no movable doors and no levels, so none are advertised',()=>{
 const meta=JSON.parse(fs.readFileSync(new URL('assets/room.json',root)));
 assert.deepEqual(meta.doors,[]);assert.equal(meta.levels,undefined);assert.equal(meta.synthetic,true);
 const app=fs.readFileSync(new URL('app.mjs',root),'utf8');
 assert.match(app,/hintOrbit/); // Actual desktop/mobile visibility is verified by browser checks.
});
test('generic door and window labels need no room-specific names',()=>{
 setLocale('en');assert.equal(doorLabel(t,{kind:'door',ordinal:2}),'Door 2');assert.equal(doorLabel(t,{kind:'window'}),'Window 1');setLocale('zh-Hans');
});
