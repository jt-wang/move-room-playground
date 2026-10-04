// Bundle the verified public/ build into release-public/ with the pinned local esbuild.
// Input must match public-receipt.json; output is checked against an exact file list.
// Usage: npm run build:public && npm run build:release   (ROOM_TEST_HOOKS=1 keeps browser test hooks)
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=path.join(root,'public'),outName='release-public',outDir=path.join(root,outName),marker='.move-release-build';
const ESBUILD_VERSION='0.25.0';
class BuildError extends Error{}
const fail=message=>{throw new BuildError(message);};
const sha=data=>createHash('sha256').update(data).digest('hex');

function loadEsbuild(){
 const require=createRequire(path.join(root,'package.json'));
 const requested=process.env.ROOM_ESBUILD_MODULE||'esbuild';
 let resolved;try{resolved=fs.realpathSync(require.resolve(requested));}catch{fail('esbuild is not installed locally; run npm ci');}
 const local=fs.realpathSync(path.join(root,'node_modules'));
 if(!resolved.startsWith(local+path.sep))fail('esbuild must come from this project\'s node_modules, not '+resolved);
 const esbuild=require(resolved);
 if(esbuild.version!==ESBUILD_VERSION)fail(`expected esbuild ${ESBUILD_VERSION}, found ${esbuild.version}`);
 return esbuild;
}

// Every input file must be a regular file listed in the receipt with a matching hash.
function verifyPublic(){
 let receipt;try{receipt=JSON.parse(fs.readFileSync(path.join(root,'public-receipt.json'),'utf8'));}catch{fail('public-receipt.json missing; run npm run build:public first');}
 const files=receipt.files;if(!files||typeof files!=='object')fail('invalid receipt');
 let stat;try{stat=fs.lstatSync(publicDir);}catch{fail('public/ missing; run npm run build:public first');}
 if(stat.isSymbolicLink()||!stat.isDirectory())fail('public/ is not a plain directory');
 const found=listFiles(publicDir).filter(n=>n!=='.move-public-build');
 const expected=Object.keys(files).sort();
 if(JSON.stringify(found)!==JSON.stringify(expected))fail('public/ does not match its receipt; rebuild it');
 for(const name of expected)if(sha(fs.readFileSync(path.join(publicDir,name)))!==files[name])fail('hash mismatch: '+name);
 return files;
}

function listFiles(dir,prefix=''){
 const out=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const rel=prefix+entry.name,full=path.join(dir,entry.name);
  if(entry.isSymbolicLink())fail('symlink refused: '+rel);
  if(entry.isDirectory())out.push(...listFiles(full,rel+'/'));else if(entry.isFile())out.push(rel);else fail('unexpected entry: '+rel);
 }
 return out.sort();
}

// Resolve only relative imports that stay inside public/ and are in the receipt.
const boundary=files=>({name:'public-boundary',setup(build){
 build.onResolve({filter:/.*/},args=>{
  if(args.kind==='entry-point')return;
  if(!args.path.startsWith('./')&&!args.path.startsWith('../'))return {errors:[{text:'bare or absolute import refused: '+args.path}]};
  const full=path.resolve(args.resolveDir,args.path),rel=path.relative(publicDir,full).split(path.sep).join('/');
  if(rel.startsWith('..')||path.isAbsolute(rel)||!Object.hasOwn(files,rel))return {errors:[{text:'import outside the public allowlist: '+args.path}]};
  return {path:full};
 });
}});

async function main(){
const files=verifyPublic(),esbuild=loadEsbuild();
let existing=null;try{existing=fs.lstatSync(outDir);}catch{}
if(existing){
 if(existing.isSymbolicLink()||!existing.isDirectory())fail(outName+'/ is not a plain directory');
 if(!fs.existsSync(path.join(outDir,marker))&&fs.readdirSync(outDir).length)fail(outName+'/ exists and was not created by this build; move it away first');
}
const staging=fs.mkdtempSync(path.join(root,'.release-staging-'));
try{
 const result=await esbuild.build({absWorkingDir:root,entryPoints:[path.join(publicDir,'app.mjs')],outfile:path.join(staging,'app.mjs'),bundle:true,format:'esm',target:'es2022',minify:true,sourcemap:false,legalComments:'none',metafile:true,write:true,logLevel:'warning',define:{__ROOM_TEST_HOOKS__:process.env.ROOM_TEST_HOOKS==='1'?'true':'false'},plugins:[boundary(files)]});
 for(const input of Object.keys(result.metafile.inputs)){const rel=path.relative(publicDir,path.resolve(root,input)).split(path.sep).join('/');if(!Object.hasOwn(files,rel))fail('bundle input outside allowlist: '+input);}
 // Modules are inlined into app.mjs; everything else is copied verbatim.
 const copied=Object.keys(files).filter(n=>!n.endsWith('.mjs'));
 for(const name of copied){const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(publicDir,name),target);}
 const expected=[...copied,'app.mjs'].sort(),found=listFiles(staging);
 if(JSON.stringify(found)!==JSON.stringify(expected))fail('unexpected release files: '+found.filter(n=>!expected.includes(n)).join(', '));
 const forbidden=[root,'/Users/','file://','sourceMappingURL','move.jingtao.io'];
 for(const name of found)if(/\.(html|css|mjs|json|txt)$/.test(name)&&name!=='assets/playcanvas.min.js'){const text=fs.readFileSync(path.join(staging,name),'utf8');for(const needle of forbidden)if(text.includes(needle))fail(`${name} contains forbidden text ${JSON.stringify(needle)}`);}
 const receipt={generator:'scripts/build-release.mjs',esbuild:esbuild.version,testHooks:process.env.ROOM_TEST_HOOKS==='1',root:outName,files:Object.fromEntries(found.map(n=>[n,sha(fs.readFileSync(path.join(staging,n)))]))};
 fs.writeFileSync(path.join(staging,marker),'Generated by scripts/build-release.mjs; safe to delete.\n');fs.chmodSync(staging,0o755);
 if(existing)fs.rmSync(outDir,{recursive:true});
 fs.renameSync(staging,outDir);
 fs.writeFileSync(path.join(root,'release-receipt.json'),JSON.stringify(receipt,null,1)+'\n');
 console.log(`${outName}/: ${found.length} files; receipt release-receipt.json`);
}finally{if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true});}
}
try{await main();}catch(e){console.error('build-release: '+(e instanceof BuildError?e.message:e?.message||e));process.exitCode=1;}
