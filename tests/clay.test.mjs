import {test} from 'node:test';import assert from 'node:assert/strict';
// Each test imports a fresh copy because clay.mjs keeps the loaded texture in module state.
let n=0;const fresh=()=>import('../clay.mjs?case='+(n++));
const pc={ADDRESS_REPEAT:'repeat'};
const appWith=results=>{let i=0;const calls=[];return {calls,assets:{loadFromUrl(url,type,cb){calls.push(url);const r=results[Math.min(i++,results.length-1)];setTimeout(()=>r==='ok'?cb(null,{resource:{}}):cb(Error(r)),0);}}};};
const material=()=>({specular:{set(){}},update(){this.updated=true;}});
test('loads the clay normal map on the first try',async()=>{const {loadClay,applyClay}=await fresh();const app=appWith(['ok']);assert.equal(await loadClay(pc,app),true);assert.equal(app.calls.length,1);const m=applyClay(material());assert.ok(m.normalMap);assert.equal(m.normalMap.addressU,'repeat');assert.ok(m.updated);});
test('retries once when the first download fails',async()=>{const {loadClay,applyClay}=await fresh();const app=appWith(['network','ok']);assert.equal(await loadClay(pc,app),true);assert.equal(app.calls.length,2);assert.ok(applyClay(material()).normalMap);});
test('if the texture never loads, the room still gets plain clay instead of failing',async()=>{const {loadClay,applyClay}=await fresh();const app=appWith(['network','decode']);let reported=null;assert.equal(await loadClay(pc,app,{onFallback:e=>reported=e}),false);assert.equal(app.calls.length,2);assert.equal(reported?.message,'decode');const m=applyClay(material());assert.equal(m.normalMap,undefined);assert.equal(m.metalness,0);assert.ok(m.updated);});
