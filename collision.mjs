import {elevation,itemLevel} from './levels.mjs';
import {DEFAULT_BOUNDS} from './rooms.mjs';
import {furnitureParts} from './furniture.mjs';
import {captureOrigins,applyDoorPose} from './door-kinematics.mjs';
// Small tolerance allows touching edges and ignores sub-centimetre bevel differences.
const EPS=.006,rad=Math.PI/180;
export function boxesOverlap(a,b){
 if(Math.abs(a.y-b.y)>=a.hy+b.hy-EPS)return false;
 const axes=o=>[[Math.cos(o.angle),Math.sin(o.angle)],[-Math.sin(o.angle),Math.cos(o.angle)]];
 const aa=axes(a),ba=axes(b),dx=b.x-a.x,dz=b.z-a.z;
 const extent=(o,axes,x,z)=>o.hx*Math.abs(axes[0][0]*x+axes[0][1]*z)+o.hz*Math.abs(axes[1][0]*x+axes[1][1]*z);
 for(const [x,z] of [...aa,...ba])if(Math.abs(dx*x+dz*z)>=extent(a,aa,x,z)+extent(b,ba,x,z)-EPS)return false;
 return true;
}
export function furnitureVolumes(item,levels=[]){
 const angle=-item.r*rad,c=Math.cos(angle),s=Math.sin(angle);
 return furnitureParts(item.type,item.color).map(p=>{
  const [x,y,z]=p.pos,[w,h,d]=p.size,tilt=p.rotation[2]*rad;
  return {x:item.x+x*c-z*s,z:item.z+x*s+z*c,y:y+elevation(item,levels),hx:(Math.abs(Math.cos(tilt))*w+Math.abs(Math.sin(tilt))*h)/2,hy:(Math.abs(Math.sin(tilt))*w+Math.abs(Math.cos(tilt))*h)/2,hz:d/2,angle:angle-p.rotation[1]*rad};
 });
}
function supported(box,floors){
 const c=Math.cos(box.angle),s=Math.sin(box.angle);
 // Test the whole footprint, including gaps between floor meshes.
 const nx=Math.max(1,Math.ceil(box.hx*2/.15)),nz=Math.max(1,Math.ceil(box.hz*2/.15));
 for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){
  const u=-box.hx+2*box.hx*i/nx,v=-box.hz+2*box.hz*j/nz,x=box.x+u*c-v*s,z=box.z+u*s+v*c;
  if(!floors.some(f=>Math.abs(x-f.x)<=f.hx+EPS&&Math.abs(z-f.z)<=f.hz+EPS))return false;
 }return true;
}
export function checkPlacement(item,items,room,allowOverlap=false){
 const volumes=furnitureVolumes(item,room.levels),result={valid:true,reason:'',doors:[]};
 if(!volumes.every(v=>supported(v,room.levels?.length?room.floors.filter(f=>f.level===itemLevel(item)):room.floors)))return {...result,valid:false,reason:'outside'};
 if(!allowOverlap){
  if(volumes.some(a=>[...room.solids,...room.doors.flatMap(d=>d.currentVolumes??[])].some(b=>boxesOverlap(a,b))))return {...result,valid:false,reason:'obstacle'};
  if(item.type!=='rug')for(const other of items){if(other.id===item.id||other.type==='rug')continue;const otherVolumes=furnitureVolumes(other,room.levels);if(volumes.some(a=>otherVolumes.some(b=>boxesOverlap(a,b))))return {...result,valid:false,reason:'furniture'};}
 }
 if(item.type!=='rug')result.doors=room.doors.filter(d=>volumes.some(a=>d.volumes.some(b=>boxesOverlap(a,b)))).map(d=>d.id);
 return result;
}
export function findSpace(item,items,room,allowOverlap=false,bounds=DEFAULT_BOUNDS){
 const candidates=[item];for(let x=bounds.min[0]+.3;x<=bounds.max[0];x+=.25)for(let z=bounds.min[2]+.2;z<=bounds.max[2];z+=.25)candidates.push({...item,x,z});
 candidates.sort((a,b)=>Math.hypot(a.x-item.x,a.z-item.z)-Math.hypot(b.x-item.x,b.z-item.z));
 return candidates.find(i=>checkPlacement(i,items,room,allowOverlap).valid)??null;
}
// Static meshes are separate wall/cabinet parts, not whole-room bounding boxes.
// Hidden-wall viewing does not change these captured physical bounds.
export function captureRoomCollision(pc,room,meta){
 const moving=new Set((meta.doors??[]).flatMap(d=>d.parts.map(p=>room.findByName(p.name))));
 const box=mi=>{const a=mi.aabb;return {x:a.center.x,y:a.center.y,z:a.center.z,hx:a.halfExtents.x,hy:a.halfExtents.y,hz:a.halfExtents.z,angle:0};};
 const solids=[],floors=[],doors=[];
 for(const g of meta.groups){if(g.kind==='ceiling')continue;const entity=room.findByName(g.name);if(!entity||moving.has(entity))continue;
  for(const r of entity.findComponents('render'))for(const mi of r.meshInstances){const v={...box(mi),level:g.level};if(g.kind==='floor'){floors.push(v);continue;}if(meta.levels?.length||v.y+v.hy>.06&&v.y-v.hy<1.4)solids.push(v);}
 }
 // Sweep each door as a whole with the same poses the renderer applies, so linked panels move together.
 for(const d of meta.doors??[]){const volumes=[],origins=captureOrigins(d.parts,name=>room.findByName(name));
  for(let step=0;step<=18;step++){applyDoorPose(d.parts,origins,step/18);
   for(const {entity} of origins.values())for(const r of entity.findComponents('render'))for(const mi of r.meshInstances){const v=box(mi);if(meta.levels?.length||v.y-v.hy<1.4&&v.y+v.hy>.06)volumes.push(v);}
  }applyDoorPose(d.parts,origins,0);
  doors.push({id:d.id,volumes,get currentVolumes(){return [...origins.values()].flatMap(({entity})=>entity.findComponents('render').flatMap(r=>r.meshInstances.map(box)));}});
 }
 return {solids,floors,doors,levels:meta.levels};
}
