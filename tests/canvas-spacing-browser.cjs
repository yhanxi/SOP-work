const path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium,_electron}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');
(async()=>{let browser;const root=path.resolve(__dirname,'..'),server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','inherit']});
try{const url=await new Promise(resolve=>{let s='';server.stdout.on('data',b=>{s+=b;if(s.includes('\n'))resolve(JSON.parse(s.split('\n')[0]).url);});});let page;if(process.env.SOP_CANVAS_ELECTRON_EXE){const desktop=await _electron.launch({executablePath:process.env.SOP_CANVAS_ELECTRON_EXE,args:['--sop-test'],env:{...process.env,SOP_STUDIO_TEST_USERDATA:process.env.SOP_CANVAS_ELECTRON_PROFILE},timeout:45000});browser={close:()=>desktop.evaluate(({app})=>app.exit())};page=await desktop.firstWindow();}else{browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(url);}const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.SOP);
await page.evaluate(()=>{const p=SOP.blankPage(),c=document.createElement('canvas');c.width=160;c.height=180;const ctx=c.getContext('2d');ctx.fillStyle='#33919b';ctx.fillRect(0,0,160,180);p.steps='放置工件并确认位置。'.repeat(6);p.requirements='技术要求：保持原字号并紧接配图。'.repeat(4);p.contentStyle={fontSize:18,letterSpacing:0};p.canvas={width:900,height:650,objects:[{id:'photo',type:'photo',x:100,y:30,w:160,h:180,data:c.toDataURL()},{id:'label',type:'rect',x:330,y:120,w:150,h:45,text:'位置确认',fontSize:20,fill:'#ffff00'}],edges:[]};SOP.replaceProject({...SOP.clone(SOP.project),settings:{...SOP.project.settings,cover:false,history:false,flow:false},pages:[p]});});
const info=await page.evaluate(()=>({height:SOP_OBJECTS.contentHeight(SOP.project.pages[0].canvas),original:JSON.stringify(SOP.project.pages[0].canvas),space:SOP.canvasSpace(SOP.project.pages[0]),view:document.querySelector('#previewStage .object-sheet').getAttribute('viewBox')}));assert.equal(info.height,218);assert.equal(info.view,'0 0 900 '+info.space.height);assert(info.space.height>218);assert.equal(await page.evaluate(()=>SOP.layout[0].fitScale),1);
await page.locator('#editPageCanvas').click();assert.equal(await page.locator('.object-dialog .object-sheet').getAttribute('viewBox'),'0 0 900 650');assert.equal(Number(await page.locator('[data-drawing-area]').getAttribute('height')),info.space.height);const photo=await page.locator('.object-dialog [data-object="photo"]').boundingBox();await page.mouse.move(photo.x+photo.width/2,photo.y+photo.height/2);await page.mouse.down();await page.mouse.move(photo.x+photo.width/2+12,photo.y+photo.height/2+8,{steps:4});await page.mouse.up();assert((await page.locator('.object-dialog [data-object="photo"]').getAttribute('transform'))!=='translate(100 30)');await page.locator('.object-dialog [data-action="close"]').click();assert.equal(await page.evaluate(()=>JSON.stringify(SOP.project.pages[0].canvas)),info.original);
await page.locator('[data-style-key="fontSize"]').fill('28');await page.locator('[data-style-key="fontSize"]').press('Tab');await page.evaluate(()=>SOP.refresh());const smaller=await page.evaluate(()=>SOP.canvasSpace(SOP.project.pages[0]));assert(smaller.height<info.space.height);await page.locator('[data-style-key="fontSize"]').fill('18');await page.locator('[data-style-key="fontSize"]').press('Tab');await page.evaluate(()=>SOP.refresh());const geometry=await page.evaluate(()=>{const svg=document.querySelector('#previewStage .page-object-content'),requirement=[...document.querySelectorAll('#previewStage h3')].find(x=>x.textContent.includes('工艺技术要求')),a=svg.getBoundingClientRect(),b=requirement.getBoundingClientRect();return{gap:b.top-a.bottom,bottom:b.bottom,frameBottom:document.querySelector('#previewStage .op-cell').getBoundingClientRect().bottom};});assert(geometry.gap<5,'Requirements must directly follow the remaining canvas region');assert(geometry.bottom<=geometry.frameBottom);
if(process.env.SOP_SPACING_QA_OUTPUT)await page.locator('#previewStage').screenshot({path:path.join(process.env.SOP_SPACING_QA_OUTPUT,'preview.png')});
const data=await page.evaluate(async()=>{const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),bytes=await blob.arrayBuffer(),z=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await z.file('word/document.xml').async('string'),'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',drawing=[...doc.getElementsByTagNameNS(wp,'docPr')].find(x=>x.getAttribute('name')==='画布对象 label'),anchor=drawing.parentElement,paragraph=anchor.closest('p')||anchor.parentElement.parentElement.parentElement;const holder=[...doc.getElementsByTagNameNS(W,'p')].find(p=>[...p.getElementsByTagNameNS(wp,'docPr')].some(n=>n.getAttribute('name')==='画布对象 label'));const line=holder.getElementsByTagNameNS(W,'pPr')[0].getElementsByTagNameNS(W,'spacing')[0].getAttributeNS(W,'line'),back=await SOP_WORD.importDocx(bytes);return{bytes:Array.from(new Uint8Array(bytes)),line:Number(line),extent:Number(anchor.getElementsByTagNameNS(wp,'extent')[0].getAttribute('cx')),contentWidth:SOP_TEMPLATE.dimensions.operationContentWidthTwips/20,round:back.pages[0].canvas};});assert(Math.abs(data.line-info.space.pixels*.75*20)<=1);assert(Math.abs(data.extent-150*data.contentWidth/900*12700)<=1);assert.equal(data.round.height,650);assert.equal(data.round.objects.find(o=>o.id==='label').fontSize,20);if(process.env.SOP_SPACING_QA_OUTPUT)require('node:fs').writeFileSync(path.join(process.env.SOP_SPACING_QA_OUTPUT,'spacing.docx'),Buffer.from(data.bytes));for(const canvas of [false,true])for(const requirements of ['', ' \n　 ', '验收时确认位置。']){const result=await page.evaluate(async({canvas,requirements})=>{const p=SOP.blankPage();p.steps='确认位置';p.requirements=requirements;if(canvas)p.canvas={width:900,height:520,objects:[],edges:[]};SOP.replaceProject({...SOP.clone(SOP.project),pages:[p]});const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),z=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await z.file('word/document.xml').async('string');return{preview:[...document.querySelectorAll('#previewStage h3')].some(x=>x.textContent.includes('二、工艺技术要求')),word:xml.includes('二、工艺技术要求'),space:canvas?SOP.canvasSpace(p).height:null};},{canvas,requirements});assert.equal(result.preview,true);assert.equal(result.word,true);}
const spacingCases=await page.evaluate(async()=>{
 await document.fonts.ready;
 const make=(name,steps,requirements,options={})=>Object.assign(SOP.blankPage(),{name,steps,requirements,contentStyle:{fontSize:12.5,letterSpacing:0}},options);
 const photo=(width,height,caption='')=>{
  const cv=document.createElement('canvas');cv.width=width;cv.height=height;
  const context=cv.getContext('2d');context.fillStyle='#6a8773';context.fillRect(0,0,width,height);
  return {width,height,caption,data:cv.toDataURL(),marks:[{type:'arrow',x:.1,y:.13,x2:.8,y2:.79,color:'#cc3322'}]};
 };
 const canvas={width:900,height:650,objects:[],edges:[]};
 const nearBottom=Array.from({length:7},(_,i)=>'要求 '+(i+1)+' 完整显示。').join('\n');
 const mixed='检查装配后产品型号M12的规格和尺寸。'.repeat(4);
 const pages=[
  make('画布多条要求','核对工件位置。','至少两人复核。\n确保刻度清晰。',{canvas,contentStyle:{fontSize:10.5,letterSpacing:.7}}),
  make('正文自然和手动换行',mixed+'\n\n确认502用量。\n确认 502 用量。','检查 M12 型号。',{contentStyle:{fontSize:14,letterSpacing:1.5}}),
  make('配图和独立图注','检查照片。','材料正确。\n型号一致。',{photos:[photo(400,180,'第一张配图说明'),photo(100,360,'第二张窄图需要折成数行显示')]}),
  make('配图临界高度','检查配图。',nearBottom,{photos:[photo(250,250),photo(140,420),photo(320,320)]}),
  make('配图没有要求','只显示步骤。','',{photos:[photo(200,300)]}),
  make('画布没有要求','只显示步骤。',' \n　 ',{canvas,contentStyle:{fontSize:19.5,letterSpacing:-.3}}),
  make('空白工序','',''),
 ];
 pages[1].stepsTextColors=[[0,3,'#355ea7']];
 pages[1].stepsHighlights=[[1,4,'#ffff00']];
 SOP.replaceProject({...SOP.clone(SOP.project),pages});
 const browser=[];
 for(const p of SOP.layout){
  SOP.setSelected(p.sourceId);
  const paper=document.querySelector('#previewStage .paper'),box=paper.querySelector('.op-cell');
  const toPt=841.88976378/paper.getBoundingClientRect().width;
  const sections=[...box.querySelectorAll('.op-text-section p')].map(element=>{
   const css=getComputedStyle(element),range=document.createRange();range.selectNodeContents(element);
   return {text:element.textContent,fontSize:parseFloat(css.fontSize)*.75,letterSpacing:(parseFloat(css.letterSpacing)||0)*.75,
    line:Math.round(parseFloat(css.lineHeight)*15),after:Math.round(parseFloat(css.marginBottom)*15),
    lines:new Set([...range.getClientRects()].map(rect=>rect.top)).size,
    bottom:Math.max(...[...range.getClientRects()].map(rect=>rect.bottom))};
  });
  const headings=[...box.querySelectorAll('h3')].map(el=>el.getBoundingClientRect());
  const rows=[...box.querySelectorAll('.reference-photo-row')].map(el=>Math.round((el.getBoundingClientRect().height*toPt+parseFloat(getComputedStyle(el).marginBottom)*.75)*20));
  browser.push({sections,rows,images:box.querySelectorAll('.op-image img').length,
   headings:headings.length,headingGap:(headings[1].top-headings[0].bottom)*toPt,canvas:p.canvasHeightPt,
   margin:(box.getBoundingClientRect().bottom-(sections.at(-1)?.bottom??headings[1].bottom))*toPt});
 }
 const bytes=await (await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front)).arrayBuffer();
 const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 const children=(element,name)=>[...element.children].filter(node=>node.localName===name);
 const prop=(element,name,key='val')=>element.getElementsByTagNameNS(W,name)[0]?.getAttributeNS(W,key);
 const tables=children(children(doc.documentElement,'body')[0],'tbl');
 const exported=tables.map(table=>{
  const cell=children(children(table,'tr')[3],'tc')[2];
  const ps=children(cell,'p').map(p=>{
   const [style]=children(p,'pPr'),runs=children(p,'r').filter(run=>children(run,'t').some(t=>t.textContent));
   const strings=runs.flatMap(run=>children(run,'t').map(t=>t.textContent));
   const anchors=[...p.getElementsByTagNameNS(wp,'anchor')].map(a=>a.getElementsByTagNameNS(wp,'docPr')[0].getAttribute('descr'));
   return {text:strings.join(''),line:+prop(style,'spacing','line'),after:+prop(style,'spacing','after'),lineRule:prop(style,'spacing','lineRule'),
    styledRuns:runs.map(run=>({text:children(run,'t').map(t=>t.textContent).join(''),spacing:+prop(run,'spacing'),fit:prop(run,'fitText'),fitId:prop(run,'fitText','id'),color:prop(run,'color'),highlight:prop(run,'highlight')})),
    fontSize:+prop(runs[0]??p,'sz')/2,letterSpacing:+prop(runs[0]??p,'spacing')/20,
    autospace:[prop(style,'autoSpaceDE'),prop(style,'autoSpaceDN')],grid:prop(style,'snapToGrid'),anchors,
    hardBreaks:runs.flatMap(run=>children(run,'br')).length};
  });
  return {headings:ps.filter(p=>/^([一二])、/.test(p.text)),sections:ps.filter(p=>p.text&&!/^([一二])、/.test(p.text)),rows:ps.filter(p=>!p.text)};
 });
 const readBack=await SOP_WORD.importDocx(bytes);
 const firstColored=[...doc.getElementsByTagNameNS(W,'t')].find(t=>t.textContent==='检');
 firstColored.textContent='复';
 zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
 const originalConfirm=window.confirm;
 let external;
 try{window.confirm=()=>true;external=await SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'}));}
 finally{window.confirm=originalConfirm;}
 const capture=new DOMParser().parseFromString(external.pages[1].importedContent.blocks.map(b=>b.html).join(''),'text/html');
 const styled=[...capture.querySelectorAll('span[style]')].find(span=>span.textContent==='复'&&span.style.color);
 const latin=[...capture.querySelectorAll('span[style]')].find(span=>span.textContent==='M12'&&span.style.letterSpacing);
 const edited={fontSize:styled.style.fontSize,spacing:styled.style.letterSpacing,color:styled.style.color,latinSpacing:latin.style.letterSpacing,workbenchWidth:external.pages[1].importedContent.workbenchWidth};
 return {browser,exported,roundtrip:readBack.pages.map(p=>p.requirements),roundtripStyle:readBack.pages[1].contentStyle,edited,wordSections:doc.getElementsByTagNameNS(W,'sectPr').length,issues:await SOP.validateProjectedPages()};
});
assert.deepEqual(spacingCases.issues,[]);
assert.equal(spacingCases.wordSections,7);
assert.equal(spacingCases.exported.length,7);
for(const [index,expected]of spacingCases.browser.entries()){
 const actual=spacingCases.exported[index];
 assert.equal(actual.headings.length,expected.headings);
 assert.equal(actual.sections.length,expected.sections.length);
 for(const [i,paragraph]of actual.sections.entries()){
  const preview=expected.sections[i];
  assert.equal(paragraph.text,preview.text);
  assert.equal(paragraph.line,preview.line);
  assert.equal(paragraph.after,preview.after);
  assert(Math.abs(paragraph.fontSize-preview.fontSize)<.001);
  for(const run of paragraph.styledRuns){
   const fullWidth=/[\p{Script=Han}。！？]/u.test(run.text);
   assert.equal(run.spacing,Math.round(preview.letterSpacing*(fullWidth?10:20)));
   if(run.fit)assert.equal(Number(run.fit),Math.round((preview.fontSize+preview.letterSpacing)*20));
  }
  assert.equal(paragraph.lineRule,'exact');
  assert.equal(paragraph.grid,'0');
  assert.deepEqual(paragraph.autospace,['0','0']);
  assert.equal(paragraph.hardBreaks,0,'Visual wrapping must keep a native editable paragraph');
 }
 if(expected.rows.length){
  assert.equal(actual.rows.length,expected.rows.length);
  for(const [i,row]of actual.rows.entries()){
   assert(Math.abs(row.line-expected.rows[i])<=1,'Word photo row must reserve actual preview height');
   assert.equal(row.after,0);
   assert.equal(row.lineRule,'exact');
  }
  const placements=actual.rows.flatMap(row=>row.anchors);
  assert.equal(placements.filter(name=>!name.startsWith('SOP标注')&&name!=='作业配图说明').length,expected.images);
  assert.equal(placements.filter(name=>name.startsWith('SOP标注')).length,expected.images);
 }
 if(expected.canvas!==undefined)assert(Math.abs(actual.rows[0].line-expected.canvas*20)<=1);
}
assert(spacingCases.browser[1].sections[0].lines>1,'Long text must naturally wrap in preview');
const mixedRuns=spacingCases.exported[1].sections[0].styledRuns;
assert(mixedRuns.some(run=>run.text==='M12'&&run.spacing===30));
assert(mixedRuns.some(run=>run.text.includes('检查装配')||run.text==='检'&&run.color==='355EA7'));
assert.equal(mixedRuns.filter(run=>run.highlight==='yellow').map(run=>run.text).join(''),'查装配');
const punctuationIds=spacingCases.exported.flatMap(page=>page.sections.flatMap(p=>p.styledRuns.map(run=>run.fitId))).filter(Boolean);
assert.equal(new Set(punctuationIds).size,punctuationIds.length);
assert(punctuationIds.length>3);
assert.equal(spacingCases.browser[1].sections.length,4,'Hard returns separate source paragraphs; whitespace-only paragraphs do not occupy a line');
assert(spacingCases.browser[3].margin<8,'Ordinary-photo fixture must exercise a tight bottom margin');
assert.equal(spacingCases.exported[2].rows[0].anchors.filter(name=>name==='作业配图说明').length,2);
assert.equal(spacingCases.roundtrip[5],' \n　 ');
assert.deepEqual(spacingCases.roundtripStyle,{fontSize:14,letterSpacing:1.5});
assert.deepEqual(spacingCases.edited,{fontSize:'14pt',spacing:'1.5pt',color:'rgb(53, 94, 167)',latinSpacing:'1.5pt',workbenchWidth:true});
assert(Math.abs(spacingCases.exported[6].headings[0].after/20-spacingCases.browser[6].headingGap)<.06);
assert.deepEqual(errors,[]);console.log('PASS: remaining page space assigned to canvas, larger font reduces canvas only, text stays inside, geometry/font preserved and Word roundtrip');
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
