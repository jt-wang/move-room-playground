// Assemble site-dist/: the learner landing at /, the bundled playground at /play/ (from the verified release-public/),
// fixed color tokens, the setup guide, approved media and the packaged skill and source ZIPs. Every input is checked by hash;
// the output is an exact file list, and its receipt site-receipt.json sits outside the served folder.
// Usage: npm run build && MOVE_MEDIA_DIR=… MOVE_MEDIA_MANIFEST=… MOVE_SKILL_ZIP=… MOVE_SKILL_SHA256=… MOVE_SOURCE_ZIP=… MOVE_SOURCE_SHA256=… npm run build:site
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outName='site-dist',outDir=path.join(root,outName),marker='.move-site-build',receiptName='site-receipt.json';
const MEDIA=['default-room.png','story.mp4','story-portrait.mp4','story-poster.jpg','story-poster-portrait.jpg'];
const LANDING={'index.html':'landing/index.html','landing.css':'landing/landing.css','landing.js':'landing/landing.js','setup.md':'landing/setup.md','playground/palette.css':'landing/palette.css'};
const DOCS={'source/skill-reference.md':'skills/blender-room-tour/reference.md','source/README.md':'README.md','source/LICENSE':'LICENSE'};
const SKILL_DIR='skills/blender-room-tour';
// The source ZIP must carry these byte-identical to this checkout, so a stale bundle cannot slip through.
const SOURCE_PINNED=['README.md','LICENSE','app.mjs','worker.mjs',`${SKILL_DIR}/SKILL.md`,`${SKILL_DIR}/reference.md`];
// The only images or models allowed in the source ZIP: the invented practice room and its generated previews.
const SOURCE_MEDIA_OK=['assets/room.glb','assets/clay-normal.png','assets/preview.png','assets/og.png','docs/preview.png'];
const MEDIA_EXT=/\.(png|jpe?g|webp|gif|heic|heif|avif|tiff?|glb|gltf|blend1?|fbx|obj|ply|splat|usdz?|exr|hdr|mp4|mov|m4v|mkv|webm|avi)$/i;
const NEVER_SEGMENT=new Set(['node_modules','.git','.shares','jobs','private','output','public','release-public','site-dist','__MACOSX','__pycache__']);
const NEVER_NAME=/^(?:\.env(?:\..*)?|\.dev\.vars|\.DS_Store|wrangler\.(?:toml|jsonc?)|.*\.(?:pem|key|jsonl|pyc))$/;
class BuildError extends Error{}
const fail=message=>{throw new BuildError(message);};
const sha=data=>createHash('sha256').update(data).digest('hex');
const HEX=/^[0-9a-f]{64}$/;
const sameList=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Regular files only; the final path component must not be a symlink.
function readRegular(file,label){
 const st=fs.lstatSync(file,{throwIfNoEntry:false});
 if(!st)fail(`${label}: missing`);
 if(st.isSymbolicLink())fail(`${label}: symlink refused`);
 if(!st.isFile())fail(`${label}: not a regular file`);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{if(!fs.fstatSync(fd).isFile())fail(`${label}: not a regular file`);return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}

// Checkout files: no symlink anywhere between the project root and the file.
function readProject(rel){
 for(let p=path.join(root,rel);p!==root;p=path.dirname(p))if(fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink())fail('symlink refused: '+path.relative(root,p));
 return readRegular(path.join(root,rel),rel);
}

function readJson(rel){try{return JSON.parse(readProject(rel).toString('utf8'));}catch(e){if(e instanceof BuildError)throw e;fail(rel+' is not valid JSON');}}

function listFiles(dir,prefix=''){
 const out=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const rel=prefix+entry.name,full=path.join(dir,entry.name);
  if(entry.isSymbolicLink())fail('symlink refused: '+rel);
  if(entry.isDirectory())out.push(...listFiles(full,rel+'/'));else if(entry.isFile())out.push(rel);else fail('unexpected entry: '+rel);
 }
 return out.sort();
}

// Only replace a site-dist/ this script made.
function checkOutput(){
 const existing=fs.lstatSync(outDir,{throwIfNoEntry:false});
 if(!existing)return false;
 if(existing.isSymbolicLink()||!existing.isDirectory())fail(outName+'/ is not a plain directory');
 if(!fs.existsSync(path.join(outDir,marker))&&fs.readdirSync(outDir).length)fail(outName+'/ exists and was not created by this build; move it away first');
 return true;
}

// The bundled v2.1 playground, exactly as recorded in release-receipt.json.
function verifyRelease(){
 const raw=readProject('release-receipt.json');let receipt;
 try{receipt=JSON.parse(raw.toString('utf8'));}catch{fail('release-receipt.json is not valid JSON');}
 if(receipt.generator!=='scripts/build-release.mjs'||receipt.root!=='release-public'||!receipt.files||typeof receipt.files!=='object')fail('release-receipt.json was not written by scripts/build-release.mjs');
 if(receipt.testHooks!==false)fail('release-public/ was built with browser test hooks; rebuild it with npm run build');
 const dir=path.join(root,'release-public'),st=fs.lstatSync(dir,{throwIfNoEntry:false});
 if(!st||st.isSymbolicLink()||!st.isDirectory())fail('release-public/ missing; run npm run build first');
 const expected=Object.keys(receipt.files).sort();
 if(!sameList(listFiles(dir).filter(n=>n!=='.move-release-build'),expected))fail('release-public/ does not match release-receipt.json; run npm run build');
 const files={};
 for(const name of expected){const data=readRegular(path.join(dir,name),'release-public/'+name);if(sha(data)!==receipt.files[name])fail('hash mismatch: release-public/'+name);files[name]=data;}
 return {files,receiptSha256:sha(raw),esbuild:receipt.esbuild};
}

// Approved media arrive only at build time and are copied byte-for-byte.
function readMedia(){
 if(!process.env.MOVE_MEDIA_DIR)fail('MOVE_MEDIA_DIR is required: the folder holding the approved landing media');
 const dir=path.resolve(process.env.MOVE_MEDIA_DIR),st=fs.lstatSync(dir,{throwIfNoEntry:false});
 if(!st||st.isSymbolicLink()||!st.isDirectory())fail('MOVE_MEDIA_DIR must be a plain directory');
 if(!process.env.MOVE_MEDIA_MANIFEST)fail('MOVE_MEDIA_MANIFEST is required: an external approved-media hash manifest');
 const manifest=path.resolve(process.env.MOVE_MEDIA_MANIFEST);
 const rel=path.relative(root,manifest);
 if(!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))fail('MOVE_MEDIA_MANIFEST must stay outside the source checkout');
 let hashes;try{hashes=JSON.parse(readRegular(manifest,'MOVE_MEDIA_MANIFEST').toString('utf8'));}catch(e){if(e instanceof BuildError)throw e;fail('MOVE_MEDIA_MANIFEST is not valid JSON');}
 if(!sameList(Object.keys(hashes),MEDIA)||!Object.values(hashes).every(h=>HEX.test(h)))fail('MOVE_MEDIA_MANIFEST must list exactly '+MEDIA.join(', '));
 const files={};
 for(const name of MEDIA){const data=readRegular(path.join(dir,name),'media '+name);if(sha(data)!==hashes[name])fail(`media ${name} does not match MOVE_MEDIA_MANIFEST`);files[name]=data;}
 return {files,hashes};
}

function zipInput(fileVar,hashVar){
 if(!process.env[fileVar])fail(fileVar+' is required');
 const expected=(process.env[hashVar]||'').trim().toLowerCase();
 if(!HEX.test(expected))fail(hashVar+' must be the expected SHA-256 (64 hex characters)');
 const data=readRegular(path.resolve(process.env[fileVar]),fileVar),actual=sha(data);
 if(actual!==expected)fail(`${fileVar} has SHA-256 ${actual}, not the ${hashVar} value`);
 return data;
}

// Minimal ZIP reader (stored or deflated; no ZIP64 or encryption): enough to check names and compare contents.
function zipEntries(data,label){
 let eocd=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-22-0xffff);i--)if(data.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)fail(label+' is not a ZIP archive');
 const count=data.readUInt16LE(eocd+10);let p=data.readUInt32LE(eocd+16);
 if(count===0xffff||p===0xffffffff)fail(label+': ZIP64 archives are not supported');
 const entries=new Map();
 for(let n=0;n<count;n++){
  if(p+46>data.length||data.readUInt32LE(p)!==0x02014b50)fail(label+': corrupt central directory');
  const nameLength=data.readUInt16LE(p+28),name=data.toString('utf8',p+46,p+46+nameLength);
  if(entries.has(name))fail(`${label}: duplicate entry ${name}`);
  entries.set(name,{flags:data.readUInt16LE(p+8),method:data.readUInt16LE(p+10),compressed:data.readUInt32LE(p+20),size:data.readUInt32LE(p+24),offset:data.readUInt32LE(p+42)});
  p+=46+nameLength+data.readUInt16LE(p+30)+data.readUInt16LE(p+32);
 }
 return entries;
}

function zipRead(data,entry,label){
 if(entry.flags&1)fail(label+': encrypted entries are not supported');
 const p=entry.offset;
 if(p+30>data.length||data.readUInt32LE(p)!==0x04034b50)fail(label+': corrupt local header');
 const start=p+30+data.readUInt16LE(p+26)+data.readUInt16LE(p+28),raw=data.subarray(start,start+entry.compressed);
 const out=entry.method===0?raw:entry.method===8?zlib.inflateRawSync(raw):fail(label+': unsupported compression method '+entry.method);
 if(out.length!==entry.size)fail(label+': size mismatch');
 return out;
}

// No traversal, build/job/secret traces, or images and models beyond those allowed.
function checkNames(entries,label,mediaOk){
 for(const name of entries.keys()){
  const parts=name.replace(/\/$/,'').split('/');
  if(name.startsWith('/')||name.includes('\\')||parts.some(s=>s===''||s==='.'||s==='..'))fail(`${label}: unsafe entry name ${JSON.stringify(name)}`);
  if(parts.some(s=>NEVER_SEGMENT.has(s)||/^\.(?:public|release|site)-(?:staging|previous)-/.test(s))||NEVER_NAME.test(parts.at(-1)))fail(`${label}: entry not allowed in a public package: ${name}`);
  if(!name.endsWith('/')&&MEDIA_EXT.test(name)&&!mediaOk(name))fail(`${label}: image, model or video not allowed: ${name}`);
 }
}

// The skill ZIP must hold exactly the files of skills/blender-room-tour/, byte for byte.
function checkSkillZip(data){
 const label='MOVE_SKILL_ZIP',entries=zipEntries(data,label);
 checkNames(entries,label,()=>false);
 const files=[...entries.keys()].filter(n=>!n.endsWith('/'));
 const top=files.includes('SKILL.md')?'':files.find(n=>/^[^/]+\/SKILL\.md$/.test(n))?.slice(0,-'SKILL.md'.length);
 if(top===undefined)fail(label+': no SKILL.md at the top level or inside one top-level folder');
 if(files.some(n=>!n.startsWith(top)))fail(label+': entries outside the skill folder');
 const ours=listFiles(path.join(root,SKILL_DIR)).filter(n=>!/(?:^|\/)__pycache__\/|\.pyc$|(?:^|\/)\.DS_Store$/.test(n));
 if(!sameList(files.map(n=>n.slice(top.length)),ours))fail(`${label} does not hold exactly the files in ${SKILL_DIR}/; it is stale or incomplete`);
 for(const name of ours)if(!zipRead(data,entries.get(top+name),label).equals(readProject(`${SKILL_DIR}/${name}`)))fail(`${label}: ${name} differs from ${SKILL_DIR}/${name}; the ZIP is stale`);
 return {root:top.replace(/\/$/,'')||'.',files:ours.length};
}

// The source ZIP: code plus invented practice assets only, matching this checkout.
function checkSourceZip(data){
 const label='MOVE_SOURCE_ZIP',entries=zipEntries(data,label);
 const files=[...entries.keys()].filter(n=>!n.endsWith('/'));
 const anchor=files.find(n=>/^(?:[^/]+\/)?skills\/blender-room-tour\/SKILL\.md$/.test(n));
 if(!anchor)fail(label+': skills/blender-room-tour/SKILL.md not found');
 const top=anchor.slice(0,-`${SKILL_DIR}/SKILL.md`.length);
 if(files.some(n=>!n.startsWith(top)))fail(label+': entries outside its top-level folder');
 checkNames(entries,label,name=>SOURCE_MEDIA_OK.includes(name.slice(top.length)));
 for(const name of SOURCE_PINNED){const entry=entries.get(top+name);if(!entry)fail(`${label}: ${name} missing`);if(!zipRead(data,entry,label).equals(readProject(name)))fail(`${label}: ${name} differs from this checkout; the ZIP is stale`);}
 for(const name of SOURCE_MEDIA_OK){const entry=entries.get(top+name);if(entry&&!zipRead(data,entry,label).equals(readProject(name)))fail(`${label}: ${name} differs from the generated practice asset`);}
 return {root:top.replace(/\/$/,'')||'.',files:files.length};
}

// landing/publication.json is the single switch. The landing's GitHub controls must agree with it:
// disabled spans without href while pending, real links once published.
function checkPublication(html,setup){
 const pub=readJson('landing/publication.json');
 const keys=['state','version','repository','repositoryUrl','skillAssetName','skillDownloadUrl','installCommand'];
 if(!sameList(Object.keys(pub),keys)||!keys.every(k=>typeof pub[k]==='string'&&pub[k]))fail('landing/publication.json must have exactly: '+keys.join(', '));
 if(!['pending','published'].includes(pub.state))fail('landing/publication.json state must be "pending" or "published"');
 if(pub.skillAssetName!=='blender-room-tour.zip'||pub.repositoryUrl!==`https://github.com/${pub.repository}`||pub.skillDownloadUrl!==`${pub.repositoryUrl}/releases/latest/download/${pub.skillAssetName}`)fail('landing/publication.json URLs are inconsistent');
 for(const url of [pub.skillDownloadUrl,pub.repositoryUrl]){
  const tags=html.match(new RegExp(`<[a-z]+\\b[^>]*\\bdata-release-url="${escapeRe(url)}"[^>]*>`,'g'))||[];
  if(tags.length!==1)fail(`landing/index.html needs exactly one control with data-release-url="${url}"`);
  const tag=tags[0],ok=pub.state==='pending'?tag.startsWith('<span')&&tag.includes('aria-disabled="true"')&&!/\shref=/.test(tag):tag.startsWith('<a ')&&tag.includes(`href="${url}"`)&&!tag.includes('aria-disabled');
  if(!ok)fail(`landing/index.html: the ${url} control does not match publication state "${pub.state}"`);
 }
 if((pub.state==='pending')!==setup.includes('Status: unpublished.'))fail('landing/setup.md status line does not match publication state');
 return pub;
}

// No local paths or source maps anywhere; no hardcoded production host on the landing.
function checkText(out){
 const forbidden=[root,'/Users/','file://','sourceMappingURL'];
 for(const [name,data] of out){
  if(!/\.(?:html|css|js|mjs|md|json|txt)$/.test(name)||name==='play/assets/playcanvas.min.js')continue;
  const text=data.toString('utf8');
  if(name.endsWith('.html')&&/data-palette-(?:toolbar|choice)|palette\.js|class="mp-review/.test(text))fail(name+' contains review-only palette controls');
  for(const needle of forbidden)if(text.includes(needle))fail(`${name} contains forbidden text ${JSON.stringify(needle)}`);
  if(Object.hasOwn(LANDING,name)&&text.includes('move.jingtao.io'))fail(name+' must link the playground root-relatively, not to move.jingtao.io');
 }
}

function main(){
 const existing=checkOutput();
 const release=verifyRelease(),media=readMedia();
 const skillZip=zipInput('MOVE_SKILL_ZIP','MOVE_SKILL_SHA256'),skill=checkSkillZip(skillZip);
 const sourceZip=zipInput('MOVE_SOURCE_ZIP','MOVE_SOURCE_SHA256'),source=checkSourceZip(sourceZip);
 const pub=checkPublication(readProject('landing/index.html').toString('utf8'),readProject('landing/setup.md').toString('utf8'));
 const version={name:'move-room-playground',version:pub.version,
  publication:{state:pub.state,repository:pub.repository,repositoryUrl:pub.repositoryUrl,skillDownloadUrl:pub.skillDownloadUrl,installCommand:pub.installCommand},
  skill:{file:'source/blender-room-tour.zip',sha256:sha(skillZip),bytes:skillZip.length,root:skill.root,files:skill.files},
  source:{file:'source/move-room-playground.zip',sha256:sha(sourceZip),bytes:sourceZip.length,root:source.root,files:source.files,contents:'code and invented practice assets only; the approved film and hero image are not included'},
  playground:{path:'/play/',releaseReceiptSha256:release.receiptSha256,esbuild:release.esbuild}};

 const out=new Map();
 for(const [name,rel] of Object.entries(LANDING))out.set(name,readProject(rel));
 for(const name of MEDIA)out.set('assets/'+name,media.files[name]);
 for(const [name,data] of Object.entries(release.files))out.set('play/'+name,data);
 out.set('source/blender-room-tour.zip',skillZip);
 out.set('source/move-room-playground.zip',sourceZip);
 for(const [name,rel] of Object.entries(DOCS))out.set(name,readProject(rel));
 out.set('source/version.json',Buffer.from(JSON.stringify(version,null,1)+'\n'));
 checkText(out);

 // Stage everything, then swap it in; the previous output survives any failure.
 const work=fs.mkdtempSync(path.join(root,'.site-staging-')),staging=path.join(work,outName),receiptTmp=path.join(work,receiptName),previous=path.join(work,'previous');
 try{
  fs.mkdirSync(staging);
  for(const [name,data] of out){const target=path.join(staging,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
  const found=listFiles(staging),expected=[...out.keys()].sort();
  if(!sameList(found,expected))fail('unexpected site files: '+found.filter(n=>!out.has(n)).join(', '));
  const files={};
  for(const name of expected){files[name]=sha(fs.readFileSync(path.join(staging,name)));if(files[name]!==sha(out.get(name)))fail('write mismatch: '+name);}
  const receipt={generator:'scripts/build-site.mjs',root:outName,publication:pub.state,
   inputs:{releaseReceiptSha256:release.receiptSha256,media:media.hashes,skillZipSha256:version.skill.sha256,sourceZipSha256:version.source.sha256},files};
  fs.writeFileSync(path.join(staging,marker),'Generated by scripts/build-site.mjs; safe to delete.\n');fs.chmodSync(staging,0o755);
  fs.writeFileSync(receiptTmp,JSON.stringify(receipt,null,1)+'\n');
  if(existing)fs.renameSync(outDir,previous);
  try{fs.renameSync(staging,outDir);fs.renameSync(receiptTmp,path.join(root,receiptName));}
  catch(e){if(!fs.existsSync(staging)&&fs.existsSync(outDir))fs.rmSync(outDir,{recursive:true});if(fs.existsSync(previous))fs.renameSync(previous,outDir);throw e;}
  console.log(`${outName}/: ${expected.length} files (publication ${pub.state}); receipt ${receiptName}`);
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}

try{main();}catch(e){console.error('build-site: '+(e instanceof BuildError?e.message:e?.message||e));process.exitCode=1;}
