import {test} from 'node:test';import assert from 'node:assert/strict';
import {levelVisible} from '../levels.mjs';
test('selected floor hides other storeys, shared groups remain visible, ceilings stay hidden',()=>{
 assert.equal(levelVisible({level:0,kind:'floor'},1,false),false);
 assert.equal(levelVisible({level:1,kind:'floor'},1,false),true);
 assert.equal(levelVisible({kind:'object'},1,false),true);
 assert.equal(levelVisible({level:1,kind:'ceiling'},1,false),false);
 assert.equal(levelVisible({level:1,kind:'walls'},1,true),false);
 assert.equal(levelVisible({level:0,kind:'floor'},'all',false),true);
});
