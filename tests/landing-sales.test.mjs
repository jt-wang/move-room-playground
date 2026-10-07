import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import siteWorker from '../site-worker.mjs';
const html=fs.readFileSync(new URL('../landing/index.html',import.meta.url),'utf8');
const meta=(attr,name)=>new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1];
const FOLLOW='https://x.com/intent/follow?screen_name=thejingtao';

// Records follow_click into the existing Analytics Engine dataset, then opens the X follow dialog.
function metricsEnv(enabled='true'){const points=[];return {points,env:{TELEMETRY_ENABLED:enabled,METRICS:{writeDataPoint:p=>points.push(p)},ASSETS:{fetch:()=>new Response('asset')}}};}
const follow=(env,path,headers={})=>siteWorker.fetch(new Request('https://move.jingtao.io'+path,{headers}),env);
test('/x counts a follow click by button, page language and device, then goes to the X follow dialog',async()=>{
 const {points,env}=metricsEnv();
 const r=await follow(env,'/x?from=hero',{referer:'https://move.jingtao.io/ja/','user-agent':'Mozilla/5.0 (iPhone) Mobile Safari'});
 assert.equal(r.status,302);assert.equal(r.headers.get('location'),FOLLOW);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(points.length,1);const b=points[0].blobs;
 assert.deepEqual([b[0],b[1],b[2],b[9]],['follow_click','ja','mobile','hero']);
 await follow(env,'/x?from=footer',{referer:'https://move.jingtao.io/','user-agent':'Mozilla/5.0 (Macintosh)'});
 assert.deepEqual([points[1].blobs[1],points[1].blobs[2],points[1].blobs[9]],['en','desktop','footer']);
 await follow(env,'/x?from=<script>',{referer:'https://elsewhere.example/zh-hans/'});
 assert.deepEqual([points[2].blobs[1],points[2].blobs[9]],['none','none'],'unknown button and foreign referrer are not recorded as values');
});
test('/x records nothing for Do Not Track, Global Privacy Control or disabled telemetry, and still redirects',async()=>{
 for(const [headers,enabled] of [[{dnt:'1'},'true'],[{'sec-gpc':'1'},'true'],[{},'false']]){
  const {points,env}=metricsEnv(enabled);const r=await follow(env,'/x?from=hero',headers);
  assert.equal(r.status,302);assert.equal(points.length,0,JSON.stringify(headers));
 }
 assert.equal((await siteWorker.fetch(new Request('http://127.0.0.1/x/other'),{ASSETS:{fetch:()=>new Response('asset')}})).status,404);
});

test('follow links appear in the header, the hero, after the lessons and in the footer',()=>{
 const links=[...html.matchAll(/<a [^>]*href="\/x\?from=([\w-]+)"[^>]*data-follow="([\w-]+)"/g)];
 assert.deepEqual(links.map(m=>m[2]),['header','hero','lessons','footer']);
 for(const m of links)assert.equal(m[1],m[2],'each button reports where it sits');
});

test('one sentence up top, then the film, three lessons and three steps; nothing else',()=>{
 const h1=/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1];
 assert.ok(h1.length<=60&&/3D/.test(h1),h1);
 const order=['id="story"','id="lessons"','id="skill"'].map(s=>html.indexOf(s));
 assert.ok(order.every(i=>i>0)&&order[0]<order[1]&&order[1]<order[2],'film, then lessons, then how to use it');
 const lessons=/<section[^>]*id="lessons"[\s\S]*?<\/section>/.exec(html)[0];
 assert.equal((lessons.match(/<li class="lesson">/g)||[]).length,3);
 assert.doesNotMatch(lessons.replace(/<div class="follow-cta">[\s\S]*/,''),/<p[ >]/,'lessons are one line each');
 const skill=/<section[^>]*id="skill"[\s\S]*?<\/section>/.exec(html)[0];
 assert.equal((skill.match(/<li class="step">/g)||[]).length,3);
 assert.match(skill,/data-copy-target="hero-setup"/,'step 1 copies the same setup line');
 const visible=html.replace(/<head>[\s\S]*?<\/head>|<details[\s\S]*?<\/details>|<script[\s\S]*?<\/script>|<pre[\s\S]*?<\/pre>/g,'').replace(/<[^>]+>/g,' ');
 const words=visible.split(/\s+/).filter(w=>/\w/.test(w)).length;
 assert.ok(words<=200,'visible words: '+words);
});

test('a shared link renders a large card credited to @thejingtao',()=>{
 assert.equal(meta('name','twitter:card'),'summary_large_image');
 assert.equal(meta('name','twitter:site'),'@thejingtao');
 assert.equal(meta('name','twitter:creator'),'@thejingtao');
 assert.match(meta('property','og:image'),/^https:\/\/move\.jingtao\.io\/assets\/share-card\.png$/);
 assert.equal(meta('property','og:url'),'https://move.jingtao.io/');
 for(const n of ['og:title','og:description'])assert.ok(meta('property',n),n);
});

test('the share button credits @thejingtao',()=>{
 assert.match(html,/<a [^>]*data-share-x[^>]*href="https:\/\/x\.com\/intent\/post\?[^"]*via=thejingtao/);
});
