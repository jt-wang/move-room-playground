import {test} from 'node:test';import assert from 'node:assert/strict';
import siteWorker from '../site-worker.mjs';
import {DEFAULT_LAYOUT,encodeLayout} from '../layout.mjs';
const origin='http://127.0.0.1:64358';
function makeEnv(){const seen=[],shares=new Map();return {seen,env:{SHARES:{async get(id){return shares.get(id)??null;},async put(id,value){shares.set(id,value);}},ASSETS:{async fetch(req){seen.push(new URL(req.url).pathname);return new Response('asset');}}}};}
const call=(env,pathname,init)=>siteWorker.fetch(new Request(origin+pathname,init),env);
test('video byte ranges work even when an asset binding returns the full file',async()=>{
 const env={ASSETS:{async fetch(){return new Response('0123456789',{headers:{'Content-Length':'10',ETag:'"film"'}});}}};
 for(const [range,text] of [['bytes=0-2','012'],['bytes=4-','456789'],['bytes=-3','789'],['bytes=8-99','89']]){
  const r=await call(env,'/assets/story.mp4',{headers:{range}});assert.equal(r.status,206);assert.equal(await r.text(),text);assert.equal(r.headers.get('accept-ranges'),'bytes');
 }
 for(const range of ['bytes=10-','bytes=-0','bytes=5-2']){const r=await call(env,'/assets/story.mp4',{headers:{range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');}
 const stale=await call(env,'/assets/story.mp4',{headers:{range:'bytes=0-2','if-range':'"old"'}});assert.equal(stale.status,200);assert.equal(await stale.text(),'0123456789');
 const native={MEDIA_SIZES:{'/assets/story.mp4':10},ASSETS:{async fetch(){return new Response('0123456789');}}};
 const fallback=await call(native,'/assets/story.mp4',{headers:{range:'bytes=2-4'}});assert.equal(fallback.status,206);assert.equal(await fallback.text(),'234');
});
test('existing playground binding preserves API body, origin and shared-room queries',async()=>{
 const {env,seen}=makeEnv(),forwarded=[];
 env.PLAYGROUND={async fetch(req){forwarded.push({url:req.url,method:req.method,origin:req.headers.get('origin'),body:await req.text()});return new Response('existing');}};
 assert.equal(await (await call(env,'/play/?s=abcdefghijklmnop')).text(),'existing');
 assert.equal(forwarded[0].url,origin+'/?s=abcdefghijklmnop');
 for(const path of ['/api/share','/play/api/share']){
  await call(env,path,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"layout":"sample"}'});
  assert.deepEqual(forwarded.at(-1),{url:origin+'/api/share',method:'POST',origin,body:'{"layout":"sample"}'});
 }
 await call(env,'/setup.md');assert.deepEqual(seen,['/setup.md']);
 for(const path of ['/app.mjs','/style.css','/assets/room.glb','/assets/rooms/practice-room/room.glb']){
  assert.equal(await (await call(env,path)).text(),'existing');assert.equal(forwarded.at(-1).url,origin+path);
 }
 await call(env,'/assets/story.mp4');assert.deepEqual(seen,['/setup.md','/assets/story.mp4']);
 assert.equal((await call(env,'/play/',{method:'POST'})).status,405);
});
test('landing, playground, palette, media and source files go to static assets',async()=>{
 const {env,seen}=makeEnv(),paths=['/','/?palette=b','/play/','/play/?s=abcdefghijklmnop','/play/app.mjs','/play/assets/room.glb','/playground/palette.css','/landing.js','/setup.md','/assets/story.mp4','/source/blender-room-tour.zip','/source/version.json'];
 for(const p of paths)assert.equal((await call(env,p)).status,200,p);
 assert.equal(seen.length,paths.length);
});
test('old root shares, /play and /playground redirect to /play/ keeping the query',async()=>{
 const {env,seen}=makeEnv();
 for(const [p,location,status] of [['/?s=abcdefghijklmnop','/play/?s=abcdefghijklmnop',302],['/?room=demo','/play/?room=demo',302],['/play','/play/',301],['/play?s=abcdefghijklmnop','/play/?s=abcdefghijklmnop',301],['/playground','/play/',302],['/playground/?palette=c','/play/?palette=c',302],['/index.html','/',301],['/play/index.html','/play/',301]]){
  const r=await call(env,p);assert.equal(r.status,status,p);assert.equal(r.headers.get('location'),location,p);
 }
 assert.equal(seen.length,0);
});
test('unknown paths are 404 and never fall back to the landing',async()=>{
 const {env,seen}=makeEnv();
 for(const p of ['/secret.txt','/.move-site-build','/site-receipt.json','/source/','/assets/','/playground/other.js','/playground/palette.js','/play/.hidden','/worker.mjs','/api'])assert.equal((await call(env,p)).status,404,p);
 assert.equal(seen.length,0);
 assert.equal((await call(env,'/',{method:'POST'})).status,405);
});
test('share API keeps its Origin check at /api/share and the /play/api/share alias',async()=>{
 const {env}=makeEnv(),body=JSON.stringify({layout:encodeLayout(DEFAULT_LAYOUT)}),headers={'content-type':'application/json'};
 assert.equal((await call(env,'/api/share',{method:'POST',headers,body})).status,403);
 assert.equal((await call(env,'/play/api/share',{method:'POST',headers:{...headers,origin:'http://evil.example'},body})).status,403);
 const created=await call(env,'/play/api/share',{method:'POST',headers:{...headers,origin},body});assert.equal(created.status,201);
 const {id}=await created.json();assert.match(id,/^[\w-]{16}$/);
 for(const p of ['/api/share/'+id,'/play/api/share/'+id]){const r=await call(env,p);assert.equal(r.status,200,p);assert.equal(typeof (await r.json()).layout,'string');}
});
