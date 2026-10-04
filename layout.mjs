import {DEFAULT_BOUNDS} from './rooms.mjs';
export const CATALOG={sofa:{name:'沙发',size:[2.1,.9]},bed:{name:'床',size:[1.6,2.1]},table:{name:'餐桌',size:[1.5,.9]},chair:{name:'椅子',size:[.6,.6]},plant:{name:'绿植',size:[.6,.6]},rug:{name:'地毯',size:[2.5,1.7]}};
Object.assign(CATALOG,{lamp:{name:'落地灯',size:[.5,.5]},desk:{name:'办公桌',size:[1.2,.6]},coffeeTable:{name:'茶几',size:[1,.55]},tv:{name:'电视',size:[1.25,.4]},catTree:{name:'猫树',size:[.7,.65]}});
Object.assign(CATALOG,{"shelf": {"name": "书架", "size": [0.65, 0.3]}, "dresser": {"name": "抽屉柜", "size": [0.8, 0.4]}, "clothesRack": {"name": "衣架", "size": [0.9, 0.45]}, "cart": {"name": "收纳推车", "size": [0.45, 0.3]}, "ottoman": {"name": "收纳凳", "size": [0.4, 0.4]}, "floorChair": {"name": "座椅", "size": [0.5, 0.65]}, "singleBed": {"name": "单人床", "size": [1.05, 2.12]}, "fridge": {"name": "冰箱", "size": [0.55, 0.62]}, "washer": {"name": "洗衣机", "size": [0.6, 0.65]}, "officeChair": {"name": "办公椅", "size": [0.65, 0.65]}, "nightstand": {"name": "床头柜", "size": [0.4, 0.35]}, "roundTable": {"name": "双人圆桌", "size": [0.85, 0.85]}});
export const COLORS=['#52a3a0','#e58a6c','#e9b958','#809bc9'];
// Starting arrangement for the synthetic practice room (see rooms.mjs).
export const DEFAULT_LAYOUT=[{id:'s1',type:'sofa',x:-.6,z:-1.5,r:0,color:0},{id:'r1',type:'rug',x:-.6,z:-.3,r:0,color:1},{id:'t1',type:'table',x:1.5,z:.7,r:0,color:2},{id:'c1',type:'chair',x:1.5,z:-.2,r:0,color:3},{id:'c2',type:'chair',x:1.5,z:1.6,r:180,color:3},{id:'p1',type:'plant',x:2.3,z:-1.55,r:0,color:0}];
export function validate(items,bounds=DEFAULT_BOUNDS){
 if(!Array.isArray(items)||items.length>80)throw Error('家具数量不正确');
 const ids=new Set();return items.map(i=>{
 if(!i||!Object.hasOwn(CATALOG,i.type)||typeof i.id!=='string'||!/^[-a-zA-Z0-9]{1,40}$/.test(i.id)||ids.has(i.id)||!Number.isFinite(i.x)||i.x<bounds.min[0]||i.x>bounds.max[0]||!Number.isFinite(i.z)||i.z<bounds.min[2]||i.z>bounds.max[2]||!Number.isFinite(i.r)||i.r<0||i.r>=360||!Number.isInteger(i.color)||i.color<0||i.color>=COLORS.length)throw Error('布局内容不正确');
 if(i.level!==undefined&&(!Number.isInteger(i.level)||!bounds.levels?.some(l=>l.id===i.level)))throw Error('Invalid floor');
 ids.add(i.id);return {id:i.id,type:i.type,x:i.x,z:i.z,r:i.r,color:i.color,...(i.level===undefined?{}:{level:i.level})};});
}
export function encodeLayout(items,bounds=DEFAULT_BOUNDS){return btoa(JSON.stringify({v:1,items:validate(items,bounds)})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeLayout(s,bounds=DEFAULT_BOUNDS){if(typeof s!=='string'||s.length>20000||!/^[-\w]+$/.test(s))throw Error('布局链接不完整');const d=JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/')));if(d.v!==1)throw Error('布局版本不支持');return validate(d.items,bounds);}
export function moveItem(items,id,x,z,bounds=DEFAULT_BOUNDS){const snap=n=>Math.round(n*20)/20;return items.map(i=>i.id===id?{...i,x:Math.max(bounds.min[0],Math.min(bounds.max[0],snap(x))),z:Math.max(bounds.min[2],Math.min(bounds.max[2],snap(z)))}:i);}
export function rotateItem(items,id,angle){return items.map(i=>i.id===id?{...i,r:((i.r+angle)%360+360)%360}:i);}

export const CATALOG_GROUPS={Common:['sofa','bed','table','chair','plant','rug','desk','lamp'],Living:['sofa','coffeeTable','roundTable','table','chair','tv','lamp','rug','plant','floorChair','ottoman'],Bedroom:['bed','singleBed','nightstand','dresser','clothesRack'],Work:['desk','officeChair','shelf'],Storage:['shelf','dresser','clothesRack','cart','ottoman','nightstand'],Appliances:['fridge','washer','tv'],Pets:['catTree']};
