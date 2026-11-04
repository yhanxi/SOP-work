const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,['scripts/serve.cjs','--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  const {url}=await new Promise(resolve=>server.stdout.once('data',b=>resolve(JSON.parse(b.toString()))));
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({viewport:{width:1500,height:1050}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.body.dataset.recovery==='saved');
  await page.evaluate(()=>{
   const names=['轴承与上盖预装','电机与太阳轮预装','夹头与齿条预装','下壳预装','安装夹持减速箱轴承','装入夹持减速箱','装入旋转减速箱','安装深沟球轴承','安装上盖','安装夹持电机','安装光电传感器','安装旋转电机','安装磁偏板','安装夹头座','安装夹头','安装换向器','安装中壳','安装控制板','录入程序并检查','安装后盖','包装'];
   const p=SOP.clone(SOP.project);
   p.pages=names.map(name=>({...SOP.blankPage(),name}));
   p.settings={...p.settings,cover:false,history:false,flow:true};
   SOP.replaceProject(p);
   SOP.setSelected('front:flow:0');
  });
  await page.locator('#seedFlowGraph').click();
  await page.locator('#flowColumns').selectOption('3');
  const row=i=>page.locator(`[data-flow-row="${i}"]`);
  const ids=await page.evaluate(()=>SOP.project.pages.map(p=>p.processId));
  for(const [i,target] of [8,10,14,19].entries()){
   await row(i).locator('[data-flow-key="role"]').selectOption('branch');
   await row(i).locator('[data-flow-key="target"]').selectOption(ids[target]);
  }
  for(const i of [6,10,11,14])await row(i).locator('[data-flow-key="star"]').check();
  for(const i of [5,7,8,9,13,19,20])await row(i).locator('[data-flow-key="label"]').fill('Y');
  await row(18).locator('[data-flow-key="shape"]').selectOption('diamond');
  await row(13).locator('[data-flow-key="shape"]').selectOption('ellipse');
  await row(20).locator('[data-flow-key="shape"]').selectOption('triangle');
  await page.locator('#flowAddStep').click();
  await row(21).locator('[data-flow-key="name"]').fill('烧引导');
  for(let i=21;i>16;i--)await row(i).locator('[data-flow-move="-1"]').click();
  if(process.env.SOP_FLOW_QA_OUTPUT)await page.locator('#formDialog').screenshot({path:path.join(process.env.SOP_FLOW_QA_OUTPUT,'config.png')});
  await page.locator('#dialogApply').click();
  const canvas=page.locator('.object-dialog');
  await canvas.waitFor();
  assert.equal(await page.evaluate(()=>SOP.project.frontContent?.flowGraph),undefined);
  await canvas.getByRole('button',{name:'应用流程图'}).click();
  await page.locator('#formDialog').waitFor({state:'hidden'});
  const result=await page.evaluate(()=>{
   const g=SOP.project.frontContent.flowGraph,route=e=>SOP_OBJECTS.flowRoute(g,e);
   const orthogonal=points=>points.slice(1).every((p,i)=>p.x===points[i].x||p.y===points[i].y);
   const first=g.edges.find(e=>e.join),main=g.edges.find(e=>e.id===first.join),end=route(first).at(-1),a=route(main);
   const branchOnMain=a.slice(1).some((p,i)=>Math.abs((p.x-a[i].x)*(end.y-a[i].y)-(p.y-a[i].y)*(end.x-a[i].x))<.001&&end.x>=Math.min(p.x,a[i].x)-.001&&end.x<=Math.max(p.x,a[i].x)+.001&&end.y>=Math.min(p.y,a[i].y)-.001&&end.y<=Math.max(p.y,a[i].y)+.001);
   const cross=g.edges.find(e=>!e.join&&e.route==='across');
   return {nodes:g.objects.length,branches:g.edges.filter(e=>e.join).length,cross:g.edges.filter(e=>!e.join&&e.route==='across').length,
    crossJoin:g.edges.some(e=>e.join===cross.id),
    orthogonal:g.edges.every(e=>orthogonal(route(e))),branchOnMain,crossId:cross.id,joinId:first.id,mainId:main.id,nodeId:main.to};
  });
  assert.equal(result.nodes,22);assert.equal(result.branches,4);assert.equal(result.cross,2);
  assert(result.orthogonal&&result.branchOnMain&&result.crossJoin);
  if(process.env.SOP_FLOW_QA_OUTPUT)await page.locator('#previewStage').screenshot({path:path.join(process.env.SOP_FLOW_QA_OUTPUT,'preview.png')});
  await page.locator('#editFlowGraph').click();
  const labelClearance=await canvas.locator('svg').evaluate(svg=>{
   const graph=SOP.project.frontContent.flowGraph;
   return [...svg.querySelectorAll('[data-flow-handle="label"]')].map(label=>{
    const b=label.getBBox();
    const edge=graph.edges.find(e=>e.id===label.dataset.object),points=SOP_OBJECTS.flowRoute(graph,edge);
    const crossesLine=points.slice(1).some((p,i)=>{
     const q=points[i];
     return Math.max(p.x,q.x)>b.x&&Math.min(p.x,q.x)<b.x+b.width
      &&Math.max(p.y,q.y)>b.y&&Math.min(p.y,q.y)<b.y+b.height;
    });
    return !crossesLine&&!graph.objects.some(o=>b.x+b.width+1>o.x&&b.x-1<o.x+o.w&&b.y+b.height+1>o.y&&b.y-1<o.y+o.h);
   });
  });
  assert(labelClearance.length>=6&&labelClearance.every(Boolean),'Labels must clear node outlines and their connector');
  if(process.env.SOP_FLOW_QA_OUTPUT)await canvas.screenshot({path:path.join(process.env.SOP_FLOW_QA_OUTPUT,'canvas.png')});
  const edgeLocator=id=>canvas.locator(`[data-object="${id}"] polyline`).first();
  const points=id=>edgeLocator(id).getAttribute('points');
  const drag=async(x,y,dx,dy)=>{
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();
  };
  const screen=async(x,y)=>canvas.locator('svg').evaluate((svg,{x,y})=>{
   const p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());return [p.x,p.y];
  },{x,y});
  const clickEdge=async id=>{
   const [a,b]=(await points(id)).split(' ').map(p=>p.split(',').map(Number));
   await page.mouse.click(...await screen((a[0]+b[0])/2,(a[1]+b[1])/2));
  };
  const beforeCross=await points(result.crossId);
  await clickEdge(result.crossId);
  const bend=await canvas.locator('[data-flow-handle="bend"]').boundingBox();
  assert(bend);
  await drag(bend.x+bend.width/2,bend.y+bend.height/2,16,0);
  assert.notEqual(await points(result.crossId),beforeCross);
  const beforeJoin=await points(result.joinId);
  await clickEdge(result.joinId);
  const join=await canvas.locator('[data-flow-handle="join"]').boundingBox();
  assert(join);
  await drag(join.x+join.width/2,join.y+join.height/2,0,13);
  assert.notEqual(await points(result.joinId),beforeJoin);
  const afterJoin=await points(result.joinId);
  const box=await canvas.locator(`[data-object="${result.nodeId}"] rect`).first().boundingBox();
  await drag(box.x+box.width/2,box.y+box.height/2,0,12);
  assert.notEqual(await points(result.joinId),afterJoin);
  const [first,second]=await page.evaluate(()=>SOP.project.frontContent.flowGraph.objects.slice(0,2));
  const nodeGroup=id=>canvas.locator(`g[data-object="${id}"][transform]`);
  const svgNodes=()=>canvas.locator('svg g[data-object][transform]').count();
  const beforeAlign=await nodeGroup(second.id).getAttribute('transform');
  const origin=await screen(second.x+second.w/2,second.y+second.h/2);
  await page.keyboard.down('Alt');
  await drag(...origin,16,0);
  await page.keyboard.up('Alt');
  assert.notEqual(await nodeGroup(second.id).getAttribute('transform'),beforeAlign);
  await page.mouse.move(origin[0]+16,origin[1]);await page.mouse.down();
  await page.mouse.move(origin[0]+4,origin[1],{steps:6});
  assert.equal(await canvas.locator('[data-alignment="x"]').count(),1);
  await page.mouse.up();
  assert.equal(await nodeGroup(second.id).getAttribute('transform'),beforeAlign);
  await page.mouse.move(...await screen(first.x-5,first.y-6));await page.mouse.down();
  await page.mouse.move(...await screen(second.x+second.w+5,second.y+second.h+5),{steps:8});
  assert.equal(await canvas.locator('[data-marquee]').count(),1);
  await page.mouse.up();
  assert.match(await canvas.locator('.object-properties strong').textContent(),/已选中 3 个元素/);
  const originalCount=await svgNodes();
  await canvas.getByRole('button',{name:'复制对象'}).click();
  assert.equal(await svgNodes(),originalCount+2);
  await page.keyboard.press('Delete');
  assert.equal(await svgNodes(),originalCount);
  await canvas.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await svgNodes(),originalCount+2);
  await canvas.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await svgNodes(),originalCount);
  await canvas.getByRole('button',{name:'框选',exact:true}).click();
  const selectionStart=await screen(first.x-5,first.y-6),selectionEnd=await screen(second.x+second.w+5,second.y+second.h+5);
  await drag(...selectionStart,selectionEnd[0]-selectionStart[0],selectionEnd[1]-selectionStart[1]);
  const beforeGroup=await nodeGroup(first.id).getAttribute('transform');
  await drag(...await screen(first.x+first.w/2,first.y+first.h/2),-17,10);
  assert.notEqual(await nodeGroup(first.id).getAttribute('transform'),beforeGroup);
  assert.notEqual(await nodeGroup(second.id).getAttribute('transform'),beforeAlign);
  await canvas.getByRole('button',{name:'删除对象'}).click();
  assert.equal(await svgNodes(),originalCount-2);
  await canvas.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await svgNodes(),originalCount);
  await canvas.getByRole('button',{name:'撤销',exact:true}).click();
  assert.equal(await nodeGroup(first.id).getAttribute('transform'),beforeGroup);
  await canvas.getByRole('button',{name:'保存画布'}).click();
  const roundTrip=await page.evaluate(async()=>{
   const p=SOP.project;p.pages.find(page=>page.name==='安装光电传感器').name='安装传感器新版';
   SOP.refresh();
   const blob=await SOP_WORD.exportDocx(p,SOP.layout,SOP.front),bytes=await blob.arrayBuffer();
   const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
   const imported=await SOP_WORD.importDocx(bytes);
   return {renamed:xml.includes('安装传感器新版'),shapes:(xml.match(/name="流程连接 /g)||[]).length,
    geometry:['triangle','diamond','ellipse'].every(type=>xml.includes('prst="'+type+'"')),same:JSON.stringify(imported.frontContent.flowGraph)===JSON.stringify(p.frontContent.flowGraph),
    flowSetup:imported.frontContent.flowSetup.rows.length,bytes: Array.from(new Uint8Array(bytes))};
  });
  assert(roundTrip.renamed&&roundTrip.geometry&&roundTrip.same);
  assert(roundTrip.shapes>21);assert.equal(roundTrip.flowSetup,22);
  if(process.env.SOP_FLOW_QA_OUTPUT)require('node:fs').writeFileSync(path.join(process.env.SOP_FLOW_QA_OUTPUT,'flow.docx'),Buffer.from(roundTrip.bytes));
  await page.evaluate(()=>{
   const node=(id,x,y,w=140,h=54)=>({id,type:'rect',text:id,x,y,w,h,fill:'#fffefe'});
   const p=SOP.clone(SOP.project);
   p.frontContent.flowGraph={width:920,height:540,objects:[
    node('upper',350,100),node('lower',350,260),node('branch-node',50,197,130,50),
    node('third-column',660,184),node('bend-source',85,333,100,40),node('bend-target',700,440,100,40),
    {id:'straight-reference',type:'line',x:462,y:342,w:0,h:145}
   ],edges:[
    {id:'main-snap',from:'upper',to:'lower',route:'down'},
    {id:'branch-snap',from:'branch-node',join:'main-snap',ratio:.5},
    {id:'bend-snap',from:'bend-source',to:'bend-target',route:'across'}
   ]};
   SOP.replaceProject(p);SOP.setSelected('front:flow:0');
  });
  await page.locator('#editFlowGraph').click();
  const moveWithGuide=async(start,end,axis,expected,screenshot)=>{
   await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:7});
   const guide=canvas.locator(`[data-alignment="${axis}"]`);
   assert.equal(Number(await guide.getAttribute(axis+'1')),expected);
   if(screenshot&&process.env.SOP_FLOW_QA_OUTPUT)await canvas.screenshot({path:path.join(process.env.SOP_FLOW_QA_OUTPUT,screenshot)});
   await page.mouse.up();
  };
  // The rectangle's top is exactly aligned with column three at the pointer's position.
  // The branch instead straightens at the nearby join height.
  await moveWithGuide(await screen(115,222),await screen(115,209),'y',207,'branch-snap.png');
  assert.match(await nodeGroup('branch-node').getAttribute('transform'),/ 182\)$/);
  const branchIsFlat=async y=>(await points('branch-snap')).split(' ').every(p=>Math.abs(Number(p.split(',')[1])-y)<.001);
  assert(await branchIsFlat(207));
  const start=await screen(115,207),finish=await screen(115,222);
  await page.keyboard.down('Alt');
  await drag(...start,finish[0]-start[0],finish[1]-start[1]);
  await page.keyboard.up('Alt');
  assert(!(await branchIsFlat(207)));
  const sourceY=Number((await nodeGroup('branch-node').getAttribute('transform')).match(/ ([^ )]+)\)/)[1])+25;
  await clickEdge('branch-snap');
  await moveWithGuide(await screen(420,207),await screen(420,sourceY-2),'y',sourceY);
  assert(await branchIsFlat(sourceY));
  await clickEdge('bend-snap');
  await moveWithGuide(await screen(442.5,406.5),await screen(459,406.5),'x',462);
  assert((await points('bend-snap')).includes('462,353 462,460'));
  assert.deepEqual(errors,[]);
  console.log('PASS: flow layout, labels, marquee, Word roundtrip, and connector snapping for nodes, branch joins, and bends');
 }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
