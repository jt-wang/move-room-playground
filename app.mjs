import {setupRoomPicker} from './room-picker.mjs';
import {levelVisible,elevation,itemLevel,itemVisible} from './levels.mjs';
import {doorLabel} from './door-label.mjs';
import {resolveRoom,roomConfig,layoutKey,DEFAULT_ROOM,fitDistance} from './rooms.mjs';
import {createTelemetry,browserAllowsTelemetry,privacySignalsAllow,detectVisit} from './telemetry.mjs';
import {loadSharedRoom} from './share-client.mjs';
import {checkPlacement,findSpace,captureRoomCollision,boxesOverlap,furnitureVolumes} from './collision.mjs';
import {createDoors} from './doors.mjs';
import {t,itemName,setLocale,getLocale} from './i18n.mjs';
import {localizeUI} from './localize-ui.mjs';
import {CATALOG,CATALOG_GROUPS,COLORS,DEFAULT_LAYOUT,decodeLayout,encodeLayout,moveItem,rotateItem} from './layout.mjs';
import {makeFurniture,icon} from './furniture.mjs';
import {screenStep,snapRotation,BRIEFS,objectiveProgress} from './controls.mjs';
import {loadClay,applyClay} from './clay.mjs';
import {roundedMesh} from './rounded.mjs';
let sharedRoom=null,entryError=false,roomID=resolveRoom();
try{const params=new URLSearchParams(location.search);if(params.has('s'))sharedRoom=await loadSharedRoom(params.get('s'));roomID=resolveRoom(sharedRoom?.room??(sharedRoom?DEFAULT_ROOM:params.get('room')));}catch{entryError=true;}
const config=roomConfig(roomID),roomBounds=config.bounds;
const $=s=>document.querySelector(s),canvas=$('#view'),pc=window.pc;
if(config.imported)$('#share').hidden=true;
let doorController,placedOnce=false,collisionRoom,previewItem=null,previewResult=null,allowOverlap=false;
let items=structuredClone(roomID===DEFAULT_ROOM?DEFAULT_LAYOUT:[]),selected=null,undoStack=[],entities=new Map(),ready=false,hiddenWalls=false,app,camera,room,meta,drag=null,pointers=new Map(),pinch=0;
let yaw=0,pitch=1.06,distance=15,toastTimer;
let mode="place",briefIndex=0,briefWasComplete=false,soundEnabled=false,audioContext,gesture=null;
const pops=new Map(),reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
const target={x:config.center[0],y:config.center[1],z:config.center[2]},storageKey=layoutKey(roomID);
function toast(text){$('#toast').textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',3200);}
try{setLocale(localStorage.getItem('move-demo:language')||navigator.language);placedOnce=localStorage.getItem('move-demo:did-place')==='1';allowOverlap=localStorage.getItem('move-demo:overlap')==='1';}catch{setLocale(navigator.language);}
const refreshRoomPicker=setupRoomPicker(roomID,getLocale);
localizeUI();$('#loading').textContent=t('loading');
let telemetryDisabled=!browserAllowsTelemetry();
const viaShare=new URLSearchParams(location.search).has('s');
const visitKind=telemetryDisabled?'unknown':detectVisit();
const openedAt=performance.now(),track=createTelemetry({allowed:()=>!telemetryDisabled&&privacySignalsAllow(),locale:getLocale,device:()=>innerWidth<760?'mobile':'desktop',entry:()=>viaShare?'share':'direct',visit:()=>visitKind,send:body=>{fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});}});
track('page_open');window.addEventListener('error',()=>track('client_error'));window.addEventListener('unhandledrejection',()=>track('client_error'));

let initialError=entryError,shareStatus='shareDesc';
let rotationGesture=null;const canceledRotationPointers=new Set();
let activeLevel='all',levelSelect=null,frameConfig=config,transfer=null,rotationDraft=null;
const multilevel=!!config.bounds.levels?.length;
const itemY=item=>elevation(item,config.bounds.levels);
const editingItems=()=>{const draft=rotationDraft??transfer;return draft?items.map(i=>i.id===draft.id?draft:i):items;};
function refreshLevelUI(){
 if(!levelSelect)return;
 for(const button of levelSelect.children){const value=button.dataset.level;button.textContent=value==='all'?t('allFloors'):t('floorNumber',{n:Number(value)+1});button.setAttribute('aria-pressed',String(value===String(activeLevel)));}
 levelSelect.setAttribute('aria-label',t('floorSelect'));
 const select=$('#move-floor');select.replaceChildren(new Option(t('moveFloor'),''),...meta.levels.filter(l=>l.id!==activeLevel).map(l=>new Option(t('floorNumber',{n:l.id+1}),String(l.id))));
 select.setAttribute('aria-label',t('moveFloor'));$('#cancel-transfer').textContent=t('cancelTransfer');
 select.hidden=!selected||!!transfer;$('#cancel-transfer').hidden=!transfer;$('#duplicate').disabled=!!transfer||!!rotationDraft;for(const b of $('#swatches').children)b.disabled=!!transfer;
 $('#catalog').closest('.catalog-section')?.classList.toggle('overview',activeLevel==='all');
 for(const b of $('#catalog').children)b.disabled=activeLevel==='all';
 if(activeLevel==='all'){$('#guide-heading').textContent=t('allFloors');$('#guide-body').textContent=t('chooseFloor');}
 if(transfer)$('#guide-body').textContent=t('transferPreview');
 $('.challenge').hidden=true;
 if(!meta.doors?.length){$('.door-controls').hidden=true;$('.mobile-door-menu').hidden=true;}
}
function applyVisibility(reframe=true){
 const boxes=[];
 for(const g of meta?.groups??[]){const entity=room?.findByName(g.name);if(entity){entity.enabled=levelVisible(g,activeLevel,hiddenWalls);if(entity.enabled&&multilevel)for(const r of entity.findComponents('render'))for(const mi of r.meshInstances)boxes.push(mi.aabb);}}
 for(const i of editingItems()){const e=entities.get(i.id);if(e)e.enabled=itemVisible(i,activeLevel);}
 if(reframe&&multilevel&&boxes.length){const min=[0,1,2].map((_,axis)=>Math.min(...boxes.map(b=>b.center[['x','y','z'][axis]]-b.halfExtents[['x','y','z'][axis]]))),max=[0,1,2].map((_,axis)=>Math.max(...boxes.map(b=>b.center[['x','y','z'][axis]]+b.halfExtents[['x','y','z'][axis]])));frameConfig={...config,bounds:{min,max}};[target.x,target.y,target.z]=min.map((v,i)=>(v+max[i])/2);home();}
}
function switchLevel(value){if(pointers.size)return;rotationDraft=null;transfer=null;drag=null;gesture=null;selected=null;pops.clear();activeLevel=value;sync();applyVisibility();}
function cancelTransfer(){if(!transfer)return;const original=items.find(i=>i.id===transfer.id);transfer=null;activeLevel=itemLevel(original);sync();applyVisibility();}
function startTransfer(level){
 rotationDraft=null;
 const original=items.find(i=>i.id===selected);if(!original||pointers.size)return;
 const candidate=findSpace({...original,level},items,collisionRoom,allowOverlap,roomBounds);
 if(!candidate){$('#move-floor').value='';return toast(t('noPlacementSpace'));}
 transfer=candidate;activeLevel=level;pops.delete(original.id);sync();applyVisibility();
}
try{if(entryError)throw Error();if(sharedRoom){items=decodeLayout(sharedRoom.layout,roomBounds);track('share_opened');}else if(location.hash.startsWith('#layout='))items=decodeLayout(location.hash.slice(8),roomBounds);else if(location.hash)throw Error(t('invalidLayout'));else {const saved=localStorage.getItem(storageKey);if(saved)items=decodeLayout(saved,roomBounds);}}catch(e){initialError=true;track(new URLSearchParams(location.search).has('s')||location.hash.startsWith('#layout=')?'share_failed':'client_error');}
if(config.viewOnly)items=[];
function remember(){undoStack.push(structuredClone(items));if(undoStack.length>50)undoStack.shift();}
function persist(){try{localStorage.setItem(storageKey,encodeLayout(items,roomBounds));}catch{toast(t('saveFailed'));}}
function sync(){
 previewItem=rotationDraft??transfer;previewResult=null;
 for(const e of entities.values())e.destroy();entities.clear();
 for(const item of editingItems()){const e=makeFurniture(pc,item,app.graphicsDevice);e.setPosition(item.x,itemY(item),item.z);e.enabled=itemVisible(item,activeLevel);app.root.addChild(e);entities.set(item.id,e);}
 if(!items.some(i=>i.id===selected))selected=null;
 $('#count').textContent=t('count',{n:items.length});$('#undo').disabled=!undoStack.length&&!rotationDraft;$('#clear').disabled=!items.length;
 const i=editingItems().find(i=>i.id===selected);$('.selection').hidden=!i;$('.challenge').hidden=!placedOnce;$('#guide-heading').textContent=t(i?'guidePlace':placedOnce?'guideContinue':'guideStart');$('#guide-body').textContent=t(i?'guidePlaceBody':placedOnce?'guideContinueBody':'guideStartBody');$('#selected-name').textContent=i?itemName(i.type):t('selectFurniture');$('#angle').textContent=i?i.r+'°':'';$('#edit-controls').hidden=!i;$('#selection-help').hidden=!!i;
 for(const b of $('#swatches').children)b.setAttribute('aria-pressed',String(i?.color===Number(b.dataset.color)));
 $('#placement-dock').hidden=!i||mode!=='place';$('#dock-name').textContent=i?itemName(i.type):'';
 $('#cancel-placement').hidden=!rotationDraft;$('#cancel-placement').textContent=t('cancelPlacement');$('#duplicate').disabled=!!transfer||!!rotationDraft;$('#object-delete').hidden=true;updateBrief();persist();updatePlacementFeedback();refreshLevelUI();
}
function placementResult(item){return collisionRoom?checkPlacement(item,items,collisionRoom,allowOverlap):{valid:true,reason:'',doors:[]};}
function updatePlacementFeedback(result){
 const item=previewItem??items.find(i=>i.id===selected);previewResult=result??(item?placementResult(item):null);
 const node=$('#placement-status');node.hidden=!item;node.dataset.state=!previewResult?.valid?'invalid':previewResult.doors.length?'warning':'valid';
 const message=!item?'':!previewResult.valid?t('collision'+previewResult.reason):previewResult.doors.length?t('doorClearance',{names:previewResult.doors.map(id=>doorLabel(t,meta.doors.find(d=>d.id===id)||{id})).join('、')}):t('placementClear');
 if(node.textContent!==message)node.textContent=message;
}
function showPreview(candidate){if(rotationDraft)rotationDraft=candidate;previewItem=candidate;pops.delete(candidate.id);const entity=entities.get(candidate.id);entity?.setLocalScale(1,1,1);entity?.setPosition(candidate.x,itemY(candidate),candidate.z);entity?.setEulerAngles(0,candidate.r,0);updatePlacementFeedback(placementResult(candidate));}
function cancelPreview(){previewItem=null;sync();}
function cancelRotation(){rotationDraft=null;previewItem=null;sync();}
$('#cancel-placement').onclick=()=>{cancelRotation();selected=null;sync();};
function placeCandidate(candidate){
 if(rotationDraft){showPreview(candidate);return true;}
 const result=placementResult(candidate);if(!result.valid){cancelPreview();toast(t('collision'+result.reason));return false;}
 if(transfer){transfer=candidate;sync();return true;}
 const previous=items.find(i=>i.id===candidate.id);
 if(previous&&(previous.x!==candidate.x||previous.z!==candidate.z||previous.r!==candidate.r)){commit(a=>a.map(i=>i.id===candidate.id?candidate:i));track('first_placement');}else cancelPreview();
 if(result.doors.length)toast(t('doorClearance',{names:result.doors.map(id=>doorLabel(t,meta.doors.find(d=>d.id===id)||{id})).join('、')}));pop(candidate.id);return true;
}
$('#allow-overlap').checked=allowOverlap;$('#allow-overlap').onchange=e=>{allowOverlap=e.target.checked;try{localStorage.setItem('move-demo:overlap',allowOverlap?'1':'0');}catch{}updatePlacementFeedback();};
function commit(fn){rotationDraft=null;transfer=null;remember();items=fn(items);sync();}
function id(){return crypto.randomUUID().slice(0,12);}
function add(type){if(!ready||config.viewOnly)return;if(multilevel&&activeLevel==='all')return toast(t('chooseFloor'));transfer=null;if(items.length>=80)return toast(t('full'));const k=items.length%6;let item={id:id(),type,x:target.x+(k%3-1)*.5,z:target.z+Math.floor(k/3)*.5,r:0,color:0,...(multilevel?{level:activeLevel}:{})};item=findSpace(item,items,collisionRoom,allowOverlap,roomBounds);if(!item)return toast(t('noPlacementSpace'));commit(a=>[...a,item]);track('first_placement');selected=item.id;setMode('place');sync();pop(item.id);if(innerWidth<760)$('.stage').scrollIntoView({block:'start',behavior:reducedMotion?'auto':'smooth'});toast(t('picked',{name:itemName(type)}));}
for(const [type,v] of Object.entries(CATALOG)){const b=document.createElement('button');b.className='furniture-card';b.dataset.type=type;b.setAttribute('aria-label',t('add',{name:itemName(type)}));b.innerHTML=icon(type)+`<span>${itemName(type)}</span>`;b.onclick=()=>add(type);$('#catalog').append(b);}
const categorySelect=$('#catalog-category');
for(const group of [...Object.keys(CATALOG_GROUPS),'All']){const option=document.createElement('option');option.value=group;option.textContent=t('category'+group);categorySelect.append(option);}
function filterCatalog(){const members=CATALOG_GROUPS[categorySelect.value];for(const b of $('#catalog').children)b.hidden=!!members&&!members.includes(b.dataset.type);$('#catalog').scrollTop=0;}
categorySelect.onchange=filterCatalog;filterCatalog();
COLORS.forEach((color,index)=>{const b=document.createElement('button');b.style.background=color;b.dataset.color=index;b.setAttribute('aria-label',t('color'+index));b.onclick=()=>{if(!selected)return;if(rotationDraft){rotationDraft={...rotationDraft,color:index};sync();return;}commit(a=>a.map(i=>i.id===selected?{...i,color:index}:i));};$('#swatches').append(b);});

function refreshLanguage(){
 refreshRoomPicker();
 localizeUI();doorController?.refresh();$('#object-delete span').textContent=t('remove');$('#object-delete').setAttribute('aria-label',t('remove'));$('#category-label').textContent=t('furnitureCategory');for(const o of categorySelect.options)o.textContent=t('category'+o.value);
 for(const b of $('#catalog').children){const name=itemName(b.dataset.type);b.setAttribute('aria-label',t('add',{name}));b.querySelector('span').textContent=name;}
 for(const b of $('#swatches').children)b.setAttribute('aria-label',t('color'+b.dataset.color));
 $('#hint').textContent=t(config.viewOnly?'floorHint':hintKey());$('#sound').textContent=t(soundEnabled?'soundOn':'soundOff');
 $('#share-result').textContent=t(shareStatus);if(!ready)$('#loading').textContent=t('loading');
 if(ready)sync();refreshLevelUI();toast('');
}
$('#language').onchange=e=>{setLocale(e.target.value);try{localStorage.setItem('move-demo:language',getLocale());}catch{}refreshLanguage();};

function rotate(angle){if(!selected||pointers.size)return;const candidate=rotateItem(editingItems(),selected,angle).find(i=>i.id===selected);if(transfer){transfer=candidate;sync();return;}rotationDraft=candidate;pops.delete(selected);toast('');sync();}
$('#rotate-left').onclick=()=>rotate(-15);$('#rotate-right').onclick=()=>rotate(15);
function removeSelected(){if(!selected||pointers.size)return;const id=selected;previewItem=null;drag=null;gesture=null;commit(a=>a.filter(i=>i.id!==id));$('#object-delete').hidden=true;}
$('#delete').onclick=removeSelected;$('#object-delete').onclick=removeSelected;
$('#duplicate').onclick=()=>{const i=items.find(i=>i.id===selected);if(!i||items.length>=80)return;const newId=id(),copy=findSpace({...i,id:newId,x:i.x+.35,z:i.z+.35},items,collisionRoom,allowOverlap,roomBounds);if(!copy)return toast(t('noPlacementSpace'));commit(a=>[...a,copy]);selected=newId;sync();};
$('#undo').onclick=()=>{if(rotationDraft){cancelRotation();return;}if(undoStack.length){transfer=null;selected=null;items=undoStack.pop();sync();toast(t('undone'));}};
$('#clear').onclick=()=>{commit(()=>[]);toast(t('cleared'));};
// Rooms without movable doors or windows must not advertise them.
function hintKey(){return !meta?.doors?.length?'hintOrbit':mode==='place'?'hintPlace':'hintLook';}
function setMode(value){mode=value;$('#mode-place').setAttribute('aria-pressed',String(mode==='place'));$('#mode-look').setAttribute('aria-pressed',String(mode==='look'));$('#hint').textContent=t(hintKey());sync();}
$('#mode-place').onclick=()=>setMode('place');$('#mode-look').onclick=()=>setMode('look');
$('#place-done').onclick=()=>{if(rotationDraft){const candidate=rotationDraft,result=placementResult(candidate);if(!result.valid){updatePlacementFeedback(result);return;}const original=items.find(i=>i.id===candidate.id);if(['x','z','r','color','level'].some(k=>original[k]!==candidate[k]))commit(a=>a.map(i=>i.id===candidate.id?candidate:i));else cancelRotation();}if(transfer){const candidate=transfer;if(!placementResult(candidate).valid)return toast(t('noPlacementSpace'));transfer=null;commit(a=>a.map(i=>i.id===candidate.id?candidate:i));}if(previewItem&&!placeCandidate(previewItem))return;if(selected){const result=placementResult(items.find(i=>i.id===selected));if(result.doors.length)toast(t('doorClearance',{names:result.doors.map(id=>doorLabel(t,meta.doors.find(d=>d.id===id)||{id})).join('、')}));pop(selected);placedOnce=true;try{localStorage.setItem('move-demo:did-place','1');}catch{}}selected=null;sync();};
for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>{if(!selected)return;const v=screenStep(b.dataset.step,yaw),i=editingItems().find(i=>i.id===selected);placeCandidate(moveItem(editingItems(),selected,i.x+v.x,i.z+v.z,roomBounds).find(i=>i.id===selected));};
$('#dock-rotate-left').onclick=()=>{rotate(-90);};$('#dock-rotate-right').onclick=()=>{rotate(90);};
function ping(){if(!soundEnabled)return;try{audioContext??=new AudioContext();audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.setValueAtTime(620,audioContext.currentTime);o.frequency.exponentialRampToValueAtTime(340,audioContext.currentTime+.1);g.gain.setValueAtTime(.06,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.14);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.15);}catch{}}
$('#sound').onclick=()=>{soundEnabled=!soundEnabled;$('#sound').textContent=soundEnabled?t('soundOn'):t('soundOff');$('#sound').setAttribute('aria-pressed',String(soundEnabled));ping();};
function pop(id){if(!id||transfer||rotationDraft)return;if(!reducedMotion)pops.set(id,0);ping();}
function animate(dt){for(const [id,t] of pops){const e=entities.get(id),next=t+Math.min(dt,.05);if(!e||next>.42){if(e){e.setLocalScale(1,1,1);e.setPosition(e.getPosition().x,itemY(items.find(i=>i.id===id)??{}),e.getPosition().z);}pops.delete(id);continue;}pops.set(id,next);const bounce=Math.sin(next/.42*Math.PI);e.setLocalScale(1-.035*bounce,1+.07*bounce,1-.035*bounce);e.setPosition(e.getPosition().x,itemY(items.find(i=>i.id===id)??{})+.12*bounce,e.getPosition().z);}}
function updateBrief(){const b=BRIEFS[briefIndex],progress=objectiveProgress(items,b.needs);$('#brief-name').textContent=t('brief'+briefIndex+'Name');$('#brief-text').textContent=t('brief'+briefIndex+'Text');$('#brief-parts').textContent=progress.parts.map(p=>`${itemName(p.type)} ${p.have}/${p.need}`).join(' · ');$('#brief-bar').style.width=100*progress.done/progress.total+'%';$('#brief-status').textContent=progress.complete?t('briefComplete'):t('briefProgress',{done:progress.done,total:progress.total});$('.brief').classList.toggle('complete',progress.complete);if(progress.complete&&!briefWasComplete&&$('.challenge').open){toast(t('briefToast'));for(const i of items)pop(i.id);}briefWasComplete=progress.complete;}
$('#next-brief').onclick=()=>{briefIndex=(briefIndex+1)%BRIEFS.length;briefWasComplete=false;updateBrief();};
function cameraUpdate(){if(!camera)return;camera.setPosition(target.x+distance*Math.cos(pitch)*Math.sin(yaw),target.y+distance*Math.sin(pitch),target.z+distance*Math.cos(pitch)*Math.cos(yaw));camera.lookAt(target.x,target.y,target.z);}
function zoom(f){distance=Math.max(config.minDistance,Math.min(config.maxDistance,distance*f));cameraUpdate();}
function home(){yaw=0;pitch=1.06;distance=fitDistance(frameConfig,canvas.clientWidth/canvas.clientHeight,camera.camera.horizontalFov,camera.camera.fov);cameraUpdate();}
$('#camera-left').onclick=()=>{yaw-=Math.PI/2;cameraUpdate();};$('#camera-right').onclick=()=>{yaw+=Math.PI/2;cameraUpdate();};
$('#home').onclick=home;$('#top').onclick=()=>{pitch=1.565;yaw=0;cameraUpdate();};$('#zoom-in').onclick=()=>zoom(.85);$('#zoom-out').onclick=()=>zoom(1/.85);
$('#walls').onclick=()=>{hiddenWalls=!hiddenWalls;applyVisibility();$('#walls').setAttribute('aria-pressed',String(hiddenWalls));};
function screenRay(x,y){const bounds=canvas.getBoundingClientRect();const a=camera.camera.screenToWorld(x-bounds.left,y-bounds.top,.05),b=camera.camera.screenToWorld(x-bounds.left,y-bounds.top,100);return new pc.Ray(a,b.sub(a).normalize());}
function ground(ray){if(Math.abs(ray.direction.y)<.0001)return null;const t=(elevation({level:activeLevel},config.bounds.levels)-ray.origin.y)/ray.direction.y;if(t<=0)return null;return ray.origin.clone().add(ray.direction.clone().mulScalar(t));}
function pick(ray){let best=null,dist=Infinity;for(const [id,e] of entities)if(e.enabled)for(const r of e.findComponents('render'))for(const mi of r.meshInstances){const point=new pc.Vec3();if(mi.aabb.intersectsRay(ray,point)){const d=point.distance(ray.origin);if(d<dist){best=id;dist=d;}}}return best;}
// Project the selected mesh bounds each frame so the action follows orbit, zoom and resize.
function updateObjectDelete(){
 updateRotationHandle();
 const button=$('#object-delete'),entity=entities.get(selected);
 if(!ready||!entity||rotationGesture||pointers.size||previewItem||pops.has(selected)){button.hidden=true;return;}
 const viewport=$('.viewport'),width=viewport.clientWidth,height=viewport.clientHeight;
 let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
 for(const r of entity.findComponents('render'))for(const mi of r.meshInstances){const a=mi.aabb;for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const q=camera.camera.worldToScreen(new pc.Vec3(a.center.x+x*a.halfExtents.x,a.center.y+y*a.halfExtents.y,a.center.z+z*a.halfExtents.z));if(q.z<=0)continue;left=Math.min(left,q.x);right=Math.max(right,q.x);top=Math.min(top,q.y);bottom=Math.max(bottom,q.y);}}
 if(!Number.isFinite(right)||right<0||left>width||bottom<0||top>height){button.hidden=true;return;}
 button.hidden=false;
 const w=button.offsetWidth,h=button.offsetHeight;
 button.style.left=Math.max(6,Math.min(width-w-6,right+6))+'px';
 button.style.top=Math.max(52,Math.min(height-h-6,top-h-3))+'px';
}
// Keep the rotation control outside the selected mesh; pointer capture owns the gesture.
function updateRotationHandle(){
 const button=$('#object-rotate'),i=editingItems().find(i=>i.id===selected),entity=entities.get(selected);
 if(rotationGesture)return;
 if(!ready||!entity?.enabled||!i||mode!=='place'||pointers.size||drag||pops.has(selected)){button.hidden=true;return;}
 const rect=canvas.getBoundingClientRect(),q=camera.camera.worldToScreen(new pc.Vec3(i.x,itemY(i)+.5,i.z));
 if(q.z<=0||q.x<0||q.x>rect.width||q.y<0||q.y>rect.height){button.hidden=true;return;}
 let left=Infinity,bottom=-Infinity;
 for(const r of entity.findComponents('render'))for(const mi of r.meshInstances){const a=mi.aabb;for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const p=camera.camera.worldToScreen(new pc.Vec3(a.center.x+x*a.halfExtents.x,a.center.y+y*a.halfExtents.y,a.center.z+z*a.halfExtents.z));if(p.z>0){left=Math.min(left,p.x);bottom=Math.max(bottom,p.y);}}}
 button.hidden=false;button.querySelector('span').textContent=Math.round(i.r)+'°';
 const dock=$('#placement-dock').getBoundingClientRect(),limit=dock.width&&dock.top>rect.top?Math.min(rect.height,dock.top-rect.top-6):rect.height;
 button.style.left=Math.max(6,Math.min(rect.width-button.offsetWidth-6,left-button.offsetWidth-6))+'px';
 button.style.top=Math.max(52,Math.min(limit-button.offsetHeight-6,bottom-22))+'px';
}
function endRotationGesture(cancel=false){
 if(!rotationGesture)return;const g=rotationGesture;rotationGesture=null;
 if(cancel){rotationDraft=g.draft;transfer=g.transfer;sync();}
 else if(g.moved)sync();
 const b=$('#object-rotate');if(b.hasPointerCapture(g.pointer))b.releasePointerCapture(g.pointer);
}
const rotationHandle=$('#object-rotate');
rotationHandle.addEventListener('pointerdown',e=>{
 e.preventDefault();e.stopPropagation();if(rotationGesture||pointers.size||!selected)return;
 const i=editingItems().find(i=>i.id===selected),p=ground(screenRay(e.clientX,e.clientY));if(!p)return;
 rotationGesture={pointer:e.pointerId,item:{...i},draft:rotationDraft?{...rotationDraft}:null,transfer:transfer?{...transfer}:null,start:Math.atan2(p.z-i.z,p.x-i.x),moved:false,x:e.clientX,y:e.clientY};
 rotationHandle.setPointerCapture(e.pointerId);$('#object-delete').hidden=true;
});
rotationHandle.addEventListener('pointermove',e=>{
 const g=rotationGesture;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();
 if(!g.moved&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<4)return;
 const p=ground(screenRay(e.clientX,e.clientY));if(!p||Math.hypot(p.x-g.item.x,p.z-g.item.z)<.05)return;
 g.moved=true;const delta=(Math.atan2(p.z-g.item.z,p.x-g.item.x)-g.start)*180/Math.PI;
 const candidate={...g.item,r:snapRotation(g.item.r-delta)};
 if(transfer)transfer=candidate;else rotationDraft=candidate;
 showPreview(candidate);$('#cancel-placement').hidden=!rotationDraft;$('#undo').disabled=false;$('#duplicate').disabled=true;
 rotationHandle.querySelector('span').textContent=candidate.r+'°';$('#angle').textContent=candidate.r+'°';
});
rotationHandle.addEventListener('pointerup',e=>{if(rotationGesture?.pointer===e.pointerId)endRotationGesture();});
rotationHandle.addEventListener('pointercancel',()=>endRotationGesture(true));
rotationHandle.addEventListener('lostpointercapture',()=>endRotationGesture(true));
rotationHandle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();rotate((e.key==='ArrowLeft'||e.key==='ArrowDown'?-1:1)*(e.shiftKey?1:5));}});
// A second finger cancels rotation before the camera receives any input.
window.addEventListener('pointerdown',e=>{if(rotationGesture&&e.pointerId!==rotationGesture.pointer){canceledRotationPointers.add(rotationGesture.pointer);canceledRotationPointers.add(e.pointerId);endRotationGesture(true);}if(canceledRotationPointers.size){canceledRotationPointers.add(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}},true);
for(const event of ['pointermove','pointerup','pointercancel'])window.addEventListener(event,e=>{if(!canceledRotationPointers.has(e.pointerId))return;if(event!=='pointermove')canceledRotationPointers.delete(e.pointerId);e.preventDefault();e.stopImmediatePropagation();},true);
function viewportSignature(){const r=canvas.getBoundingClientRect();return [r.left,r.top,r.width,r.height].join(',');}
function finishDrag(cancel=false){const candidate=previewItem;const changed=drag?.changed,startDraft=drag?.startDraft;drag=null;if(cancel&&startDraft){rotationDraft=startDraft;sync();return;}if(changed&&candidate&&!cancel)placeCandidate(candidate);else if(candidate)cancelPreview();}
canvas.addEventListener('pointerdown',e=>{
 if(!ready)return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pointers.size>1){finishDrag(true);gesture=null;const [a,b]=[...pointers.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);return;}
 const ray=screenRay(e.clientX,e.clientY),door=doorController.hitTest(ray,[...entities.values()].filter(e=>e.enabled)),hit=!door&&mode==='place'?pick(ray):null,p=ground(ray);
 gesture={x:e.clientX,y:e.clientY,moved:false,hit,door};
 if(hit){if(rotationDraft&&hit!==rotationDraft.id)cancelRotation();if(transfer&&hit!==transfer.id)cancelTransfer();selected=hit;const i=editingItems().find(i=>i.id===hit);if(multilevel&&activeLevel==='all'){activeLevel=itemLevel(i);sync();applyVisibility();gesture.moved=true;return;}drag={id:hit,startDraft:rotationDraft?{...rotationDraft}:null,start:{x:i.x,z:i.z},viewport:viewportSignature(),offset:p?{x:i.x-p.x,z:i.z-p.z}:{x:0,z:0},changed:false};sync();}

});
canvas.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;const prev=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>0)zoom(pinch/d);pinch=d;
 yaw-=(e.clientX-prev.x)*.004;pitch=Math.max(.58,Math.min(1.565,pitch+(e.clientY-prev.y)*.004));cameraUpdate();return;}
 if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>6)gesture.moved=true;
 if(drag&&gesture?.moved){
 // Opening the placement dock resizes the canvas. Keep the original grab point
 // relative to the resized projection rather than jumping to the floor edge.
 const viewport=viewportSignature();if(viewport!==drag.viewport){const start=ground(screenRay(gesture.x,gesture.y));if(start)drag.offset={x:drag.start.x-start.x,z:drag.start.z-start.z};drag.viewport=viewport;}
 const p=ground(screenRay(e.clientX,e.clientY));if(p){drag.changed=true;showPreview(moveItem(editingItems(),drag.id,p.x+drag.offset.x,p.z+drag.offset.z,roomBounds).find(i=>i.id===drag.id));}}
 else if(!drag&&gesture?.moved){if(previewItem)cancelPreview();yaw-=(e.clientX-prev.x)*.008;pitch=Math.max(.58,Math.min(1.565,pitch+(e.clientY-prev.y)*.008));cameraUpdate();}
});
function end(e){
 const g=gesture;const multi=pointers.size>1;pointers.delete(e.pointerId);finishDrag(multi);
 if(!multi&&g&&!g.moved&&g.door){doorController.toggle(g.door);ping();}
 else if(!multi&&g&&!g.moved&&!g.hit&&selected){if(rotationDraft&&!placementResult(rotationDraft).valid)cancelRotation();$('#place-done').click();}
 gesture=null;pinch=0;
}
canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);finishDrag(true);gesture=null;pinch=0;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.001));},{passive:false});
window.addEventListener('keydown',e=>{if(['TEXTAREA','INPUT','SELECT'].includes(e.target.tagName)||$('#share-dialog').open)return;if(e.key==='Escape'&&selected){e.preventDefault();endRotationGesture(true);finishDrag(true);if(transfer)cancelTransfer();else {if(rotationDraft)cancelRotation();$('#place-done').click();}}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('#delete').click();}if(e.key.toLowerCase()==='r')rotate(e.shiftKey?-15:15);if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$('#undo').click();}if(e.key.toLowerCase()==='f'){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.();}});
async function copy(){try{await navigator.clipboard.writeText($('#share-url').value);shareStatus='copied';$('#share-result').textContent=t(shareStatus);}catch{$('#share-url').focus();$('#share-url').select();shareStatus='copyFallback';$('#share-result').textContent=t(shareStatus);}}
$('#share').onclick=async()=>{if(!ready||config.imported)return;$('#share').disabled=true;try{const response=await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:encodeLayout(items,roomBounds),...(roomID===DEFAULT_ROOM?{}:{room:roomID})})});if(!response.ok)throw Error();const {id}=await response.json();if(!/^[\w-]{16}$/.test(id))throw Error();track('share_created');$('#share-url').value=location.origin+location.pathname+'?s='+id;shareStatus='shareDesc';$('#share-result').textContent=t(shareStatus);$('#share-dialog').showModal();await copy();}catch{track('share_failed');toast(t('shareFailed'));}finally{$('#share').disabled=false;}};$('#copy-again').onclick=copy;$('#close-share').onclick=()=>$('#share-dialog').close();
function capture(){if(!ready)return;app.render();const out=document.createElement('canvas');out.width=1920;out.height=1200;const ctx=out.getContext('2d');ctx.fillStyle='#f4f0e7';ctx.fillRect(0,0,out.width,out.height);const scale=Math.min(1840/canvas.width,1020/canvas.height),w=canvas.width*scale,h=canvas.height*scale;ctx.drawImage(canvas,(1920-w)/2,90+(1020-h)/2,w,h);ctx.fillStyle='#355e4e';ctx.font='30px sans-serif';ctx.fillText(t('imageTitle'),42,53);ctx.font='18px sans-serif';ctx.fillText(t('estimated'),42,1170);out.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=t('filename');a.click();track('export_saved');setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast(t('imageSaved'));},'image/png');}
$('#capture').onclick=capture;$('#capture-mobile').onclick=capture;
window.addEventListener('hashchange',()=>{try{if(location.hash.startsWith('#layout=')){commit(()=>decodeLayout(location.hash.slice(8),roomBounds));toast(t('layoutOpened'));}}catch{toast(t('badHash'));}});
if(typeof __ROOM_TEST_HOOKS__==='undefined'||__ROOM_TEST_HOOKS__)window.render_game_to_text=()=>JSON.stringify({roomID,activeLevel,viewOnly:!!config.viewOnly,ready,allowOverlap,placement:previewResult,preview:previewItem,collisionCounts:collisionRoom?{solids:collisionRoom.solids.length,floors:collisionRoom.floors.length,doors:collisionRoom.doors.length}:null,screenDoors:doorController?.screenTargets(camera.camera,canvas.getBoundingClientRect())??[],doors:doorController?.snapshot()??[],language:getLocale(),clayMaterials:app?new Set(app.root.findComponents('render').flatMap(r=>r.meshInstances.map(mi=>mi.material)).filter(m=>m.normalMap)).size:0,coordinateSystem:'Y up; X right, Z toward viewer; metres are estimated',items,transfer,selected,hiddenWalls,mode,objective:objectiveProgress(items,BRIEFS[briefIndex].needs),screenItems:camera?editingItems().filter(i=>itemVisible(i,activeLevel)).map(i=>{const p=camera.camera.worldToScreen(new pc.Vec3(i.x,itemY(i)+(i.type==='rug'?.04:.45),i.z));const r=canvas.getBoundingClientRect();return {id:i.id,x:p.x+r.left,y:p.y+r.top,worldY:entities.get(i.id)?.getPosition().y,level:itemLevel(i)};}):[],camera:{yaw,pitch,distance,target},undo:undoStack.length});
if(typeof __ROOM_TEST_HOOKS__==='undefined'||__ROOM_TEST_HOOKS__)window.advanceTime=(ms=16)=>{if(app&&ready){animate(ms/1000);app.render();}};
let loadStage='device';
try{
 app=new pc.Application(canvas,{graphicsDeviceOptions:{alpha:false,antialias:true,preserveDrawingBuffer:true}});app.graphicsDevice.maxPixelRatio=Math.min(devicePixelRatio,2);app.setCanvasResolution(pc.RESOLUTION_AUTO);
 camera=new pc.Entity('Camera');camera.addComponent('camera',{clearColor:new pc.Color(.80,.88,.84),nearClip:.03,farClip:Math.max(80,config.maxDistance*3),fov:48});app.root.addChild(camera);
 const stage=$('.viewport');const resize=()=>{const width=stage.clientWidth,height=stage.clientHeight;app.resizeCanvas(width,height);camera.camera.horizontalFov=height>width;camera.camera.fov=height>width?65:48;if(multilevel&&ready){distance=fitDistance(frameConfig,width/height,camera.camera.horizontalFov,camera.camera.fov);cameraUpdate();}};new ResizeObserver(resize).observe(stage);resize();
 app.scene.ambientLight=new pc.Color(.96,.96,.94);const light=new pc.Entity();light.addComponent('light',{type:'directional',color:new pc.Color(1,.99,.97),intensity:.65,shadowIntensity:.4,castShadows:true,shadowType:pc.SHADOW_VSM16,vsmBlurSize:11,shadowDistance:30,shadowResolution:2048,shadowBias:.03,normalOffsetBias:.04});light.setEulerAngles(65,-30,0);app.root.addChild(light);
 loadStage='material';await loadClay(pc,app,{onFallback:()=>track('client_error')});
 loadStage='meta';const response=await fetch(config.assetBase+'.json');if(!response.ok)throw Error(t('loadError'));meta=await response.json();
 loadStage='model';const asset=await new Promise((resolve,reject)=>app.assets.loadFromUrl(config.assetBase+'.glb','container',(err,a)=>err?reject(err):resolve(a)));room=asset.resource.instantiateRenderEntity();app.root.addChild(room);
 loadStage='scene';
 if(multilevel&&meta.levels?.length){
 activeLevel=meta.levels[0].id;
 levelSelect=document.createElement('div');levelSelect.id='floor-select';levelSelect.className='floor-tabs';levelSelect.setAttribute('role','group');
 for(const value of [...meta.levels.map(l=>l.id),'all']){const b=document.createElement('button');b.type='button';b.dataset.level=String(value);b.onclick=()=>switchLevel(value);levelSelect.append(b);}
 $('.stage').prepend(levelSelect);
 const move=document.createElement('select');move.id='move-floor';move.onchange=()=>{if(move.value!=='')startTransfer(Number(move.value));};
 const cancel=document.createElement('button');cancel.id='cancel-transfer';cancel.onclick=cancelTransfer;
 $('#placement-dock').append(move,cancel);
 applyVisibility();refreshLevelUI();
 }
 const baseMat=new pc.StandardMaterial();baseMat.diffuse=new pc.Color(.72,.70,.65);applyClay(baseMat);const plinth=new pc.Entity('Display base');plinth.addComponent('render',{meshInstances:[new pc.MeshInstance(roundedMesh(pc,app.graphicsDevice,config.plinth),baseMat)]});plinth.setPosition(target.x,-.23,target.z);if(!multilevel)app.root.addChild(plinth);
 for(const g of meta.groups)if(g.kind==='ceiling'){const e=room.findByName(g.name);if(e)e.enabled=false;}
 for(const r of room.findComponents('render'))for(const mi of r.meshInstances)if(mi.material.name==='Window glazing'){const original=mi.material,m=new pc.StandardMaterial();m.name=original.name;m.diffuse=original.diffuse.clone();m.opacity=original.opacity;m.blendType=pc.BLEND_NORMAL;m.depthWrite=false;m.update();mi.material=m;}
 for(const r of room.findComponents('render'))for(const mi of r.meshInstances)if(mi.material.diffuseMap&&!mi.material.normalMap&&mi.material.opacity===1){const m=mi.material.clone();applyClay(m);mi.material=m;}
 collisionRoom=captureRoomCollision(pc,room,meta);
 doorController=createDoors(pc,room,meta.doors??[],t,$('#door-buttons'),id=>{if(items.some(i=>placementResult(i).doors.includes(id)))toast(t('doorClearance',{names:doorLabel(t,meta.doors.find(d=>d.id===id)||{id})}));},id=>allowOverlap||!items.some(i=>i.type!=='rug'&&furnitureVolumes(i,collisionRoom.levels).some(v=>collisionRoom.doors.find(d=>d.id===id).currentVolumes.some(b=>boxesOverlap(v,b)))),()=>toast(t('collisionobstacle')));
 $('.door-controls').hidden=!meta.doors?.length;$('.mobile-door-menu').hidden=!meta.doors?.length;
 app.on('update',dt=>{doorController.update(dt);animate(dt);updateObjectDelete();const i=previewItem??items.find(i=>i.id===selected);if(!i)return;const [w,d]=CATALOG[i.type].size,angle=-i.r*Math.PI/180;const points=[[-w/2-.07,-d/2-.07],[w/2+.07,-d/2-.07],[w/2+.07,d/2+.07],[-w/2-.07,d/2+.07]].map(([x,z])=>new pc.Vec3(i.x+x*Math.cos(angle)-z*Math.sin(angle),itemY(i)+.07,i.z+x*Math.sin(angle)+z*Math.cos(angle)));for(let k=0;k<4;k++)app.drawLine(points[k],points[(k+1)%4],previewResult&&!previewResult.valid?new pc.Color(.85,.12,.12):previewResult?.doors.length?new pc.Color(.99,.68,.25):new pc.Color(.25,.65,.4));});
 ready=true;track('room_ready',performance.now()-openedAt);refreshLanguage();home();app.start();$('#loading').hidden=true;if(initialError)toast(t('initialError'));
}catch(e){track('room_failed',0,loadStage);$('#loading').textContent=t(loadStage==='device'?'webglError':'loadError');console.error('Room could not load');}

for(const menu of document.querySelectorAll('.view-menu,.mobile-door-menu'))menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.view-menu,.mobile-door-menu'))if(other!==menu)other.open=false;});
