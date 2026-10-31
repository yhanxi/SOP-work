'use strict';
const assert=require('node:assert/strict'),O=require('../outputs/SOP工作台/object-workspace.js'),C=require('../outputs/SOP工作台/color-picker.js');
const rect={id:'rect',type:'rect',x:100,y:100,w:200,h:120},photo={...rect,id:'photo',type:'photo'},diamond={...rect,id:'diamond',type:'diamond',x:400},arrow={id:'arrow',type:'arrow',x:50,y:50,w:20,h:20};
assert.deepEqual(O.anchorPoints(rect).map(({x,y})=>[x,y]),[[100,100],[300,100],[300,220],[100,220],[200,100],[300,160],[200,220],[100,160]]);
assert.deepEqual(O.anchorPoints(photo),O.anchorPoints(rect));
assert.deepEqual(O.anchorPoints(diamond).map(({x,y})=>[x,y]),[[500,100],[600,160],[500,220],[400,160],[550,130],[550,190],[450,190],[450,130]]);
const model={objects:[rect,arrow]};
assert.equal(O.nearestAnchor(model,{x:108,y:104},arrow.id).kind,'corner');assert.equal(O.nearestAnchor(model,{x:202,y:106},arrow.id).kind,'midpoint');assert.equal(O.nearestAnchor(model,{x:200,y:111},arrow.id),null);
assert.equal(O.nearestAnchor({objects:[arrow]},{x:50,y:50},arrow.id),null,'Never snap to the moving arrow itself');
for(const scale of [.35,.5,1,1.5,2,3]){const near=O.nearestAnchor(model,{x:200,y:100+9/scale},arrow.id,{x:scale,y:scale});assert(near,'9 screen pixels should snap at every zoom');assert.equal(O.nearestAnchor(model,{x:200,y:100+11/scale},arrow.id,{x:scale,y:scale}),null,'11 screen pixels should release at every zoom');}
assert.equal(O.nearestAnchor({objects:[diamond]},{x:400,y:100},arrow.id),null,'Diamond bounding-box corners are not polygon corners');
const line={type:'line',id:'line',x:200,y:300,w:100,h:60,flipX:true,flipY:false};assert.deepEqual(O.anchorPoints(line).map(({x,y})=>[x,y]),[[300,300],[200,360],[250,330]]);
const hit=O.nearestAnchor(model,{x:203,y:104},arrow.id),endpoints={x1:50,y1:50,x2:hit.x,y2:hit.y};O.setLineEndpoints(arrow,endpoints);const persisted=O.normalize(JSON.parse(JSON.stringify({objects:[arrow]}))).objects[0];assert.deepEqual(O.lineEndpoints(persisted),endpoints);assert(!O.svg({objects:[persisted]}).includes('snap-guide'),'Snap hints must not enter previews or exported graphics');
const luma=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
for(let col=2;col<10;col++){const rgb=[1,3,5].map(i=>parseInt(C.base[col].slice(i,i+2),16));assert(Math.max(...rgb)-Math.min(...rgb)>=160,'Preset hues must include vivid originals');assert.equal(C.theme[2][col],C.base[col]);for(let row=1;row<6;row++)assert(luma(C.theme[row-1][col])>luma(C.theme[row][col]),'Theme columns must progress from bright to dark');}
console.log('PASS: polygon corners/midpoints, photo anchors, nearest-range snapping across zooms, self exclusion, line geometry persistence and vivid-to-dark palette');
