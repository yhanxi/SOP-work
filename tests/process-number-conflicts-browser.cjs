'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.SOP_PLAYWRIGHT_MODULE || 'playwright');

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,stdio:['ignore','pipe','inherit'],windowsHide:true});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';
   server.stdout.on('data',chunk=>{
    output+=chunk;
    if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]).url);}catch(error){reject(error);}
   });
   server.on('error',reject);
   server.on('exit',code=>reject(Error('Preview server exited: '+code)));
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1050}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP?.layout.length&&!document.querySelector('#saveBtn').disabled);
  const fixture=rows=>page.evaluate(rows=>{
   const project=SOP.clone(SOP.project);
   for(const key of ['originalFront','frontContent','nativeWord','pageOrder'])delete project[key];
   Object.assign(project.settings,{cover:false,history:false,flow:false});
   project.pages=[];
   for(const [name,processLabel,continued] of rows){
    const parent=continued?project.pages.at(-1):null;
    project.pages.push({...SOP.blankPage(parent?.processId),name,processLabel,steps:'完成 '+name});
   }
   SOP.replaceProject(project);
  },rows);
  const label=page.locator('#processLabelInput');
  const warning=page.locator('#processNumberWarning');
  const message=page.locator('#processNumberMessage');
  const row=index=>page.locator('#navList [data-document-index="'+index+'"]');
  const active=()=>page.evaluate(()=>document.activeElement.id);
  await fixture([['上盖预装','A-01']]);
  await warning.waitFor({state:'hidden'});

  await page.locator('[data-tab="quality"]').click();
  await page.locator('#copyBtn').click();
  await warning.waitFor({state:'visible'});
  assert.match(await message.textContent(),/A-01.*上盖预装/);
  assert.equal(await active(),'processLabelInput');
  assert.deepEqual(await label.evaluate(input=>[input.selectionStart,input.selectionEnd]),[0,4]);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>SOP.project.pages.length),1);
  await warning.waitFor({state:'hidden'});
  await page.locator('#copyBtn').click();
  await warning.waitFor({state:'visible'});
  await page.locator('#previewAllBtn').click();
  await page.locator('#previewDialog[open]').waitFor();
  assert.equal(await page.locator('#fullPreview .process-number-warning').count(),0);
  await page.locator('#closePreview').click();
  const wordDetail=page.waitForEvent('download');
  await page.locator('#docxBtn').click();
  const word=await wordDetail;
  const bytes=await fs.readFile(await word.path());
  const wordResult=await page.evaluate(async data=>{
   const zip=await JSZip.loadAsync(Uint8Array.from(data)),raw=await zip.file('word/document.xml').async('string');
   const document=new DOMParser().parseFromString(raw,'application/xml');
   const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   return {
    labels:[...document.getElementsByTagNameNS(W,'tbl')].map(table=>
     table.getElementsByTagNameNS(W,'tr')[3].getElementsByTagNameNS(W,'tc')[0].textContent),
    hasWarning:document.documentElement.textContent.includes('重复')
   };
  },Array.from(bytes));
  assert.deepEqual(wordResult,{labels:['A-01','A-01'],hasWarning:false});

  await page.evaluate(async()=>{
   const dir=await navigator.storage.getDirectory();
   window.numberConflictFile=await dir.getFileHandle('process-number-conflicts.sop.json',{create:true});
   window.showSaveFilePicker=async()=>numberConflictFile;
  });
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('项目文件已保存'));
  const saved=await page.evaluate(async()=>(await numberConflictFile.getFile()).text());
  assert.deepEqual(JSON.parse(saved).pages.map(operation=>operation.processLabel),['A-01','A-01']);
  assert(!saved.includes('processNumberWarning'));

  await label.fill('A-02');
  await warning.waitFor({state:'hidden'});
  assert.equal(await active(),'processLabelInput');
  await label.fill('A-01');
  await warning.waitFor({state:'visible'});
  assert.equal(await active(),'processLabelInput');
  await label.fill('A-02');
  await warning.waitFor({state:'hidden'});
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('项目文件已保存'));

  await page.locator('#importFile').setInputFiles({name:'已有重号.sop.json',mimeType:'application/json',buffer:Buffer.from(saved)});
  await warning.waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>SOP.project.pages.map(operation=>operation.processLabel)),['A-01','A-01']);
  assert.equal(await label.inputValue(),'A-01');
  await row(1).click();
  assert.match(await message.textContent(),/A-01.*上盖预装/);
  await page.locator('[data-tab="quality"]').click();
  await page.locator('#editDuplicateProcessNumber').click();
  assert.equal(await active(),'processLabelInput');
  await label.fill('A-02');
  await warning.waitFor({state:'hidden'});

  await fixture([['同组首页','010'],['同组续页','010',true],['无前导零','10']]);
  await warning.waitFor({state:'hidden'});
  await page.locator('#pageView').click();
  await row(1).click();
  assert.equal(await label.inputValue(),'010');
  await warning.waitFor({state:'hidden'});
  await row(2).click();
  await warning.waitFor({state:'hidden'});

  await fixture([['手工编号','03'],['自动编号',''],['最后一道','B-02']]);
  await warning.waitFor({state:'hidden'});
  await row(1).click();
  await page.locator('#downBtn').click();
  await warning.waitFor({state:'visible'});
  assert.match(await message.textContent(),/03.*手工编号/);
  await row(0).click();
  assert.match(await message.textContent(),/03.*自动编号/);
  await label.fill('003');
  await warning.waitFor({state:'hidden'});

  await fixture([['手工编号','03'],['第二道','']]);
  await row(1).click();
  await page.locator('#addBtn').click();
  await warning.waitFor({state:'visible'});
  assert.equal(await label.inputValue(),'');
  assert.match(await message.textContent(),/03.*手工编号/);
  assert.notEqual(await active(),'processLabelInput');
  assert.deepEqual(errors,[]);
  console.log('PASS: duplicate labels detected on copy, edit, legacy load, move and add; continuation and leading zeros, focus, file save, preview and Word verified');
 }finally{
  if(browser)await browser.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
