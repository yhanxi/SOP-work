'use strict';
const path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,stdio:['ignore','pipe','inherit'],windowsHide:true});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const line=output.split('\n')[0];if(output.includes('\n'))try{resolve(JSON.parse(line).url);}catch(e){reject(e);}});server.on('error',reject);server.on('exit',code=>reject(Error('Preview server exited: '+code)));});
  browser=await chromium.launch({headless:true,...(process.env.SOP_TEST_BROWSER?{executablePath:process.env.SOP_TEST_BROWSER}:{})});
  const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.SOP?.layout.length===1);
  assert.equal(await page.evaluate(()=>SOP.project.settings.company),'');
  await page.locator('#settingsBtn').click();await page.locator('[data-setting="company"]').fill('示例制造有限公司');await page.locator('#logoFile').setInputFiles(path.join(root,'desktop/build/icon.png'));await page.waitForFunction(()=>document.querySelector('#settingsLogo').src.startsWith('data:image/png'));await page.locator('#dialogApply').click();
  const result=await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project);project.pages[0].name='准备';project.pages[0].steps='1、准备工具。';project.pages.push({...SOP.blankPage(),name:'检查',steps:'1、检查工件。'});project.pages.push({...SOP.blankPage(),name:'包装',steps:'1、包装入库。'});SOP.replaceProject(project);SOP.moveRenderedPage(0,2);
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string'),round=await SOP_WORD.importDocx(await blob.arrayBuffer());
   return {names:SOP.layout.map(p=>p.name),numbering:SOP.layout.every((p,i)=>p.pageNo===i+1&&p.total===3),front:SOP.front.map(f=>f.kind),company:round.settings.company,logo:round.settings.logo===SOP.project.settings.logo,editableFlow:xml.includes('流程节点'),logoInWord:xml.includes('descr="公司 Logo"')};
  });
  assert.deepEqual(result.names,['检查','包装','准备']);assert.deepEqual(result.front,['cover','history','flow']);assert(result.numbering&&result.logo&&result.editableFlow&&result.logoInWord);assert.equal(result.company,'示例制造有限公司');
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.SOP?.project.settings.company==='示例制造有限公司');assert.deepEqual(errors,[]);
  console.log('PASS: browser launch, company/logo, page order/numbering, editable Word roundtrip and autosave');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
