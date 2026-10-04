import {test} from 'node:test';import assert from 'node:assert/strict';
import {captureRoomCollision,checkPlacement,boxesOverlap} from '../collision.mjs';
// Static collision is one box per mesh instance. An invented wall with a 0.8 m doorway (Blender x 0.5-1.3,
// thickness y -0.1..0, height 2.5, door head 2.0) exported as separate strips must leave the doorway open.
const web=([x,y,z])=>[x,z,-y];
const box=(lo,hi)=>{const a=web(lo),b=web(hi),min=a.map((v,i)=>Math.min(v,b[i])),max=a.map((v,i)=>Math.max(v,b[i]));const c=min.map((v,i)=>(v+max[i])/2),h=min.map((v,i)=>(max[i]-v)/2);return {aabb:{center:{x:c[0],y:c[1],z:c[2]},halfExtents:{x:h[0],y:h[1],z:h[2]}}};};
const strips=[box([-.1,-.1,0],[.5,0,2.5]),box([.5,-.1,2.0],[1.3,0,2.5]),box([1.3,-.1,0],[4.3,0,2.5])];
const jambs=[box([.47,-.1,0],[.5,0,2.02]),box([1.3,-.1,0],[1.33,0,2.02]),box([.47,-.1,2.02],[1.33,0,2.05]),box([.5,-.1,0],[1.3,0,.01])];
const floor=box([-.1,-2,-.05],[4.3,3,0]);
function room(walls,frame){
 const groups={RoomFloor:[floor],RoomWalls:walls,EntryFrame:frame};
 const entity=name=>({findComponents:()=>groups[name].map(mi=>({meshInstances:[mi]}))});
 return captureRoomCollision(null,{findByName:entity},{groups:[{name:'RoomFloor',kind:'floor'},{name:'RoomWalls',kind:'walls'},{name:'EntryFrame',kind:'object'}],doors:[]});
}
const probe=(x,z)=>({x,y:.9,z,hx:.04,hy:.04,hz:.04,angle:0});
const blocked=(collision,p)=>collision.solids.some(b=>boxesOverlap(p,b));

test('an open doorway stays clear while the neighbouring wall and jambs block',()=>{
 const collision=room(strips,jambs);
 assert.equal(blocked(collision,probe(.9,.05)),false,'doorway');
 assert.equal(blocked(collision,probe(.2,.05)),true,'wall beside the doorway');
 assert.equal(blocked(collision,probe(.485,.05)),true,'jamb');
 // Furniture can be placed in the open doorway (it is supported by the floor and hits no solid).
 assert.equal(checkPlacement({id:'p',type:'plant',x:.9,z:.05,r:0,color:0},[],collision).reason,'');
 assert.equal(checkPlacement({id:'p',type:'plant',x:2.5,z:.05,r:0,color:0},[],collision).reason,'obstacle');
});

test('the regression: the same strips packed into one mesh fill the doorway',()=>{
 const packed=box([-.1,-.1,0],[4.3,0,2.5]);
 assert.equal(blocked(room([packed],jambs),probe(.9,.05)),true);
});
