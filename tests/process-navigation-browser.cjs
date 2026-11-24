'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');

async function main(){
 const root = path.resolve(__dirname,'..');
 const server = spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{
  cwd:root,stdio:['ignore','pipe','inherit'],windowsHide:true
 });
 let browser;
 try{
  const url = await new Promise((resolve,reject)=>{
   let output='';
   server.stdout.on('data',chunk=>{
    output+=chunk;
    if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]).url);}catch(error){reject(error);}
   });
   server.on('error',reject);
   server.on('exit',code=>reject(Error('Preview server exited: '+code)));
  });
  browser = await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP?.layout.length);
  const longCode='AB0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const longName='验证工序名称在狭窄侧栏保持完整可读，不遮挡拖动手柄和后续项目';
  await page.evaluate(({longCode,longName})=>{
   const project=SOP.clone(SOP.project);
   for(const key of ['originalFront','frontContent','nativeWord','pageOrder'])delete project[key];
   Object.assign(project.settings,{cover:true,history:true,flow:true});
   const first={...SOP.blankPage(),name:'上盖预装',processLabel:'A-01',steps:'工序首张'};
   const continuation={...SOP.blankPage(first.processId),name:first.name,processLabel:first.processLabel,steps:'工序续页'};
   project.pages=[
    first,continuation,{...SOP.blankPage(),name:'轴承检查',processLabel:'010'},
    {...SOP.blankPage(),name:'扭力复核'},{...SOP.blankPage(),name:longName,processLabel:longCode}
   ];
   SOP.replaceProject(project);
  },{longCode,longName});
  const nav=page.locator('#navList');
  const titles=()=>nav.locator('strong').allTextContents();
  const row=index=>nav.locator('[data-document-index="'+index+'"]');
  const current=()=>nav.locator('[aria-current="true"] strong').textContent();
  const badges=()=>nav.locator('.nav-num').evaluateAll(nodes=>nodes.map(node=>node.firstChild.nodeType===Node.TEXT_NODE?node.firstChild.textContent:''));
  const fronts=['封面','修改履历','工艺流程图'];
  const longTitle=longCode+' · '+longName;
  assert.deepEqual(await titles(),[...fronts,'A-01 · 上盖预装','010 · 轴承检查','03 · 扭力复核',longTitle]);
  assert.deepEqual(await badges(),['—','—','—','','','','']);
  await row(5).click();
  assert.equal(await page.locator('#nameInput').inputValue(),'轴承检查');
  assert.equal(await current(),'010 · 轴承检查');
  await page.locator('#processLabelInput').fill('0010');
  await nav.getByText('0010 · 轴承检查',{exact:true}).waitFor();

  await page.locator('#pageView').click();
  assert.deepEqual(await titles(),[...fronts,'上盖预装','上盖预装','轴承检查','扭力复核',longName]);
  assert.deepEqual(await badges(),['—','—','—','1','2','3','4','5']);
  await row(4).click();
  assert.equal(await page.locator('#stepsInput').inputValue(),'工序续页');
  assert(await row(4).evaluate(node=>node.getAttribute('aria-current')==='true'));
  await page.locator('#processView').click();
  assert.equal(await current(),'A-01 · 上盖预装');
  await row(3).click();
  assert.equal(await page.locator('#stepsInput').inputValue(),'工序首张');

  await row(5).dragTo(row(3));
  assert.equal(await current(),'轴承检查');
  assert.equal(await page.locator('#pageView').evaluate(node=>node.classList.contains('active')),true);
  assert.deepEqual(await titles(),[...fronts,'轴承检查','上盖预装','上盖预装','扭力复核',longName]);
  assert.deepEqual(await badges(),['—','—','—','1','2','3','4','5']);
  await page.locator('#processView').click();
  assert.equal(await current(),'0010 · 轴承检查');
  assert.deepEqual(await titles(),[...fronts,'0010 · 轴承检查','A-01 · 上盖预装','03 · 扭力复核',longTitle]);

  for(const width of [900,360]){
   await page.setViewportSize({width,height:1000});
   const fullTextFits=await nav.locator('strong').filter({hasText:longCode}).evaluate(heading=>{
    const range=document.createRange();
    range.selectNodeContents(heading);
    const lines=[...range.getClientRects()];
    const box=heading.getBoundingClientRect();
    const list=heading.closest('.nav-list');
    return lines.length>1&&lines.every(line=>line.left>=box.left-1&&line.right<=box.right+1)&&
     list.scrollWidth<=list.clientWidth+1;
   });
   assert(fullTextFits,'Long number and name wrap inside the sidebar at '+width+'px');
  }
  await page.setViewportSize({width:1440,height:1050});
  await row(6).dragTo(row(7));
  assert.deepEqual((await titles()).slice(-2),[longName,'扭力复核']);
  assert.equal(await current(),'扭力复核');

  const groupOrder=await page.evaluate(()=>{
   const project=SOP.clone(SOP.project);
   const group=(name,number)=>{
    const first={...SOP.blankPage(),name,processLabel:number,steps:name+'首页',notes:name+'备注'};
    return [first,{...SOP.blankPage(first.processId),name,processLabel:number,steps:name+'续页'}];
   };
   const [a,aNext]=group('上盖预装','A-01');
   const [b,bNext]=group('轴承检查','B-01');
   const c={...SOP.blankPage(),name:'包装'};
   const key=operation=>'body:'+operation.id+':0';
   project.pages=[a,aNext,b,bNext,c];
   project.pageOrder=['front:cover:0',key(a),'front:history:0',key(aNext),'front:flow:0',key(b),key(bNext),key(c)];
   SOP.replaceProject(project);
   return {front:project.pageOrder.filter(key=>key.startsWith('front:')),A:[key(a),key(aNext)],B:[key(b),key(bNext)],C:key(c)};
  });
  const order=()=>page.evaluate(()=>SOP.project.pageOrder);
  await page.locator('#processView').click();
  await row(1).dragTo(row(5));
  assert.deepEqual(await order(),[...groupOrder.front,...groupOrder.B,...groupOrder.A,groupOrder.C]);
  assert.equal(await current(),'上盖预装');
  assert.equal(await page.locator('#stepsInput').inputValue(),'上盖预装首页');
  assert.deepEqual(await badges(),['—','—','—','1','2','3','4','5']);

  await page.locator('#processView').click();
  await row(5).dragTo(row(3));
  assert.deepEqual(await order(),[...groupOrder.front,...groupOrder.A,...groupOrder.B,groupOrder.C]);
  assert.equal(await page.locator('#stepsInput').inputValue(),'上盖预装首页');
  const groupData=await page.evaluate(()=>SOP.project.pages.slice(0,4).map(page=>[page.processId,page.processLabel,page.steps,page.notes]));
  assert.equal(groupData[0][0],groupData[1][0]);
  assert.equal(groupData[2][0],groupData[3][0]);
  assert.deepEqual(groupData.map(([,label,steps,notes])=>[label,steps,notes]),[
   ['A-01','上盖预装首页','上盖预装备注'],['A-01','上盖预装续页',''],
   ['B-01','轴承检查首页','轴承检查备注'],['B-01','轴承检查续页','']
  ]);

  await row(6).dragTo(row(3));
  assert.deepEqual(await order(),[...groupOrder.front,groupOrder.B[1],...groupOrder.A,groupOrder.B[0],groupOrder.C]);
  assert.equal(await page.locator('#stepsInput').inputValue(),'轴承检查续页');

  await page.locator('#processView').click();
  await row(4).click();
  await page.locator('#moveBtn').click();
  await page.locator('#moveMode').selectOption('swap');
  await page.locator('#moveDestination').selectOption('7');
  await page.locator('#dialogApply').click();
  assert.deepEqual(await order(),[...groupOrder.front,groupOrder.B[1],groupOrder.C,groupOrder.A[1],groupOrder.B[0],groupOrder.A[0]]);
  assert.equal(await page.locator('#stepsInput').inputValue(),'上盖预装首页');

  assert.deepEqual(errors,[]);
  console.log('PASS: process labels, page numbering, continuation selection, grouped forward and backward drag, single-page drag and narrow sidebar wrapping');
 }finally{
  if(browser)await browser.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
