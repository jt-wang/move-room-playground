// Local-only preview: serves an allowlisted build on 127.0.0.1 plus the share API from worker.mjs.
// Shared layouts are stored in .shares/ (outside the served directory). No production or remote setup.
// Usage: node serve.mjs            serves public/ (after npm run build:public)
//        node serve.mjs --release  serves release-public/ (after npm run build)
import http from 'node:http';import {createHash} from 'node:crypto';import {readFile,writeFile,mkdir,appendFile,lstat,realpath} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import worker from './worker.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),release=process.argv.includes('--release');
const publicRoot=path.resolve(process.env.ROOM_PUBLIC_DIR||path.join(root,release?'release-public':'public'));
const receiptFile=path.resolve(process.env.ROOM_RECEIPT||path.join(root,release?'release-receipt.json':'public-receipt.json'));
const store=path.resolve(process.env.ROOM_SHARE_DIR||path.join(root,'.shares'));
let receipt;try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}catch{console.error(`Missing ${path.basename(receiptFile)}; run ${release?'npm run build':'npm run build:public'} first.`);process.exit(1);}
const allowed=receipt.files;
if(!allowed||typeof allowed!=='object'){console.error('Invalid receipt');process.exit(1);}
const rootStat=await lstat(publicRoot).catch(()=>null);
if(!rootStat?.isDirectory()){console.error(`${publicRoot} is missing or not a plain directory; rebuild it.`);process.exit(1);}
const publicReal=await realpath(publicRoot);
const storeInside=path.relative(publicReal,store);if(!storeInside.startsWith('..')&&!path.isAbsolute(storeInside)){console.error('Share store must be outside the served directory');process.exit(1);}
await mkdir(store,{recursive:true,mode:0o700});
const metricFile=process.env.ROOM_METRICS_FILE;if(metricFile)await mkdir(path.dirname(metricFile),{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary','.txt':'text/plain; charset=utf-8'};
const notFound=()=>new Response('Not found',{status:404,headers:{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'}});
// Serve a file only if it is in the receipt, is a regular non-symlink file under the output root, and still matches its hash.
async function asset(name){
 if(!Object.hasOwn(allowed,name)||name.includes('\\')||name.split('/').some(p=>p===''||p==='.'||p==='..'))return null;
 const full=path.join(publicReal,name);
 for(let p=full;p!==publicReal;p=path.dirname(p)){const s=await lstat(p).catch(()=>null);if(!s||s.isSymbolicLink())return null;}
 const real=await realpath(full);if(!real.startsWith(publicReal+path.sep))return null;
 const data=await readFile(real);return createHash('sha256').update(data).digest('hex')===allowed[name]?data:null;
}
const env={SHARES:{async get(id){try{return await readFile(path.join(store,id),'utf8');}catch{return null;}},async put(id,value){await writeFile(path.join(store,id),value,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}},ASSETS:{async fetch(req){if(!['GET','HEAD'].includes(req.method))return notFound();let name;try{name=decodeURIComponent(new URL(req.url).pathname.slice(1))||'index.html';}catch{return notFound();}const data=await asset(name);if(!data)return notFound();return new Response(req.method==='HEAD'?null:data,{headers:{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}}};
// Opt-in local metrics only; nothing is sent anywhere else.
if(metricFile){env.TELEMETRY_ENABLED='true';env.METRICS={writeDataPoint(point){appendFile(metricFile,JSON.stringify({timestamp:new Date().toISOString(),...point})+'\n',{mode:0o600}).catch(()=>{});}};}
let hosts=new Set();
const server=http.createServer(async(req,res)=>{try{
 // Only our own loopback origin: blocks DNS rebinding and absolute-form proxy requests.
 if(!hosts.has(req.headers.host)||!req.url.startsWith('/')){res.writeHead(421,{'Content-Type':'text/plain'});res.end('Misdirected request');return;}
 const headers={};for(const k of ['origin','content-type'])if(req.headers[k])headers[k]=req.headers[k];
 const options={method:req.method,headers};
 if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}
 const response=await worker.fetch(new Request('http://'+req.headers.host+req.url,options),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Unavailable');}});
server.listen(Number(process.env.PORT)||0,'127.0.0.1',()=>{const port=server.address().port;hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);console.log(`http://127.0.0.1:${port}/  (serving ${path.relative(root,publicRoot)||'.'}/, shares in ${path.relative(root,store)||store})`);});
