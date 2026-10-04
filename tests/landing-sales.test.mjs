import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import siteWorker from '../site-worker.mjs';
const html=fs.readFileSync(new URL('../landing/index.html',import.meta.url),'utf8');
const meta=(attr,name)=>new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1];
const FOLLOW='https://x.com/intent/follow?screen_name=thejingtao';

test('/x counts as a follow click and goes to the X follow dialog',async()=>{
 const r=await siteWorker.fetch(new Request('http://127.0.0.1/x'),{ASSETS:{fetch:()=>new Response('asset')}});
 assert.equal(r.status,302);assert.equal(r.headers.get('location'),FOLLOW);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await siteWorker.fetch(new Request('http://127.0.0.1/x/other'),{ASSETS:{fetch:()=>new Response('asset')}})).status,404);
});

test('follow links appear in the header, the hero, after the lessons and in the footer',()=>{
 const where=[...html.matchAll(/<a [^>]*href="\/x"[^>]*data-follow="([\w-]+)"/g)].map(m=>m[1]);
 assert.deepEqual(where,['header','hero','lessons','footer']);
});

test('the page leads with the AI-agent lesson and backs it with the recorded build',()=>{
 const h1=/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)[1];
 assert.match(h1,/AI agent/);
 const lessons=/<section[^>]*id="lessons"[\s\S]*?<\/section>/.exec(html)?.[0]||'';
 assert.equal((lessons.match(/<li class="lesson">/g)||[]).length,4);
 assert.match(lessons,/\$17\.51/);
 const order=['id="story"','id="lessons"','id="skill"'].map(s=>html.indexOf(s));
 assert.ok(order.every(i=>i>0)&&order[0]<order[1]&&order[1]<order[2],'story, then lessons, then how to try it');
});

test('a shared link renders a large card credited to @thejingtao',()=>{
 assert.equal(meta('name','twitter:card'),'summary_large_image');
 assert.equal(meta('name','twitter:site'),'@thejingtao');
 assert.equal(meta('name','twitter:creator'),'@thejingtao');
 assert.match(meta('property','og:image'),/^https:\/\/move\.jingtao\.io\/assets\/default-room\.png$/);
 assert.equal(meta('property','og:url'),'https://move.jingtao.io/');
 for(const n of ['og:title','og:description'])assert.ok(meta('property',n),n);
});

test('the share button credits @thejingtao',()=>{
 assert.match(html,/<a [^>]*data-share-x[^>]*href="https:\/\/x\.com\/intent\/post\?[^"]*via=thejingtao/);
});
