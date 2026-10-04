// Local preview of the integrated site: serves site-dist/ (checked against site-receipt.json) through site-worker.mjs.
// Binds 127.0.0.1 only, plus any interface addresses listed explicitly in MOVE_PREVIEW_HOSTS. Shares are stored in .shares/
// (outside the served folder). No telemetry, no remote calls.
// Usage: npm run build:site && npm run serve:site      PORT=… and MOVE_PREVIEW_HOSTS=addr[,addr] are optional.
import http from 'node:http';import net from 'node:net';import os from 'node:os';import {createHash} from 'node:crypto';import {readFile,writeFile,mkdir,lstat,realpath,readdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import siteWorker from './site-worker.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const siteRoot=path.resolve(process.env.MOVE_SITE_DIR||path.join(root,'site-dist'));
const receiptFile=path.resolve(process.env.MOVE_SITE_RECEIPT||path.join(root,'site-receipt.json'));
const store=path.resolve(process.env.ROOM_SHARE_DIR||path.join(root,'.shares'));
const MARKER='.move-site-build';
const fail=message=>{console.error('serve-site: '+message);process.exit(1);};
const sha=data=>createHash('sha256').update(data).digest('hex');
const SAFE_NAME=/^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/;

let receipt;try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}catch{fail(`missing ${path.basename(receiptFile)}; run npm run build:site first`);}
const allowed=receipt?.files;
if(!allowed||typeof allowed!=='object'||Object.entries(allowed).some(([n,h])=>!SAFE_NAME.test(n)||!/^[0-9a-f]{64}$/.test(h)))fail('invalid receipt');
const rootStat=await lstat(siteRoot).catch(()=>null);
if(!rootStat?.isDirectory()||rootStat.isSymbolicLink())fail(`${siteRoot} is missing or not a plain directory; rebuild it`);
const siteReal=await realpath(siteRoot);
const storeInside=path.relative(siteReal,store);if(!storeInside.startsWith('..')&&!path.isAbsolute(storeInside))fail('share store must be outside the served directory');

async function listFiles(dir,prefix=''){
 const out=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const rel=prefix+entry.name;
  if(entry.isDirectory())out.push(...await listFiles(path.join(dir,entry.name),rel+'/'));else if(entry.isFile())out.push(rel);else fail('refused non-regular entry: '+rel);
 }
 return out.sort();
}
const found=(await listFiles(siteReal)).filter(n=>n!==MARKER),expected=Object.keys(allowed).sort();
if(JSON.stringify(found)!==JSON.stringify(expected))fail('site-dist/ does not match its receipt; rebuild it');

// Verified bytes are cached and re-read only when the file's identity or timestamps change.
const cache=new Map();
async function asset(name){
 if(!Object.hasOwn(allowed,name))return null;
 const full=path.join(siteReal,name);
 for(let p=full;p!==siteReal;p=path.dirname(p)){const s=await lstat(p).catch(()=>null);if(!s||s.isSymbolicLink()||(p===full&&!s.isFile()))return null;}
 const s=await lstat(full),sig=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'),hit=cache.get(name);
 if(hit?.sig===sig)return hit.data;
 const data=await readFile(full).catch(()=>null);
 if(!data||sha(data)!==allowed[name]){cache.delete(name);return null;}
 cache.set(name,{sig,data});return data;
}
for(const name of expected)if(!await asset(name))fail('hash mismatch or unreadable: '+name);

const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.md':'text/markdown; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.glb':'model/gltf-binary','.zip':'application/zip','.txt':'text/plain; charset=utf-8','':'text/plain; charset=utf-8'};
const notFound=()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'}});
// One "bytes=a-b", "bytes=a-" or "bytes=-n" range; anything else gets the whole file.
function byteRange(header,size){
 const m=/^bytes=(\d*)-(\d*)$/.exec(header||'');if(!m||(!m[1]&&!m[2]))return null;
 let start,end;
 if(!m[1]){const n=Number(m[2]);if(!n)return 'invalid';start=Math.max(0,size-n);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
 return start>end||start>=size?'invalid':[start,end];
}
const env={
 SHARES:{async get(id){try{return await readFile(path.join(store,id),'utf8');}catch{return null;}},async put(id,value){await writeFile(path.join(store,id),value,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}},
 ASSETS:{async fetch(req){
  if(!['GET','HEAD'].includes(req.method))return notFound();
  const pathname=new URL(req.url).pathname,name=pathname.slice(1)+(pathname.endsWith('/')?'index.html':'');
  const data=await asset(name);if(!data)return notFound();
  const headers={'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(name.endsWith('.zip'))headers['Content-Disposition']=`attachment; filename="${path.basename(name)}"`;
  const range=byteRange(req.headers.get('range'),data.length);
  if(range==='invalid')return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${data.length}`}});
  const body=range?data.subarray(range[0],range[1]+1):data;
  if(range)headers['Content-Range']=`bytes ${range[0]}-${range[1]}/${data.length}`;
  headers['Content-Length']=String(body.length);
  return new Response(req.method==='HEAD'?null:body,{status:range?206:200,headers});
 }}
};
await mkdir(store,{recursive:true,mode:0o700});

// Listen addresses: loopback, plus explicitly named addresses that belong to this machine. Never a wildcard.
const port0=process.env.PORT?Number(process.env.PORT):0;
if(!Number.isInteger(port0)||port0<0||port0>65535)fail('PORT must be an integer from 0 to 65535');
const extra=[...new Set((process.env.MOVE_PREVIEW_HOSTS||'').split(',').map(s=>s.trim()).filter(s=>s&&s!=='127.0.0.1'))];
const local=new Set(Object.values(os.networkInterfaces()).flat().map(i=>i.address));
for(const address of extra){
 if(!net.isIP(address))fail(`MOVE_PREVIEW_HOSTS entry ${JSON.stringify(address)} is not an IP address`);
 if(['0.0.0.0','::','::0'].includes(address)||/^[0:]+$/.test(address))fail('refusing to bind a wildcard address');
 if(!local.has(address))fail(`${address} is not an address of this machine`);
}
let hosts=new Set();
async function handle(req,res){try{
 // Only our own listen addresses as Host: blocks DNS rebinding and absolute-form proxy requests.
 if(!hosts.has(req.headers.host)||!req.url.startsWith('/')){res.writeHead(421,{'Content-Type':'text/plain'});res.end('Misdirected request');return;}
 const rawPath=req.url.split('?')[0];
 if(!/^\/[\w.~\/-]*$/.test(rawPath)||/\/\/|\/\.\.?(?:\/|$)/.test(rawPath)){res.writeHead(404,{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'});res.end('Not found');return;}
 const headers={};for(const k of ['origin','content-type','range'])if(req.headers[k])headers[k]=req.headers[k];
 const options={method:req.method,headers};
 if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
 const response=await siteWorker.fetch(new Request('http://'+req.headers.host+req.url,options),env);
 res.writeHead(response.status,Object.fromEntries(response.headers));
 res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
}catch{if(!res.headersSent)res.writeHead(500);res.end('Unavailable');}}

const servers=[];
const listen=(address,port)=>new Promise((resolve,reject)=>{const server=http.createServer(handle);server.once('error',reject);server.listen(port,address,()=>{server.off('error',reject);servers.push(server);resolve(server.address().port);});});
const hostOf=(address,port)=>net.isIPv6(address)?`[${address}]:${port}`:`${address}:${port}`;
let port;
try{port=await listen('127.0.0.1',port0);for(const address of extra)await listen(address,port);}
catch(e){for(const server of servers)server.close();fail('cannot listen: '+(e?.code||e?.message||e));}
hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...extra.map(a=>hostOf(a,port))]);
console.log(['127.0.0.1',...extra].map(a=>`http://${hostOf(a,port)}/`).join('  ')+`  (serving ${path.relative(root,siteRoot)||'.'}/, shares in ${path.relative(root,store)||store})`);

let closing=false;
function shutdown(){
 if(closing)return;closing=true;
 for(const server of servers){server.close();server.closeAllConnections?.();}
 setTimeout(()=>process.exit(0),2000).unref();
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
