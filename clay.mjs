// The normal map is generated procedurally by scripts/generate-demo.py.
// It only adds surface texture. If it cannot be downloaded or decoded after one retry,
// the room still loads with plain clay materials instead of failing.
let normalTexture=null;
export async function loadClay(pc,app,{retries=1,onFallback}={}){
 let lastError;
 for(let attempt=0;attempt<=retries;attempt++){
  try{
   const asset=await new Promise((resolve,reject)=>app.assets.loadFromUrl('assets/clay-normal.png','texture',(err,a)=>err?reject(err):resolve(a)));
   normalTexture=asset.resource;normalTexture.addressU=pc.ADDRESS_REPEAT;normalTexture.addressV=pc.ADDRESS_REPEAT;normalTexture.anisotropy=4;
   return true;
  }catch(e){lastError=e;}
 }
 normalTexture=null;onFallback?.(lastError);return false;
}
export function applyClay(material){
 if(normalTexture){material.normalMap=normalTexture;material.bumpiness=.65;}
 material.useMetalness=true;material.metalness=0;material.gloss=.42;
 material.specular.set(.25,.25,.25);material.update();return material;
}
