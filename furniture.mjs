import {COLORS} from './layout.mjs';
import {applyClay} from './clay.mjs';
import {roundedMesh} from './rounded.mjs';
const materialCache=new Map();
// The renderer and placement checks share these part dimensions.
export function furnitureParts(type,color=0){
 const parts=[],mat=hex=>hex;
 const fabric=COLORS[color],wood='#bf9470',cream='#fff5df',dark='#447d58';
 function part(type,pos,size,material=fabric){const p={type,pos,size,material,rotation:[0,0,0]};parts.push(p);return {setLocalEulerAngles:(...angles)=>p.rotation=angles};}
 const box=(p,s,m=fabric)=>part('box',p,s,m),ball=(p,s,m)=>part('sphere',p,s,m);
 function legs(w,d,h){for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])box([x,h/2,z],[.095,h,.095],wood);}
 if(type==='sofa'){
  legs(1.75,.63,.2);box([0,.3,0],[2.05,.25,.88]);box([0,.64,-.36],[2.04,.62,.23]);
  for(const x of [-.52,.52]){box([x,.47,.025],[.93,.23,.66],cream);box([x,.69,-.2],[.9,.39,.20]);}
  for(const x of [-1,1])box([x,.56,.02],[.25,.46,.87]);
  const pillow=box([-.65,.7,.04],[.33,.32,.15],mat('#eea751'));pillow.setLocalEulerAngles(0,0,-14);
 }else if(type==='bed'){
  legs(1.4,1.8,.16);box([0,.21,0],[1.62,.24,2.12],wood);box([0,.42,0],[1.55,.2,2.05],cream);box([0,.55,.32],[1.57,.10,1.36]);for(const x of [-.48,0,.48])box([x,.607,.38],[.035,.012,1.15],cream);box([0,.68,-1.02],[1.65,.95,.13],wood);
  for(const x of [-.4,.4])box([x,.58,-.67],[.66,.15,.42],cream);
 }else if(type==='table'){legs(1.3,.7,.7);box([0,.74,0],[1.55,.16,.94],wood);box([0,.801,0],[.65,.012,.38]);ball([.39,.91,.1],[.13,.18,.13],cream);
 }else if(type==='chair'){legs(.45,.44,.42);box([0,.45,0],[.60,.17,.58]);box([0,.75,-.25],[.60,.54,.16]);
 }else if(type==='plant'){part('cylinder',[0,.21,0],[.39,.42,.39],fabric);part('cylinder',[0,.52,0],[.055,.4,.055],wood);ball([0,.76,0],[.58,.67,.52],dark);ball([.18,.65,.12],[.33,.42,.35],dark);ball([-.19,.6,-.13],[.36,.46,.36],mat('#6ea557'));
 }else if(type==='rug'){box([0,.014,0],[2.5,.028,1.7]);for(const z of [-.72,.72])box([0,.03,z],[2.33,.01,.055],cream);}
 if(type==='lamp'){
  part('cylinder',[0,.04,0],[.4,.08,.4],wood);part('cylinder',[0,.75,0],[.045,1.4,.045],wood);part('cylinder',[0,1.43,0],[.5,.34,.5],cream);ball([0,1.25,0],[.16,.16,.16],'#edc87a');
 }else if(type==='desk'){
  legs(1.05,.46,.69);box([0,.74,0],[1.2,.1,.6],wood);box([.4,.55,0],[.3,.26,.5]);box([.4,.55,.26],[.12,.025,.025],cream);
 }else if(type==='coffeeTable'){
  legs(.77,.36,.34);box([0,.39,0],[1,.12,.55],wood);box([0,.16,0],[.85,.05,.4]);
 }else if(type==='tv'){
  box([0,.25,0],[1.25,.38,.4],wood);for(const x of [-.42,.42])box([x,.035,0],[.08,.07,.28],wood);
  box([0,.8,0],[1.12,.66,.08],'#374448');box([0,.8,.048],[1.02,.56,.016],'#829eac');box([0,.46,0],[.28,.045,.25],'#374448');box([0,.51,0],[.06,.15,.06],'#374448');
 }else if(type==='catTree'){
  box([0,.055,0],[.7,.11,.65]);box([-.13,.32,0],[.4,.42,.4],cream);ball([-.13,.32,.204],[.22,.25,.018],'#796451');
  for(const [x,z,h] of [[.2,-.16,1.1],[-.22,.14,.62]])part('cylinder',[x,h/2+.1,z],[.11,h,.11],wood);
  box([-.2,.75,.12],[.4,.09,.4]);box([.14,1.24,-.1],[.43,.1,.43],cream);part('cylinder',[.29,1.05,.12],[.015,.3,.015],wood);ball([.29,.89,.12],[.09,.09,.09]);
 }
 if(type==='shelf'){
  for(const x of [-.3,.3])box([x,.6,0],[.05,1.2,.3],wood);
  box([0,.6,-.135],[.6,1.2,.03],wood);for(const y of [.035,.42,.8,1.19])box([0,y,0],[.65,.05,.3],wood);
  for(let n=0;n<4;n++)box([-.2+n*.09,.96,0],[.065,.26,.2],n%2?cream:fabric);
 }else if(type==='dresser'||type==='nightstand'){
  const small=type==='nightstand',w=small?.4:.8,h=small?.5:.85,d=small?.35:.4;
  box([0,h/2,0],[w,h,d],wood);for(let n=0;n<(small?2:3);n++){const y=.12+n*(small?.23:.27);box([0,y,d/2+.006],[w-.045,small?.19:.23,.025],cream);box([0,y,d/2+.032],[w*.25,.025,.035],wood);}
 }else if(type==='clothesRack'){
  for(const x of [-.42,.42]){box([x,.035,0],[.07,.07,.45],wood);box([x,.76,0],[.045,1.45,.045],wood);}box([0,1.48,0],[.9,.045,.045],wood);box([0,.17,0],[.83,.05,.4],wood);
  for(const x of [-.21,0,.21]){box([x,1.13,0],[.17,.48,.09],fabric);box([x,1.38,0],[.23,.05,.1],cream);}
 }else if(type==='cart'){
  for(const x of [-.19,.19])for(const z of [-.12,.12]){box([x,.39,z],[.035,.7,.035],wood);ball([x,.035,z],[.06,.07,.06],'#48564c');}
  for(const y of [.12,.4,.69]){box([0,y,0],[.45,.07,.3]);for(const z of [-.14,.14])box([0,y+.05,z],[.45,.09,.025]);}
 }else if(type==='ottoman'){
  box([0,.19,0],[.39,.38,.39]);box([0,.4,0],[.42,.09,.42],cream);box([0,.28,.2],[.09,.025,.02],wood);
 }else if(type==='floorChair'){
  box([0,.1,.06],[.5,.2,.55]);box([0,.36,-.23],[.5,.55,.17]);box([0,.36,-.13],[.4,.32,.06],cream);
 }else if(type==='singleBed'){
  for(const q of furnitureParts('bed',color)){q.pos[0]*=.64;q.size[0]*=.64;parts.push(q);}
 }else if(type==='fridge'){
  box([0,.76,0],[.55,1.52,.6],cream);for(const [y,h] of [[.47,.87],[1.23,.5]]){box([0,y,.31],[.53,h,.035]);box([-.18,y,.34],[.03,.22,.045],wood);}
 }else if(type==='washer'){
  box([0,.43,0],[.6,.86,.65],cream);box([0,.89,0],[.59,.07,.63]);box([0,.93,.07],[.43,.025,.38],'#829eac');box([0,.935,-.23],[.42,.025,.07],'#48564c');for(const x of [-.14,-.08,.13])ball([x,.952,-.23],[.025,.014,.025],cream);
 }else if(type==='officeChair'){
  part('cylinder',[0,.28,0],[.07,.45,.07],wood);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;box([Math.cos(a)*.14,.08,Math.sin(a)*.14],[.32,.045,.05],wood).setLocalEulerAngles(0,-i*72,0);ball([Math.cos(a)*.27,.05,Math.sin(a)*.27],[.075,.08,.075],'#48564c');}
  box([0,.5,0],[.56,.15,.53]);box([0,.86,-.24],[.5,.63,.13]);for(const x of [-.3,.3]){box([x,.65,0],[.055,.28,.055],wood);box([x,.78,0],[.08,.045,.36],wood);}
 }else if(type==='roundTable'){
  part('cylinder',[0,.75,0],[.85,.1,.85],wood);part('cylinder',[0,.38,0],[.13,.7,.13],wood);part('cylinder',[0,.035,0],[.5,.07,.5],wood);
 }

 return parts;
}
export function makeFurniture(pc,item,device){
 const root=new pc.Entity(item.id);
 const mat=hex=>{if(materialCache.has(hex))return materialCache.get(hex);const m=new pc.StandardMaterial();m.diffuse=new pc.Color().fromString(hex);m.roughness=.8;m.useMetalness=true;m.metalness=0;applyClay(m);materialCache.set(hex,m);return m;};
 for(const p of furnitureParts(item.type,item.color)){const e=new pc.Entity();
  if(p.type==='box')e.addComponent('render',{meshInstances:[new pc.MeshInstance(roundedMesh(pc,device,p.size),mat(p.material))],castShadows:true});
  else{e.addComponent('render',{type:p.type,material:mat(p.material),castShadows:true});e.setLocalScale(...p.size);}
  e.setLocalPosition(...p.pos);e.setLocalEulerAngles(...p.rotation);root.addChild(e);
 }
 root.setPosition(item.x,0,item.z);root.setEulerAngles(0,item.r,0);return root;
}
export function icon(type,color='#789b87'){
 const shapes={sofa:'<rect x="11" y="18" width="58" height="22" rx="5"/><rect x="15" y="6" width="50" height="23" rx="7"/><path d="M8 23v13h64V23M19 41v5m42-5v5"/>',bed:'<rect x="15" y="5" width="50" height="38" rx="3"/><path d="M16 23h48M20 13h16m8 0h15"/>',table:'<path d="M14 22v24m50-24v24"/><rect x="6" y="13" width="68" height="11" rx="3"/>',chair:'<rect x="23" y="4" width="34" height="24" rx="4"/><path d="M23 30h34M26 30v15m28-15v15"/>',plant:'<path d="M30 29h22l-4 16H34z"/><ellipse cx="40" cy="16" rx="18" ry="16"/>',rug:'<path d="M10 9h60v33H10z"/><path d="M16 14h48v23H16z"/>'};
 Object.assign(shapes,{
 lamp:'<path d="M40 22v22M28 45h24M29 5h22l8 19H21z"/>',
 desk:'<rect x="9" y="15" width="62" height="8" rx="3"/><path d="M15 24v21m50-21v21M50 24v12h16M55 29h6"/>',
 coffeeTable:'<rect x="12" y="22" width="56" height="9" rx="5"/><path d="M20 31v13m40-13v13M20 39h40"/>',
 tv:'<rect x="13" y="4" width="54" height="29" rx="4"/><path d="M40 33v6M10 41h60M15 41v5m50-5v5"/>',
 catTree:'<path d="M13 46h55M24 43V23m32 20V10M13 22h26M44 9h24"/><rect x="30" y="29" width="20" height="15" rx="4"/>',
 shelf:'<rect x="22" y="3" width="36" height="43" rx="2"/><path d="M23 17h34M23 32h34M29 5v11m8-11v11"/>',
 dresser:'<rect x="16" y="6" width="48" height="39" rx="3"/><path d="M17 19h46M17 32h46M35 13h10m-10 13h10m-10 13h10"/>',
 nightstand:'<rect x="23" y="16" width="34" height="27" rx="3"/><path d="M24 30h32M36 24h8m-8 12h8"/>',
 clothesRack:'<path d="M15 46V6h50v40M10 46h12m36 0h12M27 8v7l-6 7h20l-7-7V8"/>',
 cart:'<path d="M20 9h40v34H20zM20 20h40M20 32h40"/><circle cx="24" cy="46" r="2"/><circle cx="56" cy="46" r="2"/>',
 ottoman:'<rect x="22" y="17" width="36" height="28" rx="5"/><path d="M22 24h36M36 33h8"/>',
 floorChair:'<path d="M22 36V9q18-8 36 0v27z"/><rect x="19" y="32" width="42" height="13" rx="5"/>',
 singleBed:shapes.bed,
 fridge:'<rect x="24" y="3" width="32" height="44" rx="4"/><path d="M24 20h32M30 9v6m0 11v10"/>',
 washer:'<rect x="20" y="7" width="40" height="39" rx="4"/><path d="M21 17h38M29 11h5"/><ellipse cx="40" cy="30" rx="12" ry="10"/>',
 officeChair:'<rect x="26" y="3" width="28" height="24" rx="5"/><path d="M20 28h40M40 29v13m-17 4 17-4 17 4M20 21v12m40-12v12"/>',
 roundTable:'<ellipse cx="40" cy="17" rx="25" ry="10"/><path d="M40 27v17M27 46h26"/>'

 });
 return `<svg viewBox="0 0 80 50" fill="${color}" stroke="#496857" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[type]}</svg>`;
}
