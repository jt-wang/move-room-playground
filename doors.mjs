import {doorLabel} from './door-label.mjs';
import {captureOrigins,applyDoorPose} from './door-kinematics.mjs';
// Two-sided triangle picking: a wall in front blocks a door behind it.
export function rayTriangleDistance(o,d,a,b,c){
 const sub=(u,v)=>u.map((n,i)=>n-v[i]),cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],dot=(u,v)=>u.reduce((n,x,i)=>n+x*v[i],0);
 const e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-9)return Infinity;
 const s=sub(o,a),u=dot(s,h)/det;if(u<0||u>1)return Infinity;
 const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)return Infinity;
 const distance=dot(e2,q)/det;return distance>1e-6?distance:Infinity;
}
export function createDoors(pc,room,definitions,t,container,onToggle=()=>{},canMove=()=>true,onBlocked=()=>{}){
 const mobileSelect=document.querySelector('#mobile-door-select'),mobileToggle=document.querySelector('#mobile-door-toggle');
 let active=definitions[0]?.id;
 const entries=definitions.map(def=>{const origins=captureOrigins(def.parts,name=>room.findByName(name));return {...def,value:0,target:0,origins,parts:def.parts.map(part=>({...part,entity:origins.get(part.name).entity}))};});
 function refresh(){mobileSelect.replaceChildren(...entries.map(d=>new Option(doorLabel(t,d),d.id)));mobileSelect.value=active;mobileSelect.setAttribute('aria-label',t('doorTitle'));const current=entries.find(d=>d.id===active);mobileToggle.textContent=t(current?.target?'closeDoor':'openDoor');mobileToggle.setAttribute('aria-pressed',String(current?.target===1));container.replaceChildren();for(const d of entries){const button=document.createElement('button');button.dataset.door=d.id;button.setAttribute('aria-pressed',String(d.target===1));const name=document.createElement('span'),action=document.createElement('span');name.textContent=doorLabel(t,d);action.textContent=t(d.target?'closeDoor':'openDoor');button.append(name,action);button.onclick=()=>toggle(d.id);container.append(button);}}
 function pose(d){applyDoorPose(d.parts,d.origins,d.value*d.value*(3-2*d.value));}
 function update(dt){for(const d of entries){if(d.value===d.target)continue;const previous=d.value;
 // Small steps prevent a delayed frame from jumping a panel through furniture.
 const next=d.value+Math.sign(d.target-d.value)*Math.min(Math.abs(d.target-d.value),dt*2),steps=Math.max(1,Math.ceil(Math.abs(next-previous)/.01));
 for(let step=1;step<=steps;step++){const safe=d.value;d.value=step===steps?next:previous+(next-previous)*step/steps;pose(d);if(!canMove(d.id)){d.value=safe;d.target=safe;pose(d);refresh();onBlocked(d.id);break;}}
 }}
 const snapshot=()=>entries.map(d=>({id:d.id,value:d.value,target:d.target,parts:d.parts.map(p=>({name:p.name,position:p.entity.getPosition().toArray(),rotation:p.entity.getRotation().toArray()}))}));
 mobileSelect.onchange=()=>{active=mobileSelect.value;refresh();};mobileToggle.onclick=()=>{const d=entries.find(d=>d.id===active);if(d)toggle(d.id);};

 const owners=new Map();for(const d of entries)for(const p of d.parts)owners.set(p.entity,d.id);
 const geometry=new WeakMap();
 function hitTest(ray,extra=[]){
  let best=null,nearest=Infinity;
  for(const r of [...room.findComponents('render'),...extra.flatMap(e=>e.findComponents('render'))]){
   if(!r.enabled||!r.entity.enabled)continue;
   for(const mi of r.meshInstances){
    if(!mi.visible||!mi.aabb.intersectsRay(ray))continue;
    let mesh=geometry.get(mi.mesh);if(!mesh){const positions=[],indices=[];mi.mesh.getPositions(positions);mi.mesh.getIndices(indices);mesh={positions,indices};geometry.set(mi.mesh,mesh);}
    const inverse=new pc.Mat4().invert(mi.node.getWorldTransform()),o=inverse.transformPoint(ray.origin).toArray(),d=inverse.transformVector(ray.direction).toArray();
    const {positions,indices}=mesh;const vertex=i=>positions.slice(i*3,i*3+3);
    for(let i=0;i<indices.length;i+=3){const distance=rayTriangleDistance(o,d,vertex(indices[i]),vertex(indices[i+1]),vertex(indices[i+2]));if(distance<nearest){nearest=distance;best=mi.node;}}
   }
  }
  for(let node=best;node;node=node.parent)if(owners.has(node))return owners.get(node);
  return null;
 }
 function toggle(id){const d=entries.find(d=>d.id===id);if(!d)return;active=id;d.target=d.target?0:1;refresh();onToggle(id);}
 function screenTargets(camera,rect){return entries.flatMap(d=>d.parts.flatMap(p=>p.entity.findComponents('render').flatMap(r=>r.meshInstances.map(mi=>{const point=camera.worldToScreen(mi.aabb.center);return {id:d.id,x:point.x+rect.left,y:point.y+rect.top};}))));}
 refresh();return {refresh,update,snapshot,hitTest,toggle,screenTargets};
}
