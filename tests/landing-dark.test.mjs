import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tokens=block=>[...block.matchAll(/(--[\w-]+):/g)].map(m=>m[1]).sort();

test('the landing follows the system dark setting with a full set of colors',()=>{
 const css=read('landing/palette.css');
 const light=/^:root\s*\{([^}]*)\}/m.exec(css)[1];
 const dark=/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1];
 assert.ok(dark,'dark block');
 assert.deepEqual(tokens(dark),tokens(light));
 assert.ok(tokens(light).includes('--on-accent'));
 assert.match(read('landing/index.html'),/<meta name="color-scheme" content="light dark">/);
 assert.doesNotMatch(read('landing/landing.css'),/#FFFFFF|#fff\b/i,'text on buttons uses --on-accent');
});
