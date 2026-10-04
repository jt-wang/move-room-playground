// Integrated site routing: learner landing at /, bundled playground at /play/, share API from worker.mjs unchanged.
// Needs the same ASSETS and SHARES bindings as worker.mjs. It is an adapter for an existing host, not a deployment.
import worker from './worker.mjs';
import {record,geoOf} from './metrics.mjs';
// Every static path the site serves. Anything else is a 404, never the index page.
const STATIC=/^\/(?:|(?:zh-hans|zh-hant|ja|ko|es)\/|landing\.(?:css|js)|setup\.md|assets\/[\w-][\w.-]*|playground\/palette\.css|play\/(?:[\w-]+\/)*(?:[\w-][\w.-]*)?|source\/[\w-][\w.-]*)$/;
// The landing in its other five languages; English is the root.
const LANGUAGE_PATH=/^\/(zh-hans|zh-hant|ja|ko|es)(\/index\.html)?$/;
const PLAY_SHARE=/^\/play\/api\/share(?:\/[\w-]{16})?$/;
const LANDING_MEDIA=new Set(['default-room.png','story.mp4','story-portrait.mp4','story-poster.jpg','story-poster-portrait.jpg']);
// /x is the landing's follow link. It records follow_click into the existing metrics dataset
// (button, page language, phone or desktop, coarse location; nothing for DNT or GPC), then opens the X follow dialog.
const FOLLOW_X='https://x.com/intent/follow?screen_name=thejingtao';
const FOLLOW_BUTTONS=['header','hero','lessons','footer'];
const PAGE_LOCALES={'/':'en','/zh-hans/':'zh-Hans','/zh-hant/':'zh-Hant','/ja/':'ja','/ko/':'ko','/es/':'es'};
function recordFollow(request,env,url){
 if(request.headers.get('dnt')==='1'||request.headers.get('sec-gpc')==='1')return;
 let locale='none';
 try{const from=new URL(request.headers.get('referer')||'');if(from.origin===url.origin)locale=PAGE_LOCALES[from.pathname]||'none';}catch{/* No usable referrer. */}
 const button=FOLLOW_BUTTONS.includes(url.searchParams.get('from'))?url.searchParams.get('from'):'none';
 const device=/Mobi|Android|iPhone|iPad/i.test(request.headers.get('user-agent')||'')?'mobile':'desktop';
 record(env,'follow_click',{locale,device,source:'client',...geoOf(request),reason:button});
}
const LEGACY_ASSET=/^\/assets\/(?:[\w-]+\/)*[\w-][\w.-]*$/;
const plain=(text,status,extra={})=>new Response(text,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const redirect=(location,status=302)=>new Response(null,{status,headers:{Location:location,'Cache-Control':'no-store'}});
// Optional existing playground service. Keep its prepared homes and share storage in place
// when adding the landing to an existing deployment; never copy them into the reusable export.
function playgroundRequest(request,pathname){
 const target=new URL(request.url);target.pathname=pathname;
 const init={method:request.method,headers:request.headers};
 if(!['GET','HEAD'].includes(request.method)){init.body=request.body;init.duplex='half';}
 return new Request(target,init);
}
// Some asset bindings ignore Range. Stream a single requested video range without buffering the film.
async function staticAsset(request,env){
 const response=await env.ASSETS.fetch(request);
 if(request.method!=='GET'||!new URL(request.url).pathname.endsWith('.mp4')||response.status!==200)return response;
 const raw=request.headers.get('range'),match=/^bytes=(\d*)-(\d*)$/.exec(raw||'');
 if(!match||(!match[1]&&!match[2]))return response;
 const validator=request.headers.get('if-range');
 if(validator&&validator!==response.headers.get('etag')&&validator!==response.headers.get('last-modified'))return response;
 // Native asset bodies can omit Content-Length inside the Worker. Deployment supplies their verified sizes.
 const length=response.headers.get('content-length')||env.MEDIA_SIZES?.[new URL(request.url).pathname],size=Number(length);
 if(!length||!Number.isSafeInteger(size)||size<0||!response.body)return response;
 let start,end;
 if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
 const headers=new Headers(response.headers);headers.set('Accept-Ranges','bytes');
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){
  await response.body.cancel();headers.set('Content-Range',`bytes */${size}`);headers.delete('Content-Length');
  return new Response(null,{status:416,headers});
 }
 headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));
 const reader=response.body.getReader();let offset=0;
 const body=new ReadableStream({async pull(controller){
  try{while(true){
   const {done,value}=await reader.read();if(done){controller.close();return;}
   const from=Math.max(0,start-offset),to=Math.min(value.byteLength,end+1-offset);offset+=value.byteLength;
   if(to>from)controller.enqueue(value.subarray(from,to));
   if(offset>end){controller.close();await reader.cancel();return;}
   if(to>from)return;
  }}catch(error){controller.error(error);}},cancel(reason){return reader.cancel(reason);}});
 return new Response(body,{status:206,headers});
}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname,query=url.search;
 if(env.PLAYGROUND?.fetch&&(path.startsWith('/api/')||PLAY_SHARE.test(path)))
  return env.PLAYGROUND.fetch(playgroundRequest(request,path.startsWith('/play/')?path.slice(5):path));
 if(path.startsWith('/api/'))return worker.fetch(request,env);
 // Same handler and Origin check for a client that resolves api/share relative to /play/.
 if(PLAY_SHARE.test(path)){
  const target=new URL(url);target.pathname=path.slice('/play'.length);
  const init={method:request.method,headers:request.headers};
  if(!['GET','HEAD'].includes(request.method)){init.body=request.body;init.duplex='half';}
  return worker.fetch(new Request(target,init),env);
 }
 if(!['GET','HEAD'].includes(request.method))return plain('Method not allowed',405,{Allow:'GET, HEAD'});
 // Old links: shares and room picks used to open the playground at the root.
 if(path==='/'&&(url.searchParams.has('s')||url.searchParams.has('room')))return redirect('/play/'+query);
 if(path==='/play')return redirect('/play/'+query,301);
 if(path==='/playground'||path==='/playground/')return redirect('/play/'+query);
 if(path==='/x'){recordFollow(request,env,url);return redirect(FOLLOW_X);}
 const language=LANGUAGE_PATH.exec(path);
 if(language)return redirect(`/${language[1]}/`+query,301);
 if(path==='/index.html')return redirect('/'+query,301);
 if(path==='/play/index.html')return redirect('/play/'+query,301);
 // Cached old playground pages and existing asset URLs keep working after the root becomes the landing.
 if(env.PLAYGROUND?.fetch&&(path==='/app.mjs'||path==='/style.css'||
   (LEGACY_ASSET.test(path)&&!LANDING_MEDIA.has(path.slice('/assets/'.length)))))
  return env.PLAYGROUND.fetch(request);
 if(env.PLAYGROUND?.fetch&&path.startsWith('/play/')&&STATIC.test(path))
  return env.PLAYGROUND.fetch(playgroundRequest(request,path.slice(5)));
 if(!STATIC.test(path)||!env.ASSETS)return plain('Not found',404);
 return staticAsset(request,env);
}};
