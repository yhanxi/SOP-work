'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,stdio:['ignore','pipe','inherit'],windowsHide:true});let browser;
 try{
  const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]).url);}catch(e){reject(e);}});server.on('error',reject);});
  browser=await chromium.launch({headless:true,...(process.env.SOP_TEST_BROWSER?{executablePath:process.env.SOP_TEST_BROWSER}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#saveBtn').disabled);
  await page.evaluate(async()=>{const dir=await navigator.storage.getDirectory();window.testHandles={a:await dir.getFileHandle('a.sop.json',{create:true}),b:await dir.getFileHandle('b.sop.json',{create:true})};window.testPick='a';window.showSaveFilePicker=async()=>{if(window.testPick==='cancel')throw new DOMException('Canceled','AbortError');return testHandles[window.testPick];};window.showOpenFilePicker=async()=>[testHandles[window.testPick]];});
  const edit=value=>page.evaluate(value=>{SOP.project.pages[0].steps=value;SOP.changed();},value);
  const disk=key=>page.evaluate(async key=>JSON.parse(await (await testHandles[key].getFile()).text()).pages[0].steps,key);
  const saved=()=>page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('项目文件已保存')&&!document.querySelector('#saveBtn').disabled);
  await edit('first');await page.locator('#saveBtn').click();await saved();assert.equal(await disk('a'),'first');assert.equal(await page.evaluate(()=>document.body.dataset.recovery),'saved');
  await edit('second');await page.keyboard.press('Control+s');await saved();assert.equal(await disk('a'),'second');
  await page.evaluate(()=>window.testPick='cancel');await edit('cancelled');await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!document.querySelector('#saveBtn').disabled);assert.equal(await disk('a'),'second');
  await page.evaluate(()=>window.testPick='b');await page.keyboard.press('Control+Shift+s');await saved();assert.equal(await disk('a'),'second');assert.equal(await disk('b'),'cancelled');
  await edit('guard');await page.locator('#newBtn').click();await page.locator('.file-save-prompt').waitFor({state:'visible'});await page.locator('[data-choice="cancel"]').click();assert.equal(await page.evaluate(()=>SOP.project.pages[0].steps),'guard');
  await page.evaluate(async()=>{const writer=await testHandles.b.createWritable();await writer.write(JSON.stringify({...SOP.project,pages:[{...SOP.project.pages[0],steps:'external'}]}));await writer.close();});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!document.querySelector('#saveBtn').disabled);assert.equal(await disk('b'),'external');
  await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>!document.querySelector('#saveBtn').disabled);assert.equal(await page.evaluate(()=>SOP.project.pages[0].steps),'guard');assert((await page.locator('#saveState').textContent()).includes('未保存修改'));
  // Unsupported browsers download a copy and never report an overwrite as complete.
  await page.evaluate(()=>window.showSaveFilePicker=undefined);const download=page.waitForEvent('download');await page.locator('#saveBtn').click();await download;assert((await page.locator('#saveState').textContent()).includes('未保存修改'));assert((await page.locator('#toast').textContent()).includes('不能直接更新原文件'));
  assert.deepEqual(errors,[]);console.log('PASS: browser file-handle save, Ctrl+S, Save As, cancellation, external conflict, dirty recovery and honest download fallback');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
