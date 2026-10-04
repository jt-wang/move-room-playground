// Original rounded-box geometry: clamp a subdivided cube to an inner box,
// then offset by the rounded edge radius. Shared across matching furniture parts.
const cache=new Map();
export function roundedMesh(pc,device,size){
 const key=size.join(',');if(cache.has(key))return cache.get(key);
 const half=size.map(x=>x/2),radius=Math.min(.10,...size.map(x=>x*.28)),inner=half.map(x=>x-radius),positions=[],normals=[],indices=[],uvs=[];
 const faces=[[[1,0,0],[0,0,-1],[0,1,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]]];
 const steps=6;
 for(const [n,u,v] of faces){const start=positions.length/3;
 for(let j=0;j<=steps;j++)for(let i=0;i<=steps;i++){
 const p=half.map((h,k)=>h*(n[k]+u[k]*(i/steps*2-1)+v[k]*(j/steps*2-1)));
 const q=p.map((x,k)=>Math.max(-inner[k],Math.min(inner[k],x))),d=p.map((x,k)=>x-q[k]),len=Math.hypot(...d);
 const uk=u.findIndex(x=>x!==0),vk=v.findIndex(x=>x!==0);uvs.push(p[uk]*u[uk]*2.5,p[vk]*v[vk]*2.5);
 const normal=d.map(x=>x/len);positions.push(...q.map((x,k)=>x+normal[k]*radius));normals.push(...normal);
 }for(let j=0;j<steps;j++)for(let i=0;i<steps;i++){const a=start+j*(steps+1)+i,b=a+1,c=a+steps+1,d=c+1;indices.push(a,b,c,b,d,c);}}
 const mesh=new pc.Mesh(device);mesh.setPositions(positions);mesh.setNormals(normals);mesh.setUvs(0,uvs);mesh.setIndices(indices);mesh.update(pc.PRIMITIVE_TRIANGLES);// Keep one cache-owned reference: destroying furniture must not destroy shared geometry.
 mesh.incRefCount();cache.set(key,mesh);return mesh;
}
