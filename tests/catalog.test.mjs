import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG,encodeLayout,decodeLayout} from '../layout.mjs';
import {furnitureParts,icon} from '../furniture.mjs';
import {locales,setLocale,itemName} from '../i18n.mjs';
const types=['lamp','desk','coffeeTable','tv','catTree','shelf','dresser','clothesRack','cart','ottoman','floorChair','singleBed','fridge','washer','officeChair','nightstand','roundTable'];
test('new furniture has geometry, icons, six labels and survives sharing',()=>{
 const items=types.map((type,n)=>({id:'new'+n,type,x:1,z:-.5,r:90,color:2}));
 for(const type of types){assert.ok(CATALOG[type],type);assert.ok(furnitureParts(type).length>2,type);assert.ok(!icon(type).includes('undefined'));for(const lang of locales){setLocale(lang);assert.ok(itemName(type).length>0);}}
 assert.deepEqual(decodeLayout(encodeLayout(items)),items);
});
import {checkPlacement} from '../collision.mjs';
test('new furniture blocks an intersecting copy but allows a separated copy',()=>{
 const room={floors:[{x:5,z:-3,hx:10,hz:10}],solids:[],doors:[]};
 for(const type of types){const a={id:'a',type,x:4,z:-3,r:0,color:0};assert.equal(checkPlacement(a,[{...a,id:'b'}],room).valid,false,type);assert.equal(checkPlacement(a,[{...a,id:'b',x:7}],room).valid,true,type);}
});
test('catalog hides niche items by default and removed instruments stay absent',async()=>{
 const {CATALOG_GROUPS}=await import('../layout.mjs');assert.ok(CATALOG_GROUPS?.Common);assert.ok(!CATALOG_GROUPS.Common.includes('catTree'));assert.ok(CATALOG_GROUPS.Pets.includes('catTree'));assert.ok(!CATALOG.keyboard&&!CATALOG.guitar);
 const grouped=new Set(Object.values(CATALOG_GROUPS).flat());for(const type of Object.keys(CATALOG))assert.ok(grouped.has(type),type);
});
