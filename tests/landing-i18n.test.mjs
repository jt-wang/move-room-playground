import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import siteWorker from '../site-worker.mjs';
import vm from 'node:vm';
import {LANDING_LOCALES,englishStrings,localizeLanding} from '../landing/localize.mjs';
const template=fs.readFileSync(new URL('../landing/index.html',import.meta.url),'utf8');
const dict=JSON.parse(fs.readFileSync(new URL('../landing/i18n.json',import.meta.url),'utf8'));
const pages=Object.fromEntries(LANDING_LOCALES.map(l=>[l.code,localizeLanding(template,l.code,dict)]));
const text=html=>html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' ');

test('the landing comes in the playground’s six languages, each at its own path',()=>{
 assert.deepEqual(LANDING_LOCALES.map(l=>[l.code,l.path]),[['zh-Hans','/zh-hans/'],['zh-Hant','/zh-hant/'],['ja','/ja/'],['ko','/ko/'],['en','/'],['es','/es/']]);
 for(const {code,path} of LANDING_LOCALES){
  const html=pages[code];
  assert.match(html,new RegExp(`<html lang="${code}"`));
  assert.match(html,new RegExp(`<meta property="og:url" content="https://move\\.jingtao\\.io${path}">`));
  for(const other of LANDING_LOCALES)assert.ok(html.includes(`<link rel="alternate" hreflang="${other.code}" href="https://move.jingtao.io${other.path}">`),code+' → '+other.code);
  assert.ok(html.includes(`<option value="${code}" selected>`),code+' selected in the language menu');
 }
});

test('every translatable string has a translation, and no extra keys',()=>{
 const keys=Object.keys(englishStrings(template)).sort();
 assert.ok(keys.length>50,'template keys: '+keys.length);
 assert.deepEqual(Object.keys(dict).sort(),['es','ja','ko','zh-Hans','zh-Hant']);
 for(const [code,strings] of Object.entries(dict)){
  assert.deepEqual(Object.keys(strings).sort(),keys,code);
  for(const k of keys)assert.ok(strings[k].trim(),`${code}.${k} is empty`);
 }
});

test('translated pages keep links, controls and the follow buttons',()=>{
 const shape=html=>({follow:[...html.matchAll(/data-follow="([\w-]+)"/g)].map(m=>m[1]),hrefs:[...html.matchAll(/ href="([^"]+)"/g)].map(m=>m[1]).filter(h=>!h.startsWith('https://x.com/intent/post')&&!h.startsWith('https://move.jingtao.io')&&!h.startsWith('/assets/story')),ids:[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1])});
 const en=shape(pages.en);
 assert.deepEqual(en.follow,['header','hero','lessons','footer']);
 for(const code of ['zh-Hans','zh-Hant','ja','ko','es'])assert.deepEqual(shape(pages[code]),en,code);
 assert.match(text(pages.ja),/AI エージェント/);assert.doesNotMatch(text(pages.ja),/Expect the first attempt to fail/);
 assert.match(text(pages['zh-Hant']),/我學到了什麼/);
});

test('the share button and card speak the page’s language',()=>{
 const share=/data-share-x[^>]*href="([^"]+)"/;
 const zh=new URL(share.exec(pages['zh-Hans'])[1].replace(/&amp;/g,'&'));
 assert.equal(zh.searchParams.get('url'),'https://move.jingtao.io/zh-hans/');assert.equal(zh.searchParams.get('via'),'thejingtao');
 assert.match(zh.searchParams.get('text'),/[一-鿿]/);
 assert.match(/<meta property="og:title" content="([^"]+)"/.exec(pages.ko)[1],/[가-힯]/);
});

test('the footer is only the X link',()=>{
 const footer=/<footer[\s\S]*<\/footer>/.exec(pages.en)[0];
 assert.deepEqual([...footer.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m=>m[1]),['/x?from=footer']);
 assert.doesNotMatch(footer,/MIT|Explore the playground|By /);
});

test('assets load from any language path',()=>{
 for(const m of pages.en.matchAll(/ (?:src|poster)="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g))assert.ok((m[1]||m[2]).startsWith('/'),m[0]);
});

// Runs the real landing.js in a sandbox: where it sends the visitor, and what choosing a language in the menu saves.
function visit(pathname,saved,languages,hash=''){
 let to=null,ready=null,onChange=null;const store=new Map(Object.entries(saved||{}));
 const select={value:'',addEventListener:(t,f)=>{onChange=f;}};
 const location={pathname,search:'',hash,replace(u){to=u;},set href(u){to=u;}};
 const ctx={location,navigator:{languages,language:languages[0]},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
  document:{readyState:'loading',documentElement:{classList:{add(){},remove(){}}},addEventListener:(t,f)=>{ready=f;},querySelector:q=>q==='[data-lang-select]'?select:null,querySelectorAll:()=>[]},window:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../landing/landing.js',import.meta.url),'utf8'),ctx);
 return {to,store,choose(code){ready();select.value=code;onChange();return to;}};
}
const LIVE='room-toy-language',DEMO='move-demo:language';
test('first visit to / goes to the browser’s language unless the visitor already chose one',()=>{
 assert.equal(visit('/',null,['ja-JP','en']).to,'/ja/');
 assert.equal(visit('/',null,['zh-TW']).to,'/zh-hant/');
 assert.equal(visit('/',null,['zh-CN']).to,'/zh-hans/');
 assert.equal(visit('/',null,['fr-FR','de']).to,null);
 assert.equal(visit('/',null,['en-US']).to,null);
 assert.equal(visit('/',{[LIVE]:'en'},['ko-KR']).to,null);
 assert.equal(visit('/',{[LIVE]:'es'},['ja']).to,'/es/','choice made in the live playground');
 assert.equal(visit('/',{[DEMO]:'ko'},['ja']).to,'/ko/','choice made in the source playground');
 assert.equal(visit('/',null,['ja'],'#lessons').to,'/ja/#lessons');
 assert.equal(visit('/ja/',null,['es']).to,null,'a language page someone linked to stays put');
 assert.equal(visit('/',null,['ja'],'#layout=abc').to,'/play/#layout=abc','old playground links still win');
});
test('choosing a language saves it where both playgrounds read it and opens that page',()=>{
 const v=visit('/ja/',null,['ja']);
 assert.equal(v.choose('ko'),'/ko/');
 assert.equal(v.store.get(LIVE),'ko');assert.equal(v.store.get(DEMO),'ko');
});

test('language paths are served, and bare or index paths redirect to them',async()=>{
 const seen=[];const env={ASSETS:{fetch(req){seen.push(new URL(req.url).pathname);return new Response('page');}}};
 const call=p=>siteWorker.fetch(new Request('http://127.0.0.1'+p),env);
 for(const p of ['/zh-hans/','/zh-hant/','/ja/','/ko/','/es/'])assert.equal((await call(p)).status,200,p);
 assert.deepEqual(seen,['/zh-hans/','/zh-hant/','/ja/','/ko/','/es/']);
 for(const [p,to] of [['/ja','/ja/'],['/ja?x=1','/ja/?x=1'],['/ja/index.html','/ja/']]){const r=await call(p);assert.equal(r.status,301,p);assert.equal(r.headers.get('location'),to);}
 for(const p of ['/fr/','/ja/other','/en/'])assert.equal((await call(p)).status,404,p);
});

test('the story film has no caption describing its own format',()=>{
 for(const [code,html] of Object.entries(pages)){
  const film=html.match(/<figure class="film">[\s\S]*?<\/figure>/)[0];
  assert.doesNotMatch(film,/<figcaption/,code);
  assert.doesNotMatch(film,/aria-describedby/,code);
 }
 for(const strings of Object.values(dict))assert.equal(strings.filmCaption,undefined);
});

const filmFiles=slug=>{const s=slug?'-'+slug:'';return {landscape:`/assets/story${s}.mp4`,portrait:`/assets/story-portrait${s}.mp4`,poster:`/assets/story-poster${s}.jpg`,posterPortrait:`/assets/story-poster-portrait${s}.jpg`};};
test('each language page plays the story film made in its language',()=>{
 for(const {code,path} of LANDING_LOCALES){
  const f=filmFiles(code==='en'?'':path.slice(1,-1)),film=pages[code].match(/<figure class="film">[\s\S]*?<\/figure>/)[0];
  for(const [attr,want] of [['src',f.portrait+'#t=0.001'],['src',f.landscape],['poster',f.poster],['href',f.landscape],
   ['data-film-landscape',f.landscape],['data-film-portrait',f.portrait+'#t=0.001'],['data-poster-landscape',f.poster],['data-poster-portrait',f.posterPortrait]])
   assert.ok(film.includes(`${attr}="${want}"`),`${code}: ${attr}="${want}"`);
  assert.equal((film.match(/\/assets\/story/g)||[]).length,8,code+': every film reference is localized');
 }
});

test('the film switcher reads each page’s own files instead of fixed English paths',()=>{
 const js=fs.readFileSync(new URL('../landing/landing.js',import.meta.url),'utf8');
 assert.doesNotMatch(js,/\/assets\/story/);
 for(const k of ['filmLandscape','filmPortrait','posterLandscape','posterPortrait'])assert.match(js,new RegExp('dataset\\.'+k));
});

test('localized film files are served from the landing, not forwarded to the playground',async()=>{
 const seen=[],forwarded=[];
 const env={ASSETS:{fetch(req){seen.push(new URL(req.url).pathname);return new Response('film');}},PLAYGROUND:{fetch(req){forwarded.push(new URL(req.url).pathname);return new Response('play');}}};
 const all=LANDING_LOCALES.flatMap(({code,path})=>Object.values(filmFiles(code==='en'?'':path.slice(1,-1))));
 for(const p of all)assert.equal((await siteWorker.fetch(new Request('http://127.0.0.1'+p),env)).status,200,p);
 assert.deepEqual(forwarded,[]);assert.deepEqual(seen,all);
});
