/*! blender-room-tour viewer
 * MIT License
 *
 * Copyright (c) 2026 Jingtao Wang
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(async()=>{
const canvas=document.querySelector('#view'),status=document.querySelector('#status');
try {
const app=new pc.Application(canvas,{graphicsDeviceOptions:{alpha:false,antialias:true,preserveDrawingBuffer:true}});
app.graphicsDevice.maxPixelRatio=Math.min(devicePixelRatio,2);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize',()=>app.resizeCanvas());
const response=await fetch('viewer.json');if(!response.ok)throw Error('could not read viewer.json');
const meta=await response.json();const d=meta.views[0];d.up=[0,1,0];d.distance=Math.hypot(...d.camera.map((v,i)=>v-d.target[i]));
document.querySelector('#title').textContent=meta.title;document.title=meta.title;document.querySelector('#notes').textContent=[meta.synthetic?'Synthetic example, not derived from any video.':'Estimated model, not a measured scan.',...meta.notes].join(' ');
for(const v of meta.views){const option=document.createElement('option');option.value=v.name;option.textContent=v.label;document.querySelector('#views').append(option);}
for(const g of meta.groups){if(g.kind==='object'){const option=document.createElement('option');option.value=g.name;option.textContent=g.label;document.querySelector('#isolate').append(option);}}
const camera=new pc.Entity('Camera');camera.addComponent('camera',{clearColor:new pc.Color(.13,.15,.18),nearClip:.03,farClip:100,fov:60});app.root.addChild(camera);
function fitCamera(){camera.camera.horizontalFov=innerHeight>innerWidth;camera.camera.fov=innerHeight>innerWidth?82:60;}fitCamera();window.addEventListener('resize',fitCamera);
app.scene.ambientLight=new pc.Color(.52,.52,.52);
const light=new pc.Entity('Light');light.addComponent('light',{type:'directional',color:new pc.Color(1,.94,.85),intensity:1.3,castShadows:true,shadowDistance:20,shadowResolution:2048,shadowBias:.2,normalOffsetBias:.03});light.setEulerAngles(50,-25,0);app.root.addChild(light);
const asset=await new Promise((resolve,reject)=>app.assets.loadFromUrl(meta.model,'container',(err,asset)=>err?reject(err):resolve(asset)));
// Materials come from the GLB unchanged; declared glazing is exported with alphaMode BLEND.
const room=asset.resource.instantiateRenderEntity();app.root.addChild(room);
const rootGroups=meta.groups.map(g=>g.name);
let hiddenWalls=false,selection='all';
function visibility(){for(const g of meta.groups){const e=room.findByName(g.name);if(!e)throw Error('missing object group: '+g.name);e.enabled=g.kind!=='ceiling'&&(selection==='all'?(g.kind!=='walls'||!hiddenWalls):g.name===selection);}document.querySelector('#walls').setAttribute('aria-pressed',String(hiddenWalls));}
function view(pos,at){target.set(...at);offset.set(...pos).sub(target);up.set(0,1,0);update();}
document.querySelector('#views').onchange=e=>{const v=meta.views.find(v=>v.name===e.target.value);selection='all';document.querySelector('#isolate').value='all';hiddenWalls=true;visibility();view(v.camera,v.target);};
document.querySelector('#walls').onclick=()=>{hiddenWalls=!hiddenWalls;visibility();update();};
document.querySelector('#isolate').onchange=e=>{selection=e.target.value;visibility();if(selection==='all')reset();else {const g=meta.groups.find(g=>g.name===selection);view([g.center[0]-g.radius*1.6,g.center[1]+g.radius,g.center[2]+g.radius*2],g.center);}};
let target=new pc.Vec3(...d.target),offset=new pc.Vec3(...d.camera).sub(target),up=new pc.Vec3(...d.up).normalize();
function update(){camera.setPosition(target.clone().add(offset));camera.lookAt(target,up);window.viewerState={position:camera.getPosition().toArray(),distance:offset.length(),selection,hiddenWalls,groups:rootGroups.filter(n=>room.findByName(n)?.enabled)};}
function zoom(f){const next=offset.length()*f;if(next>d.distance*.03&&next<d.distance*15)offset.mulScalar(f);update();}
function reset(){document.querySelector('#views').value=meta.views[0].name;selection='all';document.querySelector('#isolate').value='all';hiddenWalls=false;visibility();target.set(...d.target);offset.set(...d.camera).sub(target);up.set(...d.up).normalize();update();}
function orbit(dx,dy){let q=new pc.Quat().setFromAxisAngle(up,-dx*.25);q.transformVector(offset,offset);const right=new pc.Vec3().cross(up,offset).normalize();q.setFromAxisAngle(right,dy*.25);q.transformVector(offset,offset);q.transformVector(up,up);up.normalize();update();}
function pan(dx,dy){const right=new pc.Vec3().cross(up,offset).normalize();target.add(right.mulScalar(dx*offset.length()*.001));target.add(up.clone().mulScalar(dy*offset.length()*.001));update();}
const pointers=new Map();let pinch=0;
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});pinch=0;};
canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;const prev=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()];const dist=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>0)zoom(pinch/dist);pinch=dist;}else if(e.buttons===2||e.shiftKey)pan(e.clientX-prev.x,e.clientY-prev.y);else orbit(e.clientX-prev.x,e.clientY-prev.y);};
canvas.onpointerup=canvas.onpointercancel=e=>{pointers.delete(e.pointerId);pinch=0;};canvas.oncontextmenu=e=>e.preventDefault();canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.001));},{passive:false});
document.querySelector('#reset').onclick=reset;document.querySelector('#in').onclick=()=>zoom(.8);document.querySelector('#out').onclick=()=>zoom(1.25);
reset();app.start();status.textContent='';window.roomViewer={ready:true,app};
}catch(e){status.textContent='Could not load the room: '+e.message;console.error(e);}
})();
