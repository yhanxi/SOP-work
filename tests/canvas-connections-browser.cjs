const path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium,_electron}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');
(async()=>{let browser;const root=path.resolve(__dirname,'..'),server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','inherit']});
try{const url=await new Promise(resolve=>{let s='';server.stdout.on('data',b=>{s+=b;if(s.includes('\n'))resolve(JSON.parse(s.split('\n')[0]).url);});});let page;if(process.env.SOP_CANVAS_ELECTRON_EXE){const desktop=await _electron.launch({executablePath:process.env.SOP_CANVAS_ELECTRON_EXE,args:['--sop-test'],env:{...process.env,SOP_STUDIO_TEST_USERDATA:process.env.SOP_CANVAS_ELECTRON_PROFILE},timeout:45000});browser={close:()=>desktop.evaluate(({app})=>app.exit())};page=await desktop.firstWindow();}else{browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(url);}const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.SOP);
await page.evaluate(()=>SOP_OBJECTS.open({width:900,height:520,objects:[{id:'rect',type:'rect',x:200,y:100,w:160,h:100},{id:'diamond',type:'diamond',x:600,y:300,w:120,h:120},{id:'arrow',type:'arrow',x:40,y:450,w:100,h:0}],edges:[]},{onSave:m=>window.result=m}));
const point=(x,y)=>page.locator('.object-dialog .object-sheet').evaluate((s,p)=>{const r=s.getBoundingClientRect();return{x:r.left+p.x*r.width/900,y:r.top+p.y*r.height/520};},{x,y});
const ends=(id='arrow')=>page.locator(`.object-dialog[open] [data-object="${id}"]`).evaluate(g=>{const line=g.querySelector('line'),t=g.transform.baseVal.consolidate().matrix;return{x1:t.e+Number(line.getAttribute('x1')),y1:t.f+Number(line.getAttribute('y1')),x2:t.e+Number(line.getAttribute('x2')),y2:t.f+Number(line.getAttribute('y2'))};});
const near=(a,b)=>assert(Math.abs(a-b)<.1,`${a} != ${b}`);
async function selectArrow(){const p=await ends(),q=await point((p.x1+p.x2)/2,(p.y1+p.y2)/2);await page.mouse.click(q.x,q.y);}
async function drag(a,b){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}
async function connect(which,x,y){await selectArrow();const a=await page.locator('[data-endpoint="'+which+'"]').evaluate(c=>{const p=c.ownerSVGElement.createSVGPoint();p.x=c.cx.baseVal.value;p.y=c.cy.baseVal.value;const q=p.matrixTransform(c.getScreenCTM());return{x:q.x,y:q.y};});await drag(a,await point(x,y));}
await connect('end',360,150);await connect('start',660,300);
await drag(await point(280,150),await point(340,190));let p=await ends();near(p.x2,420);near(p.y2,190);near(p.x1,660);near(p.y1,300);
// Selection must not steal clicks from shapes inside the arrow's bounding rectangle.
await drag(await point(420,240),await point(460,260));p=await ends();near(p.x2,460);near(p.y2,200);
await drag(await point(660,360),await point(680,390));p=await ends();near(p.x1,680);near(p.y1,330);await page.locator('[data-action="undo"]').click();p=await ends();near(p.x1,660);near(p.y1,300);
await connect('end',100,480);await drag(await point(340,200),await point(360,210));p=await ends();near(p.x2,100);near(p.y2,480);
await connect('end',720,360);p=await ends();near(p.x2,720);near(p.y2,360);const original={...p};await page.mouse.click((await point(650,370)).x,(await point(650,370)).y);await page.locator('[data-action="delete"]').click();assert.equal(await page.locator('[data-object="diamond"]').count(),0);p=await ends();near(p.x2,original.x2);await page.locator('[data-action="undo"]').click();assert.equal(await page.locator('[data-object="diamond"]').count(),1);
if(process.env.SOP_CANVAS_QA_OUTPUT)await page.locator('.object-dialog').screenshot({path:path.join(process.env.SOP_CANVAS_QA_OUTPUT,'connected-arrows.png')});await page.locator('[data-action="save"]').click();
const round=await page.evaluate(async()=>{const model=window.result,arrow=model.objects.find(o=>o.id==='arrow');SOP.project.pages[0].canvas=model;SOP.changed();SOP.refresh();const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),back=await SOP_WORD.importDocx(await blob.arrayBuffer());const after=back.pages[0].canvas;after.objects.find(o=>o.id==='diamond').x+=25;SOP_OBJECTS.syncConnections(after);return {bindings:arrow.attachments,backBindings:after.objects.find(o=>o.id==='arrow').attachments,ends:SOP_OBJECTS.lineEndpoints(after.objects.find(o=>o.id==='arrow'))};});assert.equal(round.bindings.start.targetId,'diamond');assert.equal(round.bindings.end.targetId,'diamond');assert.deepEqual(round.bindings,round.backBindings);near(round.ends.x1,685);near(round.ends.x2,745);
// Drag-created arrows bind both pressed and released anchors.
await page.evaluate(()=>SOP_OBJECTS.open({width:900,height:520,objects:[{id:'r',type:'rect',x:100,y:100,w:160,h:100},{id:'d',type:'diamond',x:500,y:200,w:120,h:120}],edges:[]},{onSave:m=>window.created=m}));await page.locator('[data-add="arrow"]').click();await drag(await point(260,150),await point(500,260));await page.locator('[data-action="save"]').click();const created=await page.evaluate(()=>created.objects.find(o=>o.type==='arrow').attachments);assert.equal(created.start.targetId,'r');assert.equal(created.end.targetId,'d');

await page.evaluate(()=>{
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 ctx.fillStyle='#aaaabb';ctx.fillRect(0,0,canvas.width,canvas.height);
 const data=canvas.toDataURL();
 SOP_OBJECTS.open({width:900,height:520,objects:[
  {id:'left-photo',type:'photo',x:110,y:60,w:230,h:150,data},
  {id:'right-photo',type:'photo',x:500,y:210,w:250,h:150,data},
  {id:'arrow',type:'arrow',x:400,y:460,w:160,h:0},
 ],edges:[]},{onSave:model=>window.photoConnectionModel=JSON.parse(JSON.stringify(model))});
});
const dialog=page.locator('.object-dialog[open]');
const drawArrow=async(x1,y1,x2,y2)=>{
 await dialog.locator('[data-add="arrow"]').click();
 await drag(await point(x1,y1),await point(x2,y2));
 return dialog.locator('g[data-object]:has([data-endpoint="start"])').getAttribute('data-object');
};
const move=async(x1,y1,x2,y2)=>drag(await point(x1,y1),await point(x2,y2));
const expectPoints=async(id,x1,y1,x2,y2)=>{
 const actual=await ends(id);
 for(const [key,value]of Object.entries({x1,y1,x2,y2}))assert(Math.abs(actual[key]-value)<1,`${id}.${key}: ${actual[key]} != ${value}`);
 assert.equal(await dialog.locator(`g[data-object="${id}"] line[marker-end]`).count(),1);
 assert.equal(await dialog.locator(`g[data-object="${id}"] line[marker-start]`).count(),0);
};
const alt=async action=>{
 await page.keyboard.down('Alt');
 try{await action();}finally{await page.keyboard.up('Alt');}
};

const photoArrow=await drawArrow(190,115,625,275);
await expectPoints(photoArrow,190,115,625,275);
await move(150,90,175,108);
await expectPoints(photoArrow,215,133,625,275);
const right=await point(730,280);
await page.mouse.click(right.x,right.y);
await move(750,360,800,390);
await expectPoints(photoArrow,215,133,650,288);

await connect('start',170,130);
await connect('end',710,310);
await expectPoints('arrow',170,130,710,310);
await alt(()=>connect('end',705,315));
await move(748,302,778,317);
await expectPoints('arrow',170,130,705,315);
await expectPoints(photoArrow,215,133,680,303);
await connect('end',826,402);
await expectPoints('arrow',170,130,830,405);

let freeArrow;
await alt(async()=>{freeArrow=await drawArrow(557,265,275,145);});
await expectPoints(freeArrow,557,265,275,145);
await dialog.locator('[data-action="save"]').click();
const photoModel=await page.evaluate(()=>photoConnectionModel);
const bound=photoModel.objects.find(item=>item.id===photoArrow);
assert.equal(bound.attachments.start.targetId,'left-photo');
assert.equal(bound.attachments.end.targetId,'right-photo');
for(const attachment of Object.values(bound.attachments)){
 assert(attachment.relativeX>0&&attachment.relativeX<1&&attachment.relativeY>0&&attachment.relativeY<1);
 assert.equal(attachment.anchorIndex,undefined);
}
const reattached=photoModel.objects.find(item=>item.id==='arrow').attachments;
assert.equal(reattached.start.targetId,'left-photo');
assert(reattached.start.relativeX>0&&reattached.start.relativeY>0);
assert.deepEqual(reattached.end,{targetId:'right-photo',anchorIndex:2});
assert.equal(photoModel.objects.find(item=>item.id===freeArrow).attachments,undefined);
assert(photoModel.objects.filter(item=>item.type==='arrow').every(item=>!item.calloutArrow));

await page.evaluate(()=>SOP_OBJECTS.open(photoConnectionModel,{onSave:()=>{}}));
await expectPoints(photoArrow,215,133,680,303);
await expectPoints('arrow',170,130,830,405);
await expectPoints(freeArrow,557,265,275,145);
await dialog.locator('[data-action="save"]').click();

const photoWord=await page.evaluate(async()=>{
 const operation=SOP.blankPage();operation.canvas=photoConnectionModel;
 SOP.replaceProject({...SOP.clone(SOP.project),pages:[operation]});
 const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front);
 const bytes=await blob.arrayBuffer(),back=await SOP_WORD.importDocx(bytes);
 const zip=await JSZip.loadAsync(bytes);
 const doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
 const child=(node,name)=>node.getElementsByTagNameNS('*',name)[0];
 const anchors=[...doc.getElementsByTagNameNS('*','anchor')];
 const photo=anchors.find(node=>child(node,'docPr')?.getAttribute('descr')==='画布独立照片');
 const scale=Number(child(photo,'extent').getAttribute('cx'))/photoConnectionModel.objects[0].w;
 const arrowNames=new Set(photoConnectionModel.objects.filter(item=>item.type==='arrow').map(item=>'画布对象 '+item.id));
 const shapes=anchors.filter(node=>child(node,'cNvCnPr')&&arrowNames.has(child(node,'docPr')?.getAttribute('name'))).map(node=>{
  const position=axis=>Number(child(child(node,'position'+axis),'posOffset').textContent)/scale;
  const x=position('H'),y=position('V'),extent=child(node,'extent'),transform=child(node,'xfrm');
  const right=x+Number(extent.getAttribute('cx'))/scale,bottom=y+Number(extent.getAttribute('cy'))/scale;
  const flipX=transform.getAttribute('flipH')==='1',flipY=transform.getAttribute('flipV')==='1';
  return {x1:flipX?right:x,y1:flipY?bottom:y,x2:flipX?x:right,y2:flipY?y:bottom,
   markers:[child(node,'headEnd').getAttribute('type'),child(node,'tailEnd').getAttribute('type')]};
 });
 return {objects:back.pages[0].canvas.objects.filter(item=>item.type==='arrow'),shapes};
});
assert.deepEqual(photoWord.objects,photoModel.objects.filter(item=>item.type==='arrow'));
assert.equal(photoWord.shapes.length,3);
for(const [index,{markers,...actual}] of photoWord.shapes.entries()){
 assert.deepEqual(markers,['none','triangle']);
 const arrow=photoWord.objects[index];
 near(actual.x1,arrow.x+(arrow.flipX?arrow.w:0));near(actual.y1,arrow.y+(arrow.flipY?arrow.h:0));
 near(actual.x2,arrow.x+(arrow.flipX?0:arrow.w));near(actual.y2,arrow.y+(arrow.flipY?0:arrow.h));
}
assert.deepEqual(errors,[]);
console.log('PASS: shape and photo anchors, move/resize tracking, manual reattachment, Alt detach/free drawing, corner priority, saved geometry and normally oriented Word arrowheads');
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
