import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {doorPoses,orderParts,partYaw,applyTransform,applyDoorPose,captureOrigins} from '../door-kinematics.mjs';
import {captureRoomCollision} from '../collision.mjs';
// Invented fixture shared with the skill's Python tests (Blender Z-up metres).
const fixture=JSON.parse(fs.readFileSync(new URL('../skills/blender-room-tour/tests/fixtures/articulated-doors.json',import.meta.url)));
const web=([x,y,z])=>[x,z,-y];
const close=(a,b,tol=1e-6)=>a.every((v,i)=>Math.abs(v-b[i])<=tol);
const origins=()=>new Map(Object.entries(fixture.pivots).map(([name,p])=>[name,{position:web(p),rotation:[0,0,0,1]}]));
const doorOf=name=>fixture.runtime.doors.find(d=>d.parts.some(p=>p.name===name));
function rotateByQuat([qx,qy,qz,qw],v){
 const t=[2*(qy*v[2]-qz*v[1]),2*(qz*v[0]-qx*v[2]),2*(qx*v[1]-qy*v[0])];
 return [v[0]+qw*t[0]+qy*t[2]-qz*t[1],v[1]+qw*t[1]+qz*t[0]-qx*t[2],v[2]+qw*t[2]+qx*t[1]-qy*t[0]];
}

test('imported Blender +Z hinge angles open the panel to the declared side in web Y-up',()=>{
 for(const probe of fixture.probes){
  const pose=doorPoses(doorOf(probe.part).parts,origins(),probe.fraction).get(probe.part);
  const viaTransform=applyTransform(pose.transform,web(probe.point));
  assert.ok(close(viaTransform,web(probe.expected)),`${probe.part}@${probe.fraction}: ${viaTransform} vs ${web(probe.expected)}`);
  // The entity pose (position + quaternion) the renderer applies moves the same point identically.
  const local=web(probe.point).map((v,i)=>v-web(fixture.pivots[probe.part])[i]),viaEntity=rotateByQuat(pose.rotation,local).map((v,i)=>v+pose.position[i]);
  assert.ok(close(viaEntity,viaTransform,1e-9),probe.part);
 }
});

test('legacy schema 1 angle keeps its original negated rotation for existing imports',()=>{
 const {part,point,expected}=fixture.legacy_probe;
 const pose=doorPoses([part],origins(),1).get(part.name);
 assert.ok(close(applyTransform(pose.transform,web(point)),web(expected)));
 assert.equal(partYaw({yaw:90}),-partYaw({angle:90}));
});

test('bifold panels stay joined, the jamb hinge stays fixed and the free edge rides the track',()=>{
 const closet=fixture.runtime.doors.find(d=>d.id==='closet');
 for(let step=0;step<=20;step++){
  const poses=doorPoses(closet.parts,origins(),step/20);
  const joint=applyTransform(poses.get('ClosetPanelA').transform,web(fixture.pivots.ClosetPanelB));
  assert.ok(close(poses.get('ClosetPanelB').position,joint,1e-12));
  assert.ok(close(poses.get('ClosetPanelA').position,web(fixture.pivots.ClosetPanelA),1e-12));
  const free=applyTransform(poses.get('ClosetPanelB').transform,web([2.9,3.0,1.0]));
  assert.ok(Math.abs(free[2]-(-3.0))<1e-9,'free edge leaves the track at step '+step);
 }
});

test('invalid links and motions are rejected',()=>{
 assert.throws(()=>orderParts([{name:'A',yaw:90,parent:'B'},{name:'B',yaw:-180,parent:'A'}]),/cycle/);
 assert.throws(()=>orderParts([{name:'A',yaw:90},{name:'B',yaw:-160,parent:'Elsewhere'}]),/Missing parent/);
 assert.throws(()=>orderParts([{name:'A',yaw:90,parent:'A'}]),/cycle|parent/);
 assert.throws(()=>orderParts([{name:'A',yaw:90},{name:'A',slide:[1,0,0]}]),/Duplicate/);
 for(const part of [{name:'A'},{name:'A',yaw:90,slide:[1,0,0]},{name:'A',yaw:0},{name:'A',yaw:181},{name:'A',yaw:NaN},{name:'A',yaw:'90'},{name:'A',slide:[1,0]},{name:'A',slide:[1,NaN,0]}])
  assert.throws(()=>orderParts([part]),undefined,JSON.stringify(part));
});

// Minimal stand-ins for PlayCanvas entities: world pose plus a local box whose AABB follows the pose.
class Entity{
 constructor(name,position,box){this.name=name;this.p=[...position];this.q=[0,0,0,1];this.box=box;this.moves=0;}
 getPosition(){const [x,y,z]=this.p;return {x,y,z};}
 getRotation(){const [x,y,z,w]=this.q;return {x,y,z,w};}
 setPosition(x,y,z){this.p=[x,y,z];this.moves++;}
 setRotation(x,y,z,w){this.q=[x,y,z,w];this.moves++;}
 findComponents(type){
  if(type!=='render')return [];
  const corners=[];for(const x of [0,1])for(const y of [0,1])for(const z of [0,1])corners.push(rotateByQuat(this.q,[this.box.min[0]+x*(this.box.max[0]-this.box.min[0]),this.box.min[1]+y*(this.box.max[1]-this.box.min[1]),this.box.min[2]+z*(this.box.max[2]-this.box.min[2])]).map((v,i)=>v+this.p[i]));
  const lo=[0,1,2].map(i=>Math.min(...corners.map(c=>c[i]))),hi=[0,1,2].map(i=>Math.max(...corners.map(c=>c[i])));
  const xyz=a=>({x:a[0],y:a[1],z:a[2]});
  return [{meshInstances:[{aabb:{center:xyz(lo.map((v,i)=>(v+hi[i])/2)),halfExtents:xyz(lo.map((v,i)=>(hi[i]-v)/2))}}]}];
 }
}
function fixtureRoom(){
 const entities=new Map();
 const add=(name,pivot,box)=>{const p=web(pivot),a=web(box.min),b=web(box.max);entities.set(name,new Entity(name,p,{min:a.map((v,i)=>Math.min(v,b[i])-p[i]),max:a.map((v,i)=>Math.max(v,b[i])-p[i])}));};
 for(const [name,pivot] of Object.entries(fixture.pivots))add(name,pivot,fixture.bounds[name]);
 for(const [name,box] of Object.entries(fixture.static))add(name,box.min,box);
 add('Floor',[0,0,0],{min:[0,-.5,-.05],max:[5,4,0]});
 const groups=[{name:'Floor',kind:'floor'},...[...entities.keys()].filter(n=>n!=='Floor').map(name=>({name,kind:'object'}))];
 return {room:{findByName:name=>entities.get(name)},entities,meta:{groups,doors:fixture.runtime.doors}};
}

test('rendered pose, collision sweep and live collision use one motion and restore the closed pose',()=>{
 const {room,entities,meta}=fixtureRoom();
 const closed=new Map([...entities].map(([n,e])=>[n,{p:[...e.p],q:[...e.q]}]));
 const collision=captureRoomCollision(null,room,meta);
 // Tolerant comparisons: restoring a pose may turn -0 into +0, which strict deep equality distinguishes.
 const sameBoxes=(a,b)=>a.length===b.length&&a.every((box,i)=>['x','y','z','hx','hy','hz','angle'].every(k=>Math.abs(box[k]-b[i][k])<1e-12));
 for(const [name,e] of entities){assert.ok(close(e.p,closed.get(name).p,1e-12),name);assert.ok(close(e.q,closed.get(name).q,1e-12),name);}
 assert.equal(entities.get('ClosetFrame').moves,0,'static frame never moves');
 assert.ok(collision.solids.some(s=>Math.abs(s.x-1.975)<1e-9),'static frame is a fixed obstacle');
 assert.equal(collision.doors.length,3);
 for(const door of meta.doors){
  const swept=collision.doors.find(d=>d.id===door.id),origins=captureOrigins(door.parts,room.findByName);
  assert.equal(swept.volumes.length,19*door.parts.length);
  for(const fraction of [.5,1]){
   applyDoorPose(door.parts,origins,fraction);
   const live=swept.currentVolumes,step=Math.round(fraction*18);
   assert.ok(sameBoxes(swept.volumes.slice(step*door.parts.length,(step+1)*door.parts.length),live),door.id+'@'+fraction);
  }
  applyDoorPose(door.parts,origins,0);
 }
 // The opened hinged door occupies the room side (+Y in Blender is -Z in web), never the other side.
 const hall=collision.doors.find(d=>d.id==='hall').volumes.at(-1);
 assert.ok(hall.z-hall.hz<-.79&&hall.z+hall.hz<=.03,JSON.stringify(hall));
});
