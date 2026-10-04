import {resolveRoom,roomConfig,DEFAULT_ROOM} from './rooms.mjs';
import {decodeLayout,encodeLayout} from './layout.mjs';
import {validEvent,record,geoOf} from './metrics.mjs';
const reply=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
async function jsonBody(request,max){const reader=request.body?.getReader();if(!reader)throw {status:400};let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw {status:413};}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return JSON.parse(new TextDecoder().decode(bytes));}
async function limit(request,env,binding){if(!env[binding])return env.REQUIRE_LIMITERS==='true'?503:0;try{const key=request.headers.get('cf-connecting-ip')||'local';return (await env[binding].limit({key})).success?0:429;}catch{return 503;}}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname,start=Date.now();
 const finish=(data,status=200)=>{record(env,status===201?'api_share_created':status===200?'api_share_read':status===429?'api_limited':status>=500?'api_unavailable':'api_rejected',{duration:Date.now()-start});return reply(data,status,status===429?{'Retry-After':'60'}:{});};
 if(path==='/api/events'&&request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return reply({error:'Forbidden'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Invalid content type'},415);
  const limited=await limit(request,env,'METRICS_LIMITER');if(limited)return reply({error:'Unavailable'},limited,limited===429?{'Retry-After':'60'}:{});
  try{const data=await jsonBody(request,1024);if(!validEvent(data))return reply({error:'Invalid event'},400);record(env,data.event,{...data,...geoOf(request),source:'client'});return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}catch(e){return reply({error:'Invalid event'},e.status===413?413:400);}
 }
 if(path==='/api/share'&&request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return finish({error:'Forbidden'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return finish({error:'Invalid content type'},415);
  const limited=await limit(request,env,'SHARE_LIMITER');if(limited)return finish({error:'Unavailable'},limited);
  let layout,room;
  try{const body=await jsonBody(request,22000);if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['layout','room'].includes(k))||typeof body.layout!=='string'||(body.room!==undefined&&typeof body.room!=='string'))throw Error();room=resolveRoom(body.room);const config=roomConfig(room),bounds=config.bounds;if(config.viewOnly&&decodeLayout(body.layout,bounds).length)throw Error();layout=encodeLayout(decodeLayout(body.layout,bounds).map((item,n)=>({...item,id:'f'+n})),bounds);}catch(e){return finish({error:'Invalid layout'},e.status===413?413:400);}
  try{const stored=room===DEFAULT_ROOM?layout:JSON.stringify({room,layout});const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stored)));const id=btoa(String.fromCharCode(...digest.slice(0,12))).replaceAll('+','-').replaceAll('/','_');if(!await env.SHARES.get(id))await env.SHARES.put(id,stored);return finish({id},201);}catch{return finish({error:'Unable to save layout'},503);}
 }
 if(path.startsWith('/api/')){
  const match=path.match(/^\/api\/share\/([\w-]{16})$/);if(!match||request.method!=='GET')return reply({error:'Not found'},404);
  const limited=await limit(request,env,'READ_LIMITER');if(limited)return finish({error:'Unavailable'},limited);
  try{const layout=await env.SHARES.get(match[1]);return layout?finish(layout.startsWith('{')?JSON.parse(layout):{layout}):finish({error:'Not found'},404);}catch{return finish({error:'Unavailable'},503);}
 }
 return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
}};
