import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {DEFAULT_ROOM,DEFAULT_BOUNDS,resolveRoom,roomConfig,layoutKey,fitDistance} from '../rooms.mjs';
import {DEFAULT_LAYOUT,encodeLayout,decodeLayout} from '../layout.mjs';
import {checkPlacement,findSpace} from '../collision.mjs';
import {PICKER_TEXT} from '../room-picker.mjs';
import {telemetryOptedIn,TELEMETRY_OPT_IN_KEY} from '../telemetry.mjs';
import {locales} from '../i18n.mjs';
const root=new URL('../',import.meta.url);

// Minimal GLB reader: world AABBs of mesh nodes, grouped by their top-level parent.
function roomBoxes(){
 const buf=fs.readFileSync(new URL('assets/room.glb',root));
 assert.equal(buf.toString('latin1',0,4),'glTF');assert.equal(buf.readUInt32LE(4),2);assert.equal(buf.readUInt32LE(8),buf.length);
 const jsonLength=buf.readUInt32LE(12);assert.equal(buf.toString('latin1',16,20),'JSON');
 const gltf=JSON.parse(buf.toString('utf8',20,20+jsonLength));const groups={};
 for(const index of gltf.scenes[0].nodes){const group=gltf.nodes[index];groups[group.name]=group.children.map(c=>{const node=gltf.nodes[c],acc=gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION],[x,y,z]=node.translation;return {name:node.name,x,y,z,hx:acc.max[0],hy:acc.max[1],hz:acc.max[2],angle:0};});}
 return {gltf,groups};
}
function collisionRoom(){
 const {groups}=roomBoxes(),meta=JSON.parse(fs.readFileSync(new URL('assets/room.json',root)));const floors=[],solids=[];
 // Mirrors captureRoomCollision: floor groups support furniture, other boxes in the furniture height band block it.
 for(const g of meta.groups)for(const b of groups[g.name])if(g.kind==='floor')floors.push(b);else if(b.y+b.hy>.06&&b.y-b.hy<1.4)solids.push(b);
 return {floors,solids,doors:[]};
}

test('one synthetic room: other room ids are refused, storage is namespaced',()=>{
 for(const value of [undefined,null,'',DEFAULT_ROOM])assert.equal(resolveRoom(value),DEFAULT_ROOM);
 for(const value of ['default','../room','any-home'])assert.throws(()=>resolveRoom(value));
 assert.equal(roomConfig(DEFAULT_ROOM).bounds,DEFAULT_BOUNDS);assert.equal(roomConfig(DEFAULT_ROOM).synthetic,true);
 assert.equal(layoutKey(DEFAULT_ROOM),'move-demo:layout:practice-room');
});
test('camera fit stays within limits and backs off for narrow screens',()=>{
 const config=roomConfig(DEFAULT_ROOM),wide=fitDistance(config,16/9,false,48),narrow=fitDistance(config,.5,true,65);
 for(const d of [wide,narrow])assert.ok(d>=config.minDistance&&d<=config.maxDistance,String(d));
 assert.ok(fitDistance(config,1,false,48)>=wide);assert.ok(Number.isFinite(fitDistance(config,NaN,false,48)));
});
test('room.json groups match GLB nodes; geometry is the invented 5.6 x 4.0 m room',()=>{
 const {gltf,groups}=roomBoxes(),meta=JSON.parse(fs.readFileSync(new URL('assets/room.json',root)));
 assert.equal(gltf.asset.extras.synthetic,true);assert.deepEqual(meta.groups.map(g=>g.name).sort(),Object.keys(groups).sort());
 const [floor]=groups.Floor;assert.ok(Math.abs(floor.hx*2-5.6)<1e-5);assert.ok(Math.abs(floor.hz*2-4)<1e-5);assert.ok(Math.abs(floor.y+floor.hy)<1e-6,'floor top at y=0');
 assert.equal(gltf.materials.find(m=>m.name==='Window glazing').alphaMode,'BLEND');
 for(const [name,boxes] of Object.entries(groups))for(const b of boxes)assert.ok(b.hx>0&&b.hy>0&&b.hz>0,name+'/'+b.name);
});
test('default layout fits the floor with no collisions and survives a share round trip',()=>{
 const room=collisionRoom();
 for(const item of DEFAULT_LAYOUT){const result=checkPlacement(item,DEFAULT_LAYOUT,room);assert.equal(result.valid,true,`${item.id}: ${result.reason}`);}
 assert.deepEqual(decodeLayout(encodeLayout(DEFAULT_LAYOUT)),DEFAULT_LAYOUT);
 const config=roomConfig(DEFAULT_ROOM);
 for(const type of ['sofa','bed','desk','plant'])assert.ok(findSpace({id:'n',type,x:config.center[0],z:config.center[2],r:0,color:0},DEFAULT_LAYOUT,room,false,DEFAULT_BOUNDS),type);
});
test('fixed cabinet and floor edge block placement',()=>{
 const room=collisionRoom();
 assert.equal(checkPlacement({id:'a',type:'chair',x:-2.45,z:1.2,r:0,color:0},[],room).reason,'obstacle');
 assert.equal(checkPlacement({id:'a',type:'chair',x:2.7,z:0,r:0,color:0},[],room).reason,'outside');
});
test('room picker copy exists in all six languages and says the room is invented',()=>{
 for(const [key,values] of Object.entries(PICKER_TEXT)){assert.equal(values.length,locales.length,key);for(const v of values)assert.ok(v.trim(),key);}
 assert.match(PICKER_TEXT.note[locales.indexOf('en')],/invented/);assert.match(PICKER_TEXT.name[locales.indexOf('en')],/Synthetic/);
});
test('telemetry is off unless this browser opts in',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)??null};
 assert.equal(telemetryOptedIn(storage),false);store.set(TELEMETRY_OPT_IN_KEY,'1');assert.equal(telemetryOptedIn(storage),true);
 assert.equal(telemetryOptedIn({getItem(){throw Error('blocked');}}),false);
});
test('browser files carry no live-site asset URLs, local paths or production hosting assumptions',()=>{
 const allow=fs.readFileSync(new URL('build_public.py',root),'utf8').match(/ALLOWLIST = \(([\s\S]*?)\n\)/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));
 assert.ok(allow.includes('index.html')&&allow.includes('assets/room.glb'));
 for(const name of allow.filter(n=>/\.(html|css|mjs|json)$/.test(n))){
  const text=fs.readFileSync(new URL(name,root),'utf8');
  for(const needle of ['move.jingtao.io','/Users/','file://','private-network.invalid','private-room-','cf-connecting-ip'])assert.ok(!text.toLowerCase().includes(needle.toLowerCase()),`${name} contains ${needle}`);
 }
 const html=fs.readFileSync(new URL('index.html',root),'utf8');
 assert.ok(!/real apartment/i.test(html));assert.match(html,/content="assets\/og\.png"/);assert.match(html,/Jingtao Wang/);
});
test('MIT notice ships at the root, in the published files, in the skill and in its viewer; PlayCanvas notices stay',()=>{
 const license=fs.readFileSync(new URL('LICENSE',root),'utf8');
 assert.match(license,/^MIT License\n\nCopyright \(c\) 2026 Jingtao Wang\n/);
 assert.ok(fs.readFileSync(new URL('build_public.py',root),'utf8').includes("'LICENSE'"));
 const skill=fs.readFileSync(new URL('skills/blender-room-tour/LICENSE',root),'utf8');assert.ok(skill.startsWith(license),'skill copy must contain the full root license');
 const viewer=fs.readFileSync(new URL('skills/blender-room-tour/scripts/blender_tour_flow/assets/viewer.js',root),'utf8');
 assert.match(viewer,/^\/\*! blender-room-tour viewer\n \* MIT License\n \*\n \* Copyright \(c\) 2026 Jingtao Wang/);
 for(const p of ['assets/PLAYCANVAS-LICENSE.txt','skills/blender-room-tour/scripts/blender_tour_flow/assets/PLAYCANVAS-LICENSE.txt'])assert.match(fs.readFileSync(new URL(p,root),'utf8'),/PlayCanvas Ltd\./);
});
