import {test} from 'node:test';import assert from 'node:assert/strict';
import {rayTriangleDistance} from '../doors.mjs';
test('surface picking rejects empty bounding-box space, parallel and behind-camera triangles',()=>{
 const a=[0,0,0],b=[1,0,0],c=[0,1,0];
 assert.equal(rayTriangleDistance([.2,.2,2],[0,0,-1],a,b,c),2);
 assert.equal(rayTriangleDistance([.9,.9,2],[0,0,-1],a,b,c),Infinity);
 assert.equal(rayTriangleDistance([.2,.2,2],[1,0,0],a,b,c),Infinity);
 assert.equal(rayTriangleDistance([.2,.2,2],[0,0,1],a,b,c),Infinity);
 assert.equal(rayTriangleDistance([.2,.2,-2],[0,0,1],a,b,c),2);
});
