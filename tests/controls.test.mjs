import {test} from 'node:test';import assert from 'node:assert/strict';
import {screenStep,objectiveProgress} from '../controls.mjs';
test('screen-relative movement follows all four camera orientations',()=>{
 for(const [yaw,expected] of [[0,[.2,0]],[Math.PI/2,[0,-.2]],[Math.PI,[-.2,0]],[-Math.PI/2,[0,.2]]]){const s=screenStep('right',yaw,.2);assert.ok(Math.abs(s.x-expected[0])<1e-8);assert.ok(Math.abs(s.z-expected[1])<1e-8);}
 assert.deepEqual(screenStep('up',0,.2),{x:0,z:-.2});
});
test('brief counts only requested furniture and never falsely completes on unrelated objects',()=>{
 const req={sofa:1,table:1,chair:2};assert.equal(objectiveProgress([{type:'plant'},{type:'bed'}],req).done,0);
 assert.equal(objectiveProgress([{type:'sofa'},{type:'sofa'},{type:'table'},{type:'chair'}],req).done,3);
 assert.equal(objectiveProgress([{type:'sofa'},{type:'table'},{type:'chair'},{type:'chair'}],req).complete,true);
});

test('free rotation retains arbitrary angles and snaps only near 45-degree stops',async()=>{
 const {snapRotation}=await import('../controls.mjs');
 assert.equal(snapRotation(23),23);assert.equal(snapRotation(40),40);
 assert.equal(snapRotation(42),45);assert.equal(snapRotation(87),90);
 assert.equal(snapRotation(-2),0);assert.equal(snapRotation(359),0);
 assert.equal(snapRotation(-23),337);assert.equal(snapRotation(383),23);
});
