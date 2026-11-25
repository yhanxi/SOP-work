'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');
const Zip = require('../outputs/SOP工作台/vendor/jszip.min.js');

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,['scripts/serve.cjs','--port','0'],{cwd:root,windowsHide:true});
 let browser;
 try{
  const [output]=await once(server.stdout,'data');
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1050}});
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(JSON.parse(output.toString()).url);
  await page.waitForFunction(()=>window.SOP?.layout.length&&!document.querySelector('#saveBtn').disabled);

  const nav=page.locator('#navList');
  const row=name=>nav.locator('.nav-item').filter({has:page.locator('strong').filter({hasText:name})});
  const category=page.locator('#processCategoryInput');
  const labelInput=page.locator('#processLabelInput');
  const stationInput=page.locator('[data-meta="station"]');
  const paper=page.locator('#previewStage');
  const fields=()=>paper.locator('[data-print-target="processLabel"], [data-print-target="station"]').allTextContents();
  const numbers=()=>page.evaluate(()=>SOP.layout.map(operation=>[
   SOP_TEMPLATE.operationLabel(operation),SOP_TEMPLATE.stationLabel(operation)
  ]));
  await page.evaluate(()=>{
   const project=SOP.clone(SOP.project);
   for(const key of ['originalFront','frontContent','nativeWord','pageOrder'])delete project[key];
   Object.assign(project.settings,{cover:true,history:true,flow:true});
   project.pages=['预装一','预装二','预装三','预装四','组装一','组装二','组装三','组装四','通电检查'].map((name,index)=>({
    ...SOP.blankPage(),name,steps:'完成'+name,processCategory:index<4?'Y':index<8?'Z':'C'
   }));
   const test=project.pages.at(-1);
   project.pages.push({...SOP.blankPage(test.processId),name:test.name,steps:'通电检查续页'});
   SOP.replaceProject(project);
  });
  assert.deepEqual(await numbers(),[
   ['01预装','Y01'],['02预装','Y02'],['03预装','Y03'],['04预装','Y04'],
   ['05组装','Z01'],['06组装','Z02'],['07组装','Z03'],['08组装','Z04'],['09测试','C01'],['09测试','C01']
  ]);
  await row('通电检查').dragTo(row('组装三'));
  assert.deepEqual((await numbers()).slice(-4),[['07测试','C01'],['07测试','C01'],['08组装','Z03'],['09组装','Z04']]);
  await page.locator('#processView').click();
  assert.equal(await row('通电检查').locator('strong').textContent(),'07测试 · 通电检查');
  assert.equal(await row('组装三').locator('strong').textContent(),'08组装 · 组装三');
  assert.equal(await row('组装四').locator('strong').textContent(),'09组装 · 组装四');
  await row('通电检查').click();
  assert.deepEqual(await fields(),['07测试','C01']);
  assert.equal(await labelInput.inputValue(),'07测试');
  assert.equal(await stationInput.inputValue(),'C01');
  assert.equal(await labelInput.isEditable(),false);
  assert.equal(await stationInput.isEditable(),false);

  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#wordProofBtn').click()]);
  assert.match(download.suggestedFilename(),/07测试_通电检查_Word校样\.docx$/);
  const zip=await Zip.loadAsync(await fs.readFile(await download.path()));
  const word=await zip.file('word/document.xml').async('string');
  assert.match(word,/>07测试<\/w:t>/);
  assert.match(word,/>C01<\/w:t>/);
  assert.doesNotMatch(word,/通电检查续页|完成组装三|完成组装四/);
  assert.match(await zip.file('docProps/app.xml').async('string'),/<Pages>1<\/Pages>/);

  await page.locator('#pageView').click();
  await row('通电检查').last().click();
  assert.equal(await page.locator('#stepsInput').inputValue(),'通电检查续页');
  assert.deepEqual(await fields(),['07测试','C01']);
  await category.selectOption('Z');
  assert.deepEqual((await numbers()).slice(-4),[['07组装','Z03'],['07组装','Z03'],['08组装','Z04'],['09组装','Z05']]);
  assert.deepEqual(await fields(),['07组装','Z03']);

  await page.locator('#addBtn').click();
  assert.deepEqual((await numbers()).slice(-5),[
   ['07组装','Z03'],['07组装','Z03'],['08组装','Z04'],['09组装','Z05'],['10组装','Z06']
  ]);
  assert.deepEqual(await fields(),['08组装','Z04']);
  await page.locator('#deleteBtn').click();
  assert.deepEqual((await numbers()).slice(-4),[['07组装','Z03'],['07组装','Z03'],['08组装','Z04'],['09组装','Z05']]);

  await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project);
   delete project.pageOrder;
   Object.assign(project.settings,{cover:false,history:false,flow:false});
   project.pages=[
    {...SOP.blankPage(),name:'旧项目工序',processLabel:'0010',station:'W09'},
    {...SOP.blankPage(),name:'识别编号的工序',processLabel:'05预装',station:'W05'}
   ];
   for(const operation of project.pages)delete operation.processCategory;
   SOP.replaceProject(project);
   const dir=await navigator.storage.getDirectory();
   window.testProjectFile=await dir.getFileHandle('process-category.sop.json',{create:true});
   window.showSaveFilePicker=async()=>window.testProjectFile;
  });
  assert.equal(await category.inputValue(),'');
  assert.deepEqual(await fields(),['0010','W09']);
  await category.selectOption('B');
  assert.deepEqual(await fields(),['01包装','B01']);
  await category.selectOption('');
  assert.deepEqual(await fields(),['0010','W09']);
  assert.equal(await labelInput.isEditable(),true);
  assert.equal(await stationInput.isEditable(),true);

  await page.locator('#batchProcessNumbers').click();
  await page.locator('#detectBatchCategories').click();
  assert.equal(await page.getByLabel('识别编号的工序 的工序类别').inputValue(),'Y');
  assert.equal(await page.locator('[data-batch-preview="1"]').textContent(),'02预装 ／ Y01');
  await page.locator('#dialogApply').click();
  assert.deepEqual(await numbers(),[['0010','W09'],['02预装','Y01']]);
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('项目文件已保存'));
  const saved=await page.evaluate(async()=>(await testProjectFile.getFile()).text());
  const [legacy,categorized]=JSON.parse(saved).pages;
  assert.deepEqual([legacy.processLabel,legacy.station],['0010','W09']);
  assert.deepEqual([categorized.processCategory,categorized.processLabel,categorized.station],['Y','05预装','W05']);
  await row('识别编号的工序').click();
  assert.equal(await category.inputValue(),'Y');
  await page.locator('#importFile').setInputFiles({name:'旧项目.sop.json',mimeType:'application/json',buffer:Buffer.from(saved)});
  await page.waitForFunction(()=>!document.querySelector('#saveBtn').disabled&&document.querySelector('#nameInput')?.value==='旧项目工序');
  assert.equal(await category.inputValue(),'');
  assert.deepEqual(await fields(),['0010','W09']);
  assert.deepEqual(await numbers(),[['0010','W09'],['02预装','Y01']]);

  assert.deepEqual(errors,[]);
  console.log('PASS: category numbering after grouped drag, continuation, category changes, insertion and deletion, batch detection, legacy save and single-page Word proof');
 }finally{
  if(browser)await browser.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
