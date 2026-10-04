// Door and window motion shared by rendering, the collision sweep and live collision.
// Runtime parts are in web coordinates (Y up). `yaw` is degrees about +Y (right-handed):
// importers write a Blender +Z angle unchanged, because Blender (x,y,z) is web (x,z,-y).
// Legacy `angle` metadata predates that contract and keeps its original -angle rotation.
// A `parent` part carries its child's hinge, so bifold panels stay joined while folding.
const rad=Math.PI/180;
export function partYaw(part){
 const motions=['yaw','angle','slide'].filter(k=>part[k]!==undefined);
 if(motions.length!==1)throw Error('Door part needs exactly one motion');
 if(part.slide!==undefined){if(!Array.isArray(part.slide)||part.slide.length!==3||!part.slide.every(Number.isFinite))throw Error('Invalid slide');return 0;}
 const value=part.yaw??part.angle;
 if(typeof value!=='number'||!Number.isFinite(value)||value===0||Math.abs(value)>180)throw Error('Invalid hinge angle');
 return (part.yaw!==undefined?value:-value)*rad;
}
// Parents before children; rejects duplicate names, cycles and parents outside the door.
export function orderParts(parts){
 const byName=new Map();
 for(const p of parts){if(typeof p.name!=='string'||byName.has(p.name))throw Error('Duplicate door part');partYaw(p);byName.set(p.name,p);}
 const state=new Map(),ordered=[];
 const visit=p=>{const s=state.get(p.name);if(s==='done')return;if(s==='active')throw Error('Door part links form a cycle');state.set(p.name,'active');
  if(p.parent!==undefined){const parent=byName.get(p.parent);if(!parent||parent===p)throw Error('Missing parent door part');visit(parent);}
  state.set(p.name,'done');ordered.push(p);};
 for(const p of parts)visit(p);return ordered;
}
const rotate=(a,[x,y,z])=>[x*Math.cos(a)+z*Math.sin(a),y,-x*Math.sin(a)+z*Math.cos(a)];
export const applyTransform=(T,p)=>{const r=rotate(T.a,p);return [r[0]+T.t[0],r[1]+T.t[1],r[2]+T.t[2]];};
// A after B for rigid motions {a: yaw radians, t: translation}.
const compose=(A,B)=>({a:A.a+B.a,t:applyTransform(A,B.t)});
// origins: name -> {position:[x,y,z], rotation:[x,y,z,w]} of each part root in the closed pose.
// Returns name -> {position, rotation, transform} at an opening fraction in [0,1].
export function doorPoses(parts,origins,fraction){
 const poses=new Map();
 for(const p of orderParts(parts)){
  const o=origins.get(p.name);if(!o)throw Error('Missing door part');
  let local;
  if(p.slide)local={a:0,t:p.slide.map(v=>v*fraction)};
  else{const a=partYaw(p)*fraction,r=rotate(a,o.position);local={a,t:o.position.map((v,i)=>v-r[i])};}
  const T=p.parent===undefined?local:compose(poses.get(p.parent).transform,local);
  const s=Math.sin(T.a/2),c=Math.cos(T.a/2),[x,y,z,w]=o.rotation;
  poses.set(p.name,{position:applyTransform(T,o.position),rotation:[c*x+s*z,c*y+s*w,c*z-s*x,c*w-s*y],transform:T});
 }
 return poses;
}
// Capture closed poses from scene entities (anything with getPosition/getRotation).
export function captureOrigins(parts,find){
 const origins=new Map();
 for(const p of orderParts(parts)){const entity=find(p.name);if(!entity)throw Error('Missing door part');const q=entity.getPosition(),r=entity.getRotation();origins.set(p.name,{entity,position:[q.x,q.y,q.z],rotation:[r.x,r.y,r.z,r.w]});}
 return origins;
}
export function applyDoorPose(parts,origins,fraction){
 for(const [name,pose] of doorPoses(parts,origins,fraction)){const e=origins.get(name).entity;e.setPosition(...pose.position);e.setRotation(...pose.rotation);}
}
