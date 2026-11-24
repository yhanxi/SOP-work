'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {crc32,deflateSync}=require('node:zlib');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

function compactMonochrome(width,height){
 const chunk=(name,data)=>{
  const key=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([key,data])));
  return Buffer.concat([length,key,data,checksum]);
 };
 const header=Buffer.alloc(13);
 header.writeUInt32BE(width);
 header.writeUInt32BE(height,4);
 header[8]=1;
 const rowBytes=Math.ceil(width/8)+1;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),
  chunk('IDAT',deflateSync(Buffer.alloc(rowBytes*height),{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,stdio:['ignore','pipe','inherit'],windowsHide:true});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';
   server.stdout.on('data',buffer=>{
    output+=buffer;
    if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]).url);}catch(error){reject(error);}
   });
   server.on('error',reject);
   server.on('exit',code=>reject(Error('Preview server exited: '+code)));
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({viewport:{width:1500,height:1060}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP&&!document.querySelector('#saveBtn').disabled);
  const real=process.env.SOP_CANVAS_PHOTO_FIXTURE;
  const original=real?'data:image/jpeg;base64,'+fs.readFileSync(real).toString('base64'):await page.evaluate(()=>{
   const canvas=document.createElement('canvas');
   canvas.width=2600;
   canvas.height=1800;
   const context=canvas.getContext('2d'),gradient=context.createLinearGradient(0,0,2600,1800);
   gradient.addColorStop(0,'#324aa0');
   gradient.addColorStop(1,'#a4cca0');
   context.fillStyle=gradient;
   context.fillRect(0,0,canvas.width,canvas.height);
   return canvas.toDataURL('image/jpeg',.98);
  });
  const fixture=await page.evaluate(async ({source,synthetic})=>{
   const image=new Image();image.src=source;await image.decode();
   const canvas=document.createElement('canvas');
   canvas.width=canvas.height=1700;
   const context=canvas.getContext('2d'),square=Math.min(image.naturalWidth,image.naturalHeight);
   if(image.naturalWidth>0)context.drawImage(image,(image.naturalWidth-square)/2,(image.naturalHeight-square)/2,square,square,0,0,1700,1700);
   if(synthetic){
    const pixels=context.getImageData(0,0,1700,1700);
    let random=2413;
    for(let i=0;i<pixels.data.length;i+=4){
     random=(random*1664525+1013904223)>>>0;
     const index=i/4,x=index%1700,y=Math.floor(index/1700);
     pixels.data[i]=45+x/15+(random&31);
     pixels.data[i+1]=70+y/14+((random>>>8)&31);
     pixels.data[i+2]=85+(x+y)/36+((random>>>16)&31);
    }
    context.putImageData(pixels,0,0);
   }
   const opaque=canvas.toDataURL('image/png');
   canvas.width=2400;canvas.height=1000;
   context.clearRect(0,0,2400,1000);
   context.globalAlpha=.5;
   context.fillStyle='#4466ee';
   context.fillRect(700,180,1520,640);
   const transparent=canvas.toDataURL();
   canvas.width=75;canvas.height=50;
   context.globalAlpha=.4;context.fillStyle='#008844';context.fillRect(8,8,35,20);
   return {width:image.naturalWidth,height:image.naturalHeight,opaque,transparent,small:canvas.toDataURL()};
  },{source:original,synthetic:!real});
  assert(Math.max(fixture.width,fixture.height)>1800);
  const file=(name,data)=>({name,mimeType:data.match(/^data:([^;]+)/)[1],buffer:Buffer.from(data.split(',')[1],'base64')});
  const bytes=data=>Buffer.from(data.split(',')[1],'base64').length;
  assert(bytes(fixture.opaque)>1.5*1024*1024);
  const highRes='data:image/png;base64,'+compactMonochrome(3200,2400).toString('base64');
  const checks=await page.evaluate(async ({opaque,transparent,small,highRes})=>{
   const P=SOP_OBJECTS;
   const result=await P.readPhoto(opaque),alpha=await P.readPhoto(transparent);
   const png=new Image();png.src=alpha.data;await png.decode();
   const pixel=document.createElement('canvas');pixel.width=pixel.height=1;
   const context=pixel.getContext('2d');context.drawImage(png,0,0);
   const borderAlpha=context.getImageData(0,0,1,1).data[3];
   context.clearRect(0,0,1,1);
   context.drawImage(png,png.naturalWidth/2,png.naturalHeight/2,1,1,0,0,1,1);
   return {opaque:{data:result.data,width:result.width,height:result.height},
    transparent:{type:alpha.data.split(';')[0],width:alpha.width,borderAlpha,centerAlpha:context.getImageData(0,0,1,1).data[3]},
    small:(await P.readPhoto(small)).data===small,highResolution:(await P.readPhoto(highRes)).data===highRes};
  },{...fixture,highRes});
  assert.equal(checks.opaque.data.split(';')[0],'data:image/jpeg');
  assert(bytes(checks.opaque.data)<=bytes(fixture.opaque)*.8);
  assert.deepEqual([checks.opaque.width,checks.opaque.height],[1700,1700]);
  assert.deepEqual(checks.transparent,{type:'data:image/png',width:1800,borderAlpha:0,centerAlpha:128});
  assert(checks.small&&checks.highResolution);

  const dialog=page.locator('.object-dialog');
  const photos=()=>page.evaluate(()=>SOP.project.pages[0].canvas?.objects.filter(o=>o.type==='photo')||[]);
  const open=()=>page.locator('#editPageCanvas').click();
  const save=()=>dialog.locator('[data-action="save"]').click();
  const preview=dialog.locator('.object-stage svg image');
  const size=async data=>page.evaluate(async data=>{
   const im=new Image();im.src=data;await im.decode();return [im.naturalWidth,im.naturalHeight];
  },data);
  await open();
  await dialog.locator('#objectPhoto').setInputFiles(file('camera.jpg',original));
  await dialog.locator('.object-message').filter({hasText:'已添加图片'}).waitFor();
  assert.equal(await preview.count(),1);
  await dialog.locator('#objectPhoto').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});
  await dialog.locator('.object-message').filter({hasText:'无法读取'}).waitFor();
  assert.equal(await preview.count(),1);
  await page.evaluate(()=>{
   window.savedImageEncoder=HTMLCanvasElement.prototype.toDataURL;
   HTMLCanvasElement.prototype.toDataURL=()=> 'data:,';
  });
  await dialog.locator('#objectPhoto').setInputFiles(file('encode-failure.png',fixture.transparent));
  await dialog.locator('.object-message').filter({hasText:'无法编码'}).waitFor();
  await page.evaluate(()=>HTMLCanvasElement.prototype.toDataURL=window.savedImageEncoder);
  assert.equal(await preview.count(),1);
  await page.evaluate(data=>{
   const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0)),transfer=new DataTransfer();
   transfer.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));
   document.querySelector('.object-stage').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:transfer}));
  },fixture.transparent);
  await dialog.locator('.object-message').filter({hasText:'已粘贴图片'}).waitFor();
  await save();
  let [camera,pasted]=await photos();
  assert.equal(Math.max(...await size(camera.data)),1800);
  assert(bytes(camera.data)<bytes(original));
  assert(Math.abs(camera.w/camera.h-fixture.width/fixture.height)<.01);
  assert.equal(Math.max(...await size(pasted.data)),1800);

  const photoCard=page.locator('[data-canvas-photo]').first();
  await photoCard.locator('button[data-edit-photo]').click();
  await page.locator('#photoDialog[open]').waitFor();
  const surface=page.locator('#annotationCanvas');
  await page.locator('[data-tool="text"]').click();
  const annotation=await surface.boundingBox();
  await page.mouse.click(annotation.x+annotation.width*.32,annotation.y+annotation.height*.37);
  await page.locator('#savePhoto').click();
  await page.locator('#photoDialog').waitFor({state:'hidden'});
  [camera]=await photos();
  assert.equal(camera.marks.length,1);
  const chooser=page.waitForEvent('filechooser');
  await photoCard.locator('[data-replace-photo]').click();
  await (await chooser).setFiles(file('replacement.png',fixture.transparent));
  await page.waitForFunction(()=>SOP.project.pages[0].canvas.objects[0].data.startsWith('data:image/png'));
  const [replacement]=await photos();
  assert.deepEqual([replacement.x,replacement.y,replacement.id,replacement.marks],[camera.x,camera.y,camera.id,camera.marks]);
  assert.equal(Math.max(...await size(replacement.data)),1800);
  await photoCard.locator('button[data-edit-photo]').click();
  await page.locator('#photoDialog[open]').waitFor();
  await page.locator('[data-tool="crop"]').click();
  const crop=await surface.boundingBox();
  const originalCanvasHeight=await surface.evaluate(node=>node.height);
  await page.mouse.move(crop.x+crop.width*.15,crop.y+crop.height*.15);
  await page.mouse.down();
  await page.mouse.move(crop.x+crop.width*.75,crop.y+crop.height*.80,{steps:4});
  await page.mouse.up();
  await page.locator('#applyCrop').click();
  await page.waitForFunction(height=>document.querySelector('#annotationCanvas').height!==height,originalCanvasHeight);
  await page.locator('#savePhoto').click();
  await page.locator('#photoDialog').waitFor({state:'hidden'});
  const [cropped]=await photos();
  assert.match(cropped.data,/^data:image\/png/);
  assert(Math.max(...await size(cropped.data))<1800);
  assert.equal(cropped.marks.length,1);
  assert.equal(cropped.x,replacement.x);

  await page.evaluate(()=>SOP.replaceProject({...SOP.clone(SOP.project),pages:[SOP.blankPage()]}));
  await page.locator('#photoFile').setInputFiles(file('small.png',fixture.small));
  await page.waitForFunction(()=>SOP.project.pages[0].photos.length===1);
  await page.evaluate(({source,meta,alternate})=>{
   const p=SOP.project.pages[0],small=p.photos[0];
   small.rendered=alternate;
   p.photos.push({id:SOP.uid(),data:source,width:meta.width,height:meta.height,caption:'原始配图',
    marks:[{type:'arrow',x:.2,y:.3,x2:.4,y2:.5,color:'#ff4400'}]});
   SOP.refresh();
  },{source:original,meta:{width:fixture.width,height:fixture.height},alternate:fixture.transparent});
  await page.evaluate(()=>SOP.prepareImages());
  await open();
  await dialog.locator('svg image').nth(1).waitFor();
  await save();
  const [convertedSmall,convertedLarge]=await photos();
  assert.equal(convertedSmall.data,fixture.small);
  assert.equal(Math.max(...await size(convertedLarge.data)),1800);
  const saved=await page.evaluate(()=>SOP.projectForStorage(SOP.project).pages[0]);
  assert.equal(saved.photos[1].data,original);
  assert.equal(saved.photos[0].rendered,fixture.transparent);
  assert(saved.canvas.objects.some(object=>object.type==='arrow'));
  await page.locator('#restorePageMaterials').click();
  assert(await page.evaluate(()=>!!SOP.project.pages[0].canvasDraft));
  await open();await save();
  assert.equal(await page.evaluate(()=>SOP.project.pages[0].canvasDraft),undefined);
  await page.evaluate(async()=>{
   const directory=await navigator.storage.getDirectory();
   window.savedCompressedPages=await directory.getFileHandle('compressed-photos.sop.json',{create:true});
   window.showSaveFilePicker=async()=>savedCompressedPages;
   window.showOpenFilePicker=async()=>[savedCompressedPages];
  });
  await page.locator('#saveAsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('compressed-photos.sop.json')&&document.querySelector('#saveState').textContent.includes('项目文件已保存'));
  const stored=await page.evaluate(async()=>JSON.parse(await (await savedCompressedPages.getFile()).text()).pages[0]);
  assert(stored.canvas.objects[1].data===convertedLarge.data&&stored.photos[1].data===original);
  await page.evaluate(()=>SOP.project.pages[0].canvas.objects[1].data='changed for reload verification');
  await page.locator('#importBtn').click();
  await page.waitForFunction(()=>SOP.project.pages[0].canvas?.objects[1]?.data.startsWith('data:image/'));
  assert((await photos())[1].data===convertedLarge.data);

  await page.evaluate(({original,width,height})=>{
   const project=SOP.clone(SOP.project),legacy=SOP.blankPage();
   legacy.canvas={width:900,height:520,objects:[
    {id:'oldPhoto',type:'photo',data:original,x:27,y:56,w:300,h:300*height/width,aspectRatio:width/height}
   ],edges:[]};
   project.pages=[legacy];
   SOP.replaceProject(project);
  },{original,width:fixture.width,height:fixture.height});
  await open();await save();
  const [legacy]=await photos();
  assert(legacy.data===original);
  assert.deepEqual([legacy.x,legacy.y],[27,56]);
  assert.deepEqual(errors,[]);
  console.log('PASS: dimension and byte triggers, transparent and small images, no growth, upload/paste/replace/crop, original project fallback and safe failures');
  console.log(JSON.stringify({camera:[fixture.width,fixture.height,bytes(original),bytes(camera.data)],opaquePNG:[1700,1700,bytes(fixture.opaque),bytes(checks.opaque.data)]}));
 }finally{
  if(browser)await browser.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
