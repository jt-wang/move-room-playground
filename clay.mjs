// The normal map is generated procedurally by scripts/generate-demo.py.
let normalTexture;
export async function loadClay(pc,app){
 const asset=await new Promise((resolve,reject)=>app.assets.loadFromUrl('assets/clay-normal.png','texture',(err,a)=>err?reject(err):resolve(a)));
 normalTexture=asset.resource;normalTexture.addressU=pc.ADDRESS_REPEAT;normalTexture.addressV=pc.ADDRESS_REPEAT;normalTexture.anisotropy=4;
}
export function applyClay(material){
 if(!normalTexture)throw Error('Clay normal map is not loaded');
 material.normalMap=normalTexture;material.bumpiness=.65;material.useMetalness=true;material.metalness=0;material.gloss=.42;
 material.specular.set(.25,.25,.25);material.update();return material;
}
