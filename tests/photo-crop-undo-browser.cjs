const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

(async()=>{
 const server=spawn(process.execPath,['scripts/serve.cjs','--port','0','--json'],{
  cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','inherit']
 });
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';
   server.stdout.on('data',chunk=>{
    output+=chunk;
    if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]).url);
   });
   server.once('error',reject);
   server.once('exit',code=>reject(Error('Test server stopped: '+code)));
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP&&!document.querySelector('#saveBtn').disabled);
  const fixture=await page.evaluate(()=>{
   const image=document.createElement('canvas');
   image.width=320;image.height=180;
   const ctx=image.getContext('2d');
   ctx.fillStyle='#cae7e1';ctx.fillRect(0,0,320,180);
   ctx.fillStyle='#273674';ctx.fillRect(15,35,110,90);
   ctx.fillStyle='#e4a755';ctx.fillRect(190,120,100,60);
   const data=image.toDataURL();
   const rotated=document.createElement('canvas');
   rotated.width=image.height;rotated.height=image.width;
   const rotatedCtx=rotated.getContext('2d');
   rotatedCtx.setTransform(0,1,-1,0,rotated.width,0);
   rotatedCtx.drawImage(image,0,0);
   const rotatedData=rotated.toDataURL();
   const marks=[
    {type:'text',x:.125,y:.125,x2:.125,y2:.125,text:'Outside crop',color:'#db4254'},
    {type:'line',x:.5,y:.5,x2:.625,y2:.625,color:'#280bbc'}
   ];
   const photo={id:'test-photo',type:'photo',x:320,y:60,w:320,h:180,aspectRatio:320/180,data,marks};
   const arrow={id:'test-arrow',type:'arrow',x:100,y:40,w:200,h:55,attachments:{
    end:{targetId:photo.id,relativeX:.125,relativeY:.125}
   }};
   const operation=SOP.blankPage();
   operation.canvas={width:900,height:350,objects:[photo,arrow],edges:[]};
   SOP.replaceProject({...SOP.clone(SOP.project),pages:[operation]});
   return {rotatedData,marks};
  });

  const dialog=page.locator('#photoDialog[open]');
  const surface=dialog.locator('#annotationCanvas');
  const undo=dialog.getByRole('button',{name:'撤销裁剪'});
  async function openPhoto(){
   await page.locator('#photoGrid').getByRole('button',{name:'标注 / 裁剪'}).click();
   await dialog.waitFor();
   assert(await undo.isDisabled(),'A new editor session must start without crop history');
  }
  async function applyCrop(){
   await dialog.getByRole('button',{name:'裁剪',exact:true}).click();
   const box=await surface.boundingBox();
   await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);
   await page.mouse.down();
   await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75,{steps:5});
   await page.mouse.up();
   await dialog.getByRole('button',{name:'应用裁剪'}).click();
   await page.locator('#undoCrop:enabled').waitFor();
  }
  const model=()=>page.evaluate(()=>SOP.project.pages[0].canvas);
  const pixels=()=>surface.evaluate(canvas=>canvas.toDataURL());
  const size=()=>surface.evaluate(canvas=>[canvas.width,canvas.height]);
  const rotate=async()=>{
   const [width,height]=await size();
   await dialog.getByRole('button',{name:'旋转 90°'}).click();
   await page.waitForFunction(([width,height])=>{
    const canvas=document.querySelector('#annotationCanvas');
    return canvas.width===height&&canvas.height===width;
   },[width,height]);
  };

  const original=await model();
  await openPhoto();
  const originalSize=await size(),originalPixels=await pixels();
  await applyCrop();
  assert.deepEqual(await size(),originalSize.map(value=>value/2));
  await undo.click();
  assert.deepEqual(await size(),originalSize);
  assert(await pixels()===originalPixels,'Undo must restore the original pixels and marks exactly');
  assert(await undo.isDisabled());
  await dialog.locator('#closePhoto').click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await model(),original,'Undoing the only change must leave the saved canvas intact');

  await openPhoto();
  await rotate();
  const rotatedPixels=await pixels(),rotatedSize=await size();
  await applyCrop();
  await dialog.getByRole('button',{name:'文字',exact:true}).click();
  await surface.click({position:{x:20,y:25}});
  await rotate();
  const laterPixels=await pixels();
  let confirmation;
  page.once('dialog',async prompt=>{confirmation=prompt.message();await prompt.dismiss();});
  await undo.click();
  assert.match(confirmation,/裁剪后对这张图片的编辑也会一并撤销/);
  assert(await pixels()===laterPixels,'Cancel must preserve later rotation and annotation');
  page.once('dialog',prompt=>prompt.accept());
  await undo.click();
  assert.deepEqual(await size(),rotatedSize);
  assert(await pixels()===rotatedPixels,'Undo must restore the draft as it was after the earlier rotation');
  await dialog.getByRole('button',{name:'保存图片标注'}).click();
  await dialog.waitFor({state:'hidden'});
  const saved=await model();
  const photo=saved.objects.find(object=>object.id==='test-photo');
  const arrow=saved.objects.find(object=>object.id==='test-arrow');
  assert(photo.data===fixture.rotatedData,'The project must preserve the exact pre-crop image data');
  assert.deepEqual(photo.marks,fixture.marks.map(mark=>({...mark,x:1-mark.y,y:mark.x,x2:1-mark.y2,y2:mark.x2})));
  assert.deepEqual(arrow.attachments.end,{targetId:'test-photo',relativeX:.875,relativeY:.125});
  const endpoints=await page.evaluate(arrow=>SOP_OBJECTS.lineEndpoints(arrow),arrow);
  assert.equal(endpoints.x2,photo.x+photo.w*.875);
  assert.equal(endpoints.y2,photo.y+photo.h*.125);

  await openPhoto();
  await applyCrop();
  const firstCrop=await pixels();
  await applyCrop();
  await undo.click();
  assert(await pixels()===firstCrop,'Undo must restore only the most recent crop');
  assert(await undo.isDisabled());
  await dialog.locator('#closePhoto').click();
  await page.getByRole('button',{name:'放弃更改'}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await model(),saved,'Discard must leave the previously saved canvas intact');
  await openPhoto();
  await dialog.locator('#closePhoto').click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS: crop undo restores exact pixels, marks and attachments, handles later edits, and is limited to one crop per session');
 }finally{
  await browser?.close();
  server.kill();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
