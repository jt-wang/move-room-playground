import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {DEFAULT_LAYOUT,encodeLayout} from '../layout.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=data=>createHash('sha256').update(data).digest('hex');
let dir,server,port;
function request(pathname,{method='GET',host,headers={},body}={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:pathname,method,headers:{host:host??`127.0.0.1:${port}`,...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});}
before(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'move-serve-'));const pub=path.join(dir,'pub');fs.mkdirSync(pub);
 const index='<!doctype html><title>ok</title>';fs.writeFileSync(path.join(pub,'index.html'),index);
 fs.writeFileSync(path.join(pub,'secret.txt'),'not allowlisted');fs.writeFileSync(path.join(pub,'changed.txt'),'edited after build');
 fs.symlinkSync(path.join(root,'package.json'),path.join(pub,'link.json'));
 const receipt={files:{'index.html':sha(index),'link.json':sha(fs.readFileSync(path.join(root,'package.json'))),'changed.txt':sha('original')}};
 fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt));
 server=spawn(process.execPath,[path.join(root,'serve.mjs')],{env:{...process.env,ROOM_PUBLIC_DIR:pub,ROOM_RECEIPT:path.join(dir,'receipt.json'),ROOM_SHARE_DIR:path.join(dir,'shares'),ROOM_METRICS_FILE:'',PORT:''},stdio:['ignore','pipe','inherit']});
 port=await new Promise((resolve,reject)=>{let out='';server.stdout.on('data',d=>{out+=d;const m=out.match(/127\.0\.0\.1:(\d+)/);if(m)resolve(Number(m[1]));});server.on('exit',code=>reject(Error('server exited '+code)));});
});
after(()=>{server?.kill();if(dir)fs.rmSync(dir,{recursive:true,force:true});});
test('serves only receipt-listed, unmodified, non-symlink files',async()=>{
 assert.equal((await request('/')).status,200);
 for(const p of ['/secret.txt','/link.json','/changed.txt','/../package.json','/%2e%2e/package.json','/..%2fpackage.json','/receipt.json','//index.html'])assert.equal((await request(p)).status,404,p);
});
test('foreign Host headers and absolute-form requests are refused',async()=>{
 assert.equal((await request('/',{host:'evil.example'})).status,421);
 assert.equal((await request('/',{host:`evil.example:${port}`})).status,421);
 assert.equal((await request(`http://evil.example/`)).status,421);
});
test('short share links round-trip through a store outside the served folder',async()=>{
 const origin=`http://127.0.0.1:${port}`,body=JSON.stringify({layout:encodeLayout(DEFAULT_LAYOUT)});
 assert.equal((await request('/api/share',{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
 const created=await request('/api/share',{method:'POST',headers:{'content-type':'application/json',origin},body});assert.equal(created.status,201);
 const {id}=JSON.parse(created.body);assert.match(id,/^[\w-]{16}$/);
 assert.ok(fs.existsSync(path.join(dir,'shares',id)));assert.ok(!fs.existsSync(path.join(dir,'pub',id)));
 const read=await request('/api/share/'+id);assert.equal(read.status,200);assert.equal(typeof JSON.parse(read.body).layout,'string');
 assert.equal((await request('/api/share',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({layout:encodeLayout(DEFAULT_LAYOUT),room:'another-home'})})).status,400);
 assert.equal((await request('/api/share/../../etc/passwd')).status,404);
});
