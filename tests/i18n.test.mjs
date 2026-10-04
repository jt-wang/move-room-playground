import {test} from 'node:test';import assert from 'node:assert/strict';
import {messages,locales,normalizeLocale,setLocale,t} from '../i18n.mjs';
test('all six locales cover the same messages without empty translations',()=>{
 assert.deepEqual(locales,['zh-Hans','zh-Hant','ja','ko','en','es']);
 const keys=Object.keys(messages['zh-Hans']).sort();
 for(const locale of locales){assert.deepEqual(Object.keys(messages[locale]).sort(),keys);for(const value of Object.values(messages[locale]))assert.ok(value.trim());}
});
test('language negotiation distinguishes traditional Chinese and regional variants',()=>{
 for(const [input,expected] of [['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-Hans-CN','zh-Hans'],['ja-JP','ja'],['ko-KR','ko'],['es-MX','es'],['en-US','en'],['fr','en']])assert.equal(normalizeLocale(input),expected);
});
test('message parameters and language changes do not leak interpolation tokens',()=>{
 setLocale('es');assert.equal(t('count',{n:3}),'3 muebles');assert.equal(t('count',{n:1}),'1 mueble');setLocale('en');assert.equal(t('count',{n:1}),'1 item');
 setLocale('ja');assert.equal(t('itemChair'),'椅子');
 assert.throws(()=>t('nonexistent-message'));
 setLocale('zh-Hans');
});
test('English product name is "Try the apartment" in the header and the page title',()=>{
 assert.equal(messages.en.title,'Try the apartment');assert.equal(messages.en.pageTitle,'Try the apartment');
 assert.equal(messages['zh-Hans'].title,'摆摆看');
});
test('a browser without WebGL gets its own message in every language, distinct from the generic load error',()=>{
 for(const locale of locales){setLocale(locale);const w=t('webglError');assert.ok(w.trim());assert.notEqual(w,t('loadError'));}
 setLocale('zh-Hans');
});
