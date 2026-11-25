'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

const firstText='检查定位销';
const secondText='确认装配方向';
const color='#0070c0';
const fill='#ffff00';
const fontSize=26;
const near=(actual,expected,tolerance=1)=>assert(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','inherit']});
 const errors=[];
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';
   server.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))resolve(JSON.parse(output.split('\n')[0]).url);});
   server.on('error',reject);
   server.on('exit',code=>reject(Error('Workbench server exited: '+code)));
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP&&!document.querySelector('#saveBtn').disabled);
  await page.evaluate(()=>{
   const image=document.createElement('canvas');
   image.width=225;image.height=135;
   const ctx=image.getContext('2d');
   ctx.fillStyle='#cadbe1';ctx.fillRect(0,0,225,135);
   ctx.fillStyle='#475561';ctx.fillRect(70,38,85,62);
   const operation=SOP.blankPage();
   operation.canvas={width:900,height:520,objects:[{id:'test-photo',type:'photo',x:350,y:150,w:225,h:135,data:image.toDataURL()}],edges:[]};
   SOP.replaceProject({...SOP.clone(SOP.project),pages:[operation]});
  });

  const dialog=page.locator('.object-dialog[open]');
  const stage=dialog.locator('.object-sheet');
  const object=(surface,id)=>surface.locator(`g[data-object="${id}"]`);
  const photo=object(stage,'test-photo').locator('image');
  const input=dialog.locator('[data-callout-text]');
  const save=dialog.locator('[data-action="save"]');
  const add=dialog.locator('[data-add="callout"]');
  const selectedRectangle=stage.locator('g[data-object]:has([data-resize="nw"])');
  const boxPoint=(box,x,y)=>({x:box.x+box.width*x,y:box.y+box.height*y});
  const photoPoint=async(x,y)=>{
   const point=boxPoint(await photo.boundingBox(),x,y);
   return {x:Math.round(point.x),y:Math.round(point.y)};
  };
  const sheetPoint=(x,y)=>stage.evaluate((svg,{x,y})=>{
   const point=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
   return {x:point.x,y:point.y};
  },{x,y});
  const arrowLine=surface=>surface.locator('line[marker-start],line[marker-end]');
  const linePoints=(line,canvasCoordinates=false)=>line.evaluate((node,canvasCoordinates)=>{
   const screen=node.getScreenCTM();
   const matrix=canvasCoordinates?node.ownerSVGElement.getScreenCTM().inverse().multiply(screen):screen;
   const transform=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return {x:p.x,y:p.y};};
   const start=transform(node.x1.baseVal.value,node.y1.baseVal.value);
   const end=transform(node.x2.baseVal.value,node.y2.baseVal.value);
   return node.hasAttribute('marker-start')?[end,start]:[start,end];
  },canvasCoordinates);
  const assertMarker=async(line,side)=>{
   const marker=await line.evaluate((node,side)=>{
    const markerId=node.getAttribute('marker-'+side)?.match(/^url\(#(.+)\)$/)?.[1];
    const marker=markerId&&node.ownerSVGElement.getElementById(markerId);
    return {otherEnd:node.hasAttribute(side==='start'?'marker-end':'marker-start'),
     path:marker?.querySelector('path')?.getAttribute('d'),refX:marker?.getAttribute('refX'),orient:marker?.getAttribute('orient')};
   },side);
   assert(marker.path,'The arrow must use a rendered SVG marker');
   assert.equal(marker.otherEnd,false);
   if(side==='start'){
    assert.equal(marker.refX,'10');
    assert.equal(marker.orient,'auto-start-reverse');
   }
  };
  const samePoint=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
  const drag=async(start,dx,dy,duringDrag)=>{
   await page.mouse.move(start.x,start.y);
   await page.mouse.down();
   await page.mouse.move(start.x+dx,start.y+dy,{steps:8});
   if(duringDrag){
    await stage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    await duringDrag();
   }
   await page.mouse.up();
  };
  const dragTo=(start,end)=>drag(start,end.x-start.x,end.y-start.y);
  const frame=group=>group.locator('rect').first();
  const textNode=group=>group.locator('[data-object-text]');
  const textStyle=group=>textNode(group).evaluate(node=>{
   const css=getComputedStyle(node);
   return {fontSize:parseFloat(css.fontSize),color:css.color};
  });
  const frameBounds=group=>frame(group).evaluate(rect=>{
   const bounds=rect.getBBox(),matrix=rect.getScreenCTM();
   const a=new DOMPoint(bounds.x,bounds.y).matrixTransform(matrix);
   const b=new DOMPoint(bounds.x+bounds.width,bounds.y+bounds.height).matrixTransform(matrix);
   return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};
  });
  const standardAnchor=(point,box)=>assert([[0,0],[1,0],[1,1],[0,1],[.5,0],[1,.5],[.5,1],[0,.5]]
   .map(([x,y])=>boxPoint(box,x,y)).some(anchor=>Math.hypot(point.x-anchor.x,point.y-anchor.y)<1),
  `Arrow tail ${JSON.stringify(point)} must use a corner or midpoint of ${JSON.stringify(box)}`);
  const assertRectangle=async(group,stroke)=>{
   const rect=frame(group);
   assert.match(await rect.getAttribute('stroke'),/^#[a-f\d]{6}$/i);
   assert.equal(await rect.getAttribute('stroke-dasharray'),null);
   if(stroke)assert.equal(await rect.getAttribute('stroke'),stroke);
   assert(Number(await rect.getAttribute('stroke-width'))>0);
   await assertInlineCenter(textNode(group),group);
  };
  const assertInlineCenter=async(editor,group)=>{
   const box=await frameBounds(group);
   const content=await editor.evaluate(node=>{
    const rect=node.getBoundingClientRect(),css=getComputedStyle(node);
    const length=name=>parseFloat(css[name])||0;
    return {align:css.textAlign,x:rect.x+rect.width/2+(length('paddingLeft')-length('paddingRight'))/2,
     y:rect.y+rect.height/2+(length('paddingTop')-length('paddingBottom'))/2};
   });
   assert.equal(content.align,'center');
   samePoint(content,boxPoint(box,.5,.5));
   return box;
  };
  const sameBox=(a,b)=>{
   samePoint(a,b);
   near(a.width,b.width);
   near(a.height,b.height);
  };
  const inline=stage.locator('[data-inline-text]');
  const visibleLines=async(group,name)=>{
   const screenshotPath=process.env.SOP_CANVAS_QA_OUTPUT?path.join(process.env.SOP_CANVAS_QA_OUTPUT,name):undefined;
   const bytes=await frame(group).screenshot({caret:'hide',path:screenshotPath});
   return page.evaluate(async png=>{
    const bytes=Uint8Array.from(atob(png),part=>part.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
    const {data,width,height}=ctx.getImageData(0,0,bitmap.width,bitmap.height);
    const bands=[];
    for(let y=6;y<height-6;y++){
     let left=width,right=-1;
     for(let x=6;x<width-6;x++){
      const p=(y*width+x)*4;
      if(data[p+2]-data[p]>45&&data[p+2]-data[p+1]>25){left=Math.min(left,x);right=x;}
     }
     if(right<0)continue;
     const band=bands.at(-1);
     if(band&&y-band.bottom<4){
      band.left=Math.min(band.left,left);band.right=Math.max(band.right,right);band.bottom=y;
     }else bands.push({left,right,top:y,bottom:y});
    }
    return bands;
   },bytes.toString('base64'));
  };
  const editInline=async(group,value,key,{compareLines=false}={})=>{
   const box=await frameBounds(group);
   const point=boxPoint(box,.5,.5);
   await page.mouse.dblclick(point.x,point.y);
   await inline.fill(value);
   const whileTyping=await assertInlineCenter(inline,group);
   samePoint(box,whileTyping);
   const before=compareLines?await visibleLines(group,'mixed-typing.png'):null;
   await inline.press(key);
   await inline.waitFor({state:'hidden'});
   sameBox(key==='Escape'?box:whileTyping,await frameBounds(group));
   await assertRectangle(group);
   if(before){
    const after=await visibleLines(group,'mixed-confirmed.png');
    assert.equal(before.length,2,JSON.stringify(before));
    assert.equal(after.length,before.length,JSON.stringify({before,after}));
    for(const [index,line] of before.entries()){
     for(const edge of ['left','right','top','bottom'])near(line[edge],after[index][edge],4);
    }
   }
  };

  await page.locator('#editPageCanvas').click();
  await add.click();
  const target=await photoPoint(.36,.63);
  await page.mouse.click(target.x,target.y);
  assert(await input.isVisible(),await dialog.locator('.object-message').textContent());
  await input.fill(firstText);
  const labelId=await selectedRectangle.getAttribute('data-object');
  const draftBox=await assertInlineCenter(input,selectedRectangle);
  await input.dispatchEvent('compositionstart',{data:'ding'});
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
  assert(await input.isVisible(),'IME Enter must keep the callout editor open');
  await input.dispatchEvent('compositionend',{data:'定'});
  if(process.env.SOP_CANVAS_QA_OUTPUT){
   await dialog.screenshot({path:path.join(process.env.SOP_CANVAS_QA_OUTPUT,'photo-callouts-typing.png')});
  }
  await dialog.locator('[data-callout-apply]').click();
  await input.waitFor({state:'hidden'});
  const label=object(stage,labelId);
  await label.waitFor();
  assert.equal(await textNode(label).inputValue(),firstText);
  assert.equal(await arrowLine(stage).count(),1);
  const firstArrowId=await arrowLine(stage).locator('..').getAttribute('data-object');
  await assertMarker(arrowLine(stage),'start');
  const [tail,tip]=await linePoints(arrowLine(stage));
  samePoint(tail,target);

  await assertRectangle(label);
  const box=await frameBounds(label);
  sameBox(draftBox,box);
  standardAnchor(tip,box);
  await drag({x:box.x+box.width/2,y:box.y+box.height/2},35,44);
  const movedBox=await frameBounds(label);
  near(movedBox.x-box.x,35);
  near(movedBox.y-box.y,44);
  const [unmovedTail,movedTip]=await linePoints(arrowLine(stage));
  samePoint(unmovedTail,target);
  assert(Math.hypot(movedTip.x-tip.x,movedTip.y-tip.y)>10);
  standardAnchor(movedTip,movedBox);

  await drag(await photoPoint(.71,.83),30,23);
  const [movedTail]=await linePoints(arrowLine(stage));
  samePoint(movedTail,{x:target.x+30,y:target.y+23});

  await page.mouse.click(movedBox.x+10,movedBox.y+10);
  const size=dialog.locator('[data-prop="fontSize"]');
  await size.fill(String(fontSize));
  await size.press('Tab');
  const palette=dialog.locator('[data-object-color]');
  await palette.locator('summary').click();
  await palette.getByRole('button',{name:'标准颜色 #0070C0',exact:true}).click();
  const fillPalette=dialog.locator('[data-object-fill]');
  await fillPalette.locator('summary').click();
  await fillPalette.getByRole('button',{name:'标准颜色 #FFFF00',exact:true}).click();
  assert.deepEqual(await textStyle(label),{fontSize,color:'rgb(0, 112, 192)'});
  assert.equal(await arrowLine(stage).getAttribute('stroke'),color);
  await assertRectangle(label,color);
  assert.equal(await frame(label).getAttribute('fill'),fill);
  const resized=await textNode(label).evaluate(node=>({
   scroll:node.scrollHeight,height:node.clientHeight,box:node.closest('foreignObject').height.baseVal.value,
  }));
  assert(resized.scroll<=resized.box+1,`The resized callout text must fit inside its box ${JSON.stringify(resized)}`);
  await save.click();

  await page.locator('[data-photo-callout]').click();
  await photo.waitFor();
  const next=await photoPoint(.69,.34);
  await page.mouse.click(next.x,next.y);
  await input.fill('此条取消');
  await input.press('Escape');
  await input.waitFor({state:'hidden'});
  assert.equal(await arrowLine(stage).count(),1);
  if(await add.getAttribute('aria-pressed')!=='true')await add.click();
  await page.mouse.click(next.x,next.y);
  await input.fill(secondText);
  const secondId=await selectedRectangle.getAttribute('data-object');
  await input.press('Enter');
  await input.waitFor({state:'hidden'});
  const secondGroup=object(stage,secondId);
  assert.deepEqual(await textStyle(secondGroup),{fontSize,color:'rgb(0, 112, 192)'});
  await assertRectangle(secondGroup,color);
  assert.equal(await frame(secondGroup).getAttribute('fill'),fill);
  assert.equal(await arrowLine(stage).count(),2);
  samePoint((await linePoints(arrowLine(stage).last()))[0],next);
  await editInline(secondGroup,'更改标题\n校对第二行','Control+Enter');
  await editInline(secondGroup,secondText,'Control+Enter');
  assert.equal(await textNode(secondGroup).inputValue(),secondText);
  const secondArrowId=await arrowLine(stage).last().locator('..').getAttribute('data-object');
  const secondArrow=arrowLine(object(stage,secondArrowId));
  const secondBox=await frameBounds(secondGroup);
  samePoint((await linePoints(secondArrow))[1],boxPoint(secondBox,0,.5));
  const assertBottomAnchor=async()=>{
   const [tail,tip]=await linePoints(secondArrow);
   const box=await frameBounds(secondGroup);
   samePoint(tip,boxPoint(box,.5,1));
   samePoint(tail,next);
   assert(tail.y>tip.y+10,'The arrow should reach the bottom edge without crossing the label');
  };
  const secondCenter=boxPoint(secondBox,.5,.5);
  await drag(secondCenter,next.x-secondCenter.x+45,-155,assertBottomAnchor);
  await assertBottomAnchor();

  await dialog.locator('[data-add="rect"]').click();
  await dragTo(await sheetPoint(85,65),await sheetPoint(275,160));
  const manualId=await selectedRectangle.getAttribute('data-object');
  const manual=object(stage,manualId);
  await editInline(manual,'手绘对照','Control+Enter');
  await editInline(manual,'第一行\n第二行','Control+Enter');
  await editInline(manual,'取消输入','Escape');
  assert.equal(await textNode(manual).inputValue(),'第一行\n第二行');
  await size.fill('24');
  await size.press('Tab');
  await editInline(manual,'6x螺钉 M2x4 定位安装注意','Control+Enter',{compareLines:true});
  const firstArrow=arrowLine(object(stage,firstArrowId));
  const [firstTail,firstTip]=await linePoints(firstArrow);
  await page.mouse.click((firstTail.x+firstTip.x)/2,(firstTail.y+firstTip.y)/2);
  const handle=stage.locator('[data-endpoint="start"]');
  const handlePoint=async()=>boxPoint(await handle.boundingBox(),.5,.5);
  const manualBox=await frameBounds(manual);
  const manualBottom=boxPoint(manualBox,.5,1);
  await dragTo(await handlePoint(),{x:manualBottom.x+4,y:manualBottom.y+3});
  samePoint((await linePoints(firstArrow))[1],manualBottom);
  const labelBox=await frameBounds(label);
  const calloutCorner=boxPoint(labelBox,0,1);
  await dragTo(await handlePoint(),{x:calloutCorner.x-4,y:calloutCorner.y+3});
  samePoint((await linePoints(firstArrow))[1],calloutCorner);
  const assertManualAnchor=async()=>{
   const [tail,tip]=await linePoints(firstArrow);
   samePoint(tip,boxPoint(await frameBounds(label),0,1));
   samePoint(tail,movedTail);
  };
  await drag(boxPoint(labelBox,.5,.5),10,43,assertManualAnchor);
  await assertManualAnchor();
  await page.mouse.click(manualBox.x+manualBox.width/2,manualBox.y+manualBox.height/2);
  await dialog.locator('[data-action="delete"]').click();
  assert.equal(await manual.count(),0);
  if(process.env.SOP_CANVAS_QA_OUTPUT){
   await dialog.screenshot({path:path.join(process.env.SOP_CANVAS_QA_OUTPUT,'photo-callouts-editor.png')});
  }
  await save.click();

  const model=()=>page.evaluate(()=>SOP.project.pages[0].canvas);
  const saved=await model();
  const labels=saved.objects.filter(item=>item.type==='rect');
  const arrows=saved.objects.filter(item=>item.type==='arrow');
  assert.deepEqual(labels.map(item=>item.text),[firstText,secondText]);
  assert.deepEqual(arrows.map(item=>item.attachments.start.targetId),labels.map(item=>item.id));
  assert.deepEqual(arrows[0].attachments.start,{targetId:labelId,anchorIndex:3,auto:false});
  assert.deepEqual(arrows[1].attachments.start,{targetId:secondId,anchorIndex:6,auto:true});
  assert(arrows.every(item=>item.attachments.end.targetId==='test-photo'));
  await page.evaluate(async()=>{
   const directory=await navigator.storage.getDirectory();
   const handle=await directory.getFileHandle('photo-callouts.sop.json',{create:true});
   window.showSaveFilePicker=async()=>handle;
   window.showOpenFilePicker=async()=>[handle];
  });
  await page.locator('#saveAsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('photo-callouts.sop.json')&&document.querySelector('#saveState').textContent.includes('项目文件已保存'));
  await page.evaluate(()=>SOP.replaceProject({...SOP.clone(SOP.project),pages:[SOP.blankPage()]}));
  await page.locator('#importBtn').click();
  await page.locator('.file-save-prompt [data-choice="discard"]').click();
  const preview=page.locator('#previewStage .object-sheet');
  await object(preview,labels[0].id).waitFor();
  assert.deepEqual(await model(),saved);
  assert.equal(await arrowLine(preview).count(),2);
  const [,previewTip]=await linePoints(arrowLine(preview).first());
  samePoint(previewTip,boxPoint(await frameBounds(object(preview,labels[0].id)),0,1));
  const [,automaticTip]=await linePoints(arrowLine(object(preview,secondArrowId)));
  samePoint(automaticTip,boxPoint(await frameBounds(object(preview,secondId)),.5,1));
  for(const item of arrows)await assertMarker(arrowLine(object(preview,item.id)),'start');
  const previewPoints=await Promise.all(arrows.map(item=>linePoints(arrowLine(object(preview,item.id)),true)));
  for(const item of labels){
   const group=object(preview,item.id);
   await assertRectangle(group,color);
   assert.equal(await textNode(group).inputValue(),item.text);
   assert.equal(await frame(group).getAttribute('fill'),fill);
  }
  if(process.env.SOP_CANVAS_QA_OUTPUT){
   await preview.screenshot({path:path.join(process.env.SOP_CANVAS_QA_OUTPUT,'photo-callouts-preview.png')});
  }

  const download=page.waitForEvent('download',{timeout:8000});
  await page.locator('#docxBtn').click();
  const bytes=await fs.readFile(await (await download).path());
  if(process.env.SOP_CANVAS_QA_OUTPUT){
   await fs.writeFile(path.join(process.env.SOP_CANVAS_QA_OUTPUT,'photo-callouts.docx'),bytes);
  }
  const word=await page.evaluate(async({bytes,labels,arrows,photoWidth})=>{
   const zip=await JSZip.loadAsync(new Uint8Array(bytes));
   const doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
   const nodes=(node,name)=>node?[...node.getElementsByTagNameNS('*',name)]:[];
   const anchors=nodes(doc,'anchor');
   const shape=id=>anchors.find(anchor=>nodes(anchor,'docPr')[0]?.getAttribute('name')==='画布对象 '+id);
   const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const solidColor=node=>nodes(node,'srgbClr')[0]?.getAttribute('val')?.toLowerCase();
   const pictures=anchors.filter(anchor=>nodes(anchor,'pic').length&&nodes(anchor,'docPr')[0]?.getAttribute('descr')==='画布独立照片');
   const scale=Number(nodes(pictures[0],'extent')[0]?.getAttribute('cx'))/photoWidth;
   const lineEnds=anchor=>{
    const offset=direction=>Number(nodes(nodes(anchor,'position'+direction)[0],'posOffset')[0]?.textContent)/scale;
    const extent=nodes(anchor,'extent')[0],transform=nodes(anchor,'xfrm')[0];
    const x=offset('H'),y=offset('V');
    const right=x+Number(extent?.getAttribute('cx'))/scale,bottom=y+Number(extent?.getAttribute('cy'))/scale;
    const flipH=transform?.getAttribute('flipH')==='1',flipV=transform?.getAttribute('flipV')==='1';
    return [{x:flipH?right:x,y:flipV?bottom:y},{x:flipH?x:right,y:flipV?y:bottom}];
   };
   return {
    pictures:pictures.length,
    labels:labels.map(id=>{
     const anchor=shape(id),box=nodes(anchor,'txbx')[0],properties=nodes(anchor,'spPr')[0];
     const line=nodes(properties,'ln')[0];
     return {text:nodes(box,'t').map(text=>text.textContent).join(''),
      geometry:nodes(properties,'prstGeom')[0]?.getAttribute('prst'),
      border:solidColor(line),borderWidth:Number(line?.getAttribute('w')),
      fill:solidColor([...properties.children].find(node=>node.localName==='solidFill')),
      horizontal:nodes(box,'jc')[0]?.getAttributeNS(w,'val'),vertical:nodes(anchor,'bodyPr')[0]?.getAttribute('anchor')};
    }),
    arrows:arrows.map(id=>{
     const anchor=shape(id);
     const head=nodes(anchor,'headEnd')[0]?.getAttribute('type');
     const tail=nodes(anchor,'tailEnd')[0]?.getAttribute('type');
     const points=lineEnds(anchor);
     return {connector:nodes(anchor,'cNvCnPr').length,head,tail,points:head==='triangle'?points.reverse():points};
    }),
   };
  },{bytes:Array.from(bytes),labels:labels.map(item=>item.id),arrows:arrows.map(item=>item.id),photoWidth:saved.objects.find(item=>item.type==='photo').w});
  assert.equal(word.pictures,1);
  assert.deepEqual(word.labels.map(item=>item.text),[firstText,secondText]);
  for(const {borderWidth,...label} of word.labels){
   assert(borderWidth>0);
   assert.deepEqual(label,{text:label.text,geometry:'rect',border:color.slice(1),fill:fill.slice(1),horizontal:'center',vertical:'ctr'});
  }
  for(const [index,{points,...arrow}] of word.arrows.entries()){
   assert.deepEqual(arrow,{connector:1,head:'triangle',tail:'none'});
   for(const [end,point] of points.entries()){
    near(point.x,previewPoints[index][end].x,.15);
    near(point.y,previewPoints[index][end].y,.15);
   }
  }

  const legacyText='旧版检查标注';
  const legacyProject=await page.evaluate(legacyText=>{
   const project=SOP.clone(SOP.project);
   const canvas=project.pages[0].canvas;
   canvas.objects=[canvas.objects.find(item=>item.type==='photo'),
    {id:'old-label',type:'text',callout:true,x:630,y:165,w:165,h:55,text:legacyText,color:'#243e46',fill:'#ffffff'},
    {id:'plain-text',type:'text',x:70,y:100,w:130,h:55,text:'普通文字'},
    {id:'old-arrow',type:'arrow',x:460,y:192,w:170,h:50,flipX:true,attachments:{
     start:{targetId:'old-label',edge:true},end:{targetId:'test-photo',relativeX:.4,relativeY:.55},
    }},
   ];
   return JSON.stringify(project);
  },legacyText);
  await page.locator('#importFile').setInputFiles({name:'old-callout.sop.json',mimeType:'application/json',buffer:Buffer.from(legacyProject)});
  const oldPreview=object(preview,'old-label');
  await oldPreview.waitFor();
  assert.equal(await textNode(oldPreview).inputValue(),legacyText);
  await assertRectangle(oldPreview,'#243e46');
  assert.equal(await frame(object(preview,'plain-text')).getAttribute('stroke'),'none');
  const oldBounds=await frameBounds(oldPreview);
  const [oldTail,oldTip]=await linePoints(arrowLine(preview));
  await assertMarker(arrowLine(preview),'start');
  samePoint(oldTip,boxPoint(oldBounds,0,.5));
  samePoint(oldTail,boxPoint(await object(preview,'test-photo').locator('image').boundingBox(),.4,.55));
  await page.locator('#editPageCanvas').click();
  await assertRectangle(object(stage,'old-label'),'#243e46');
  await save.click();
  const migrated=await model();
  assert.equal(migrated.objects.find(item=>item.id==='old-label').type,'rect');
  assert.deepEqual(migrated.objects.find(item=>item.id==='old-arrow').attachments.start,{targetId:'old-label',anchorIndex:7,auto:true});

  await page.locator('#editPageCanvas').click();
  const manualStart=await sheetPoint(300,345),manualTip=await sheetPoint(175,280);
  await dialog.locator('[data-add="arrow"]').click();
  await dragTo(manualStart,manualTip);
  const drawn=stage.locator('line[marker-end]');
  await assertMarker(drawn,'end');
  const [drawnTail,drawnTip]=await linePoints(drawn);
  samePoint(drawnTail,manualStart);
  samePoint(drawnTip,manualTip);
  await save.click();
  assert.deepEqual(errors,[]);
  console.log('PASS: callout arrowheads at the label, precise photo tails, live side switching, legacy migration, unchanged hand-drawn arrows, and matching Word arrowheads');
 }catch(error){
  if(errors.length)console.error(errors);
  throw error;
 }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
