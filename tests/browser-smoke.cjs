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
  assert(await page.evaluate(()=>SOP.project.settings.company===(window.SOP_REFERENCE?.defaults?.company??SOP_ASSETS.seed.settings.company)));

  page.once('dialog',dialog=>dialog.accept());
  const cover=await page.evaluate(async()=>{
   const p=SOP.clone(SOP.project);
   Object.assign(p.meta,{approver:'批准甲乙',qualitySigner:'',reviewer:'审核甲',productionSignature:'已签字',author:'',authorSignature:'签名乙'});
   const blob=await SOP_WORD.exportDocx(p,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer()),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
   const xml=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
   const find=(node,local)=>node.getElementsByTagNameNS(w,local)[0];
   const coverTable=find(xml,'tbl');
   const nestedTables=coverTable.getElementsByTagNameNS(w,'tbl').length;
   const rows=[...coverTable.getElementsByTagNameNS(w,'p')].filter(row=>find(row,'tabs'));
   const fields=rows.map(row=>{
    const values=[...row.children].filter(r=>r.localName==='r'&&find(r,'tab')).map(r=>r.textContent);
    const tabs=[...find(row,'tabs').children].map(tab=>[tab.getAttributeNS(w,'val'),tab.getAttributeNS(w,'pos')]);
    const rules=[...row.getElementsByTagNameNS(wp,'anchor')].map(anchor=>[
     anchor.getAttribute('behindDoc'),anchor.getElementsByTagNameNS(wp,'extent')[0].getAttribute('cx')
    ]);
    return {values,tabs,rules};
   });
   const roundtrip=await SOP_WORD.importDocx(await blob.arrayBuffer());
   const retained=[roundtrip.meta.productionSignature,roundtrip.meta.authorSignature];
   const read=async()=>SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'}));
   const serialize=()=>zip.file('word/document.xml',new XMLSerializer().serializeToString(xml));
   const tabFields=row=>[...row.children].filter(r=>r.localName==='r'&&find(r,'tab'));
   tabFields(rows[0])[0].getElementsByTagNameNS(w,'t')[0].textContent='Word外部改名';
   tabFields(rows[2])[2].getElementsByTagNameNS(w,'t')[0].textContent='已签字';
   tabFields(rows[4])[2].getElementsByTagNameNS(w,'t')[0].textContent='签名乙';
   serialize();
   const imported=await read();
   const savedFields=[imported.meta.approver,imported.meta.qualitySigner,imported.meta.productionSignature,imported.meta.reviewer,imported.meta.authorSignature];
   imported.meta.qualitySigner='会签补录';
   const original=SOP_WORD.originalFrontBlocks(imported,'cover').map(block=>block.xml).join('');
   const originalZip=await JSZip.loadAsync(await (await SOP_WORD.exportOriginal(imported)).arrayBuffer());
   const sourceXml=await originalZip.file('word/document.xml').async('string');
   await SOP_WORD.refreshOriginalCover(imported);
   const originalPreview=SOP_WORD.originalCoverPreview(imported).map(block=>block.html).join('');
   const element=(tag,text)=>{const node=xml.createElementNS(w,'w:'+tag);if(text!==undefined)node.textContent=text;return node;};
   const old=element('tbl'),row=element('tr');
   old.append(row);
   for(const value of ['','质量会签：','','旧版姓名','','签字：','','旧版签字']){
    const c=element('tc'),paragraph=element('p'),r=element('r');
    r.append(element('t',value));paragraph.append(r);c.append(paragraph);row.append(c);
   }
   rows[1].replaceWith(old);
   const inline=element('p'),label=element('r'),line=element('r'),style=element('rPr'),underline=element('u');
   label.append(element('t','审　核：旧版审核　签字：'));
   underline.setAttributeNS(w,'w:val','single');
   style.append(underline);line.append(style,element('t','  旧版审核签字  '));
   inline.append(label,line);rows[3].replaceWith(inline);
   zip.remove('customXml/sop-project.xml');
   serialize();
   const legacy=await read();
   const retainedLegacy=SOP_WORD.originalFrontBlocks(legacy,'cover').map(block=>block.xml).join('');
   await SOP_WORD.refreshOriginalCover(legacy);
   const legacyPreview=SOP_WORD.originalCoverPreview(legacy).map(block=>block.html).join('');
   return {nestedTables,fields,retained,imported:savedFields,
    originalUpdated:original.includes('会签补录'),sourceSigned:sourceXml.includes('已签字')&&sourceXml.includes('签名乙'),
    originalUnsigned:[original,originalPreview].every(text=>!text.includes('已签字')&&!text.includes('签名乙')),
    legacy:[legacy.meta.qualitySigner,legacy.meta.qualitySignature,legacy.meta.reviewer,legacy.meta.reviewerSignature],
    legacyUnsigned:[retainedLegacy,legacyPreview].every(text=>!text.includes('旧版签字')&&!text.includes('旧版审核签字')),
    legacyUnderline:legacyPreview.includes('text-decoration:underline')&&legacyPreview.includes(String.fromCharCode(160))};
  });
  assert.equal(cover.nestedTables,0);
  assert.deepEqual(cover.fields.map(f=>f.values),[['批准甲乙','签字：',''],['','签字：',''],['','签字：',''],['审核甲','签字：',''],['','签字：','']]);
  for(const field of cover.fields){
   assert.deepEqual(field.tabs,[['center','7677'],['center','8896'],['center','10172']]);
   assert.deepEqual(field.rules,[['1','972185'],['1','1043940']]);
  }
  assert.deepEqual(cover.imported,['Word外部改名','','已签字','审核甲','签名乙']);
  assert.deepEqual(cover.retained,['已签字','签名乙']);
  assert(cover.originalUpdated&&cover.sourceSigned&&cover.originalUnsigned&&cover.legacyUnsigned&&cover.legacyUnderline);
  await page.evaluate(()=>{SOP.project.meta.approverSignature='旧签字隐藏验证';SOP.setSelected('front:cover:0');});
  assert.equal(await page.locator('#editContent [data-front-key$="Signature"]').count(),0);
  assert.equal(await page.locator('#editContent [data-front-key="approver"]').count(),1);
  assert.deepEqual(await page.locator('#previewStage .reference-cover-sign > :last-child').allTextContents(),Array(5).fill(''));
  assert.equal(await page.locator('#previewStage [data-print-target$="Signature"]').count(),0);
  await page.locator('#metaBtn').click();
  assert.equal(await page.locator('[data-docmeta$="Signature"]').count(),0);
  assert.equal(await page.locator('[data-docmeta="approver"]').count(),1);
  await page.locator('#formDialog').press('Escape');
  assert.deepEqual(cover.legacy,['旧版姓名','旧版签字','旧版审核','旧版审核签字']);
  await page.locator('#settingsBtn').click();await page.locator('[data-setting="company"]').fill('示例制造有限公司');await page.locator('#logoFile').setInputFiles(path.join(root,'desktop/build/icon.png'));await page.waitForFunction(()=>document.querySelector('#settingsLogo').src.startsWith('data:image/png'));await page.locator('#dialogApply').click();
  const result=await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project);project.settings.confidential=String.fromCharCode(9)+'保密等级：'+String.fromCharCode(10)+'一般';project.pages[0].name='准备';project.pages[0].steps='1、准备工具。';project.pages.push({...SOP.blankPage(),name:'检查',steps:'1、检查工件。'});project.pages.push({...SOP.blankPage(),name:'包装',steps:'1、包装入库。'});SOP.replaceProject(project);SOP.moveRenderedPage(0,2);
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string'),round=await SOP_WORD.importDocx(await blob.arrayBuffer());
   const header=new DOMParser().parseFromString(await zip.file('word/header-sop.xml').async('string'),'application/xml'),cleanHeader=[...header.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].every(n=>![9,10,13].some(c=>n.textContent.includes(String.fromCharCode(c))));
   return {cleanHeader,names:SOP.layout.map(p=>p.name),numbering:SOP.layout.every((p,i)=>p.pageNo===i+1&&p.total===3),front:SOP.front.map(f=>f.kind),company:round.settings.company,logo:round.settings.logo===SOP.project.settings.logo,editableFlow:xml.includes('流程节点'),logoInWord:xml.includes('descr="公司 Logo"')};
  });
  assert.deepEqual(result.names,['检查','包装','准备']);assert.deepEqual(result.front,['cover','history','flow']);assert(result.cleanHeader&&result.numbering&&result.logo&&result.editableFlow&&result.logoInWord);assert.equal(result.company,'示例制造有限公司');

  const native=await page.evaluate(async()=>{
   const p=SOP.clone(SOP.project);p.pages[0].photos=[{id:SOP.uid(),data:p.settings.logo,caption:'通用验证图',marks:[{type:'text',x:.1,y:.2,x2:.1,y2:.2,text:'蓝字黄底',color:'#0066cc',background:'#ffff00',fontSize:.05},{type:'text',x:.1,y:.6,x2:.1,y2:.6,text:'透明背景',color:'#111111',background:'transparent',fontSize:.05},{type:'rect',x:.5,y:.2,x2:.8,y2:.7,color:'#e22d32'},{type:'line',x:.1,y:.8,x2:.8,y2:.8,color:'#e22d32'}]}];SOP.replaceProject(p);await SOP.prepareImages();SOP.recalc();
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),source=await JSZip.loadAsync(await blob.arrayBuffer());source.remove('customXml/sop-project.xml');const merged=new DOMParser().parseFromString(await source.file('word/document.xml').async('string'),'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',operations=[...merged.getElementsByTagNameNS(W,'tbl')].filter(t=>[...t.children].filter(c=>c.localName==='tr')[2]?.textContent.includes('工序作业内容'));
   const sourceRows=[...operations[0].children].filter(child=>child.localName==='tr');
   for(const [row,column] of [[19,0],[19,1],[21,0],[22,0]]){
    const cell=[...sourceRows[row].children].filter(child=>child.localName==='tc')[column];
    const content=cell.getElementsByTagNameNS(W,'p')[0];
    const run=merged.createElementNS(W,'w:r');
    run.append(merged.createElementNS(W,'w:tab'));
    content.append(run);
   }
   for(const row of [...operations[1].children].filter(c=>c.localName==='tr'))operations[0].append(row);operations[1].remove();source.file('word/document.xml',new XMLSerializer().serializeToString(merged));const bytes=await source.generateAsync({type:'arraybuffer'}),xml=await source.file('word/document.xml').async('string'),restored=await SOP_WORD.importDocx(bytes);SOP.replaceProject(restored);await SOP.prepareImages();SOP.recalc();
   const round=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),z=await JSZip.loadAsync(await round.arrayBuffer()),rels=new DOMParser().parseFromString(await z.file('word/_rels/document.xml.rels').async('string'),'application/xml'),ids=[...rels.documentElement.children].map(r=>r.getAttribute('Id'));
   const first=SOP.project.pages[0];
   return {importedCaptions:first.photos.map(photo=>photo.caption),importedPlaceholders:[first.duration,first.people,...first.changeRecords.map(row=>row.number)],nativePages:SOP.project.pages.filter(p=>SOP_IMPORT.active(p)).length,originalRetained:SOP.project.nativeWord.documentXml===xml,uniqueRelationships:new Set(ids).size===ids.length,hasColors:xml.toLowerCase().includes('0066cc')&&xml.toLowerCase().includes('ffff00')};
  });assert.equal(native.nativePages,3);assert.deepEqual(native.importedCaptions,['']);assert.deepEqual(native.importedPlaceholders,['','','','']);assert(native.originalRetained&&native.uniqueRelationships&&native.hasColors);

  const recovery=await page.evaluate(async()=>{const full=SOP.clone(SOP.project),old=SOP.clone(full);old.pages.splice(1,1);old.nativeWord.projectState=SOP_IMPORT.projectState(old);old.pages.reverse();old.pages[0].steps+='\n保留用户新增文字';const ids=old.pages.map(p=>p.id),fixedSteps=old.pages[0].steps;const result=await SOP_WORD.recoverMissing(old),deleted=SOP.clone(full);deleted.pages.splice(1,1);return {missing:SOP_WORD.legacyMissingCount(old),restored:result.added,count:result.project.pages.length,edits:result.project.pages.find(p=>p.id===ids[0]).steps===fixedSteps,order:result.project.pages.filter(p=>ids.includes(p.id)).map(p=>p.id).join()===ids.join(),intentionalDeletion:SOP_WORD.legacyMissingCount(deleted)};});assert.equal(recovery.missing,1);assert.equal(recovery.restored,1);assert.equal(recovery.count,3);assert(recovery.edits&&recovery.order);assert.equal(recovery.intentionalDeletion,0);
  await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.SOP?.project.settings.company==='示例制造有限公司');assert.equal(await page.evaluate(()=>SOP.project.pages.filter(p=>SOP_IMPORT.active(p)).length),3);assert.deepEqual(errors,[]);


  await page.evaluate(()=>SOP.setSelected('front:cover:0'));await page.locator('#convertFront').click();await page.locator('[data-front-key="coverHeading"]').fill('封面可编辑验证');await page.evaluate(()=>SOP.setSelected('front:history:0'));await page.locator('#convertFront').click();await page.locator('[data-front-key="historyTitle"]').fill('履历可编辑验证');await page.locator('#addHistoryRow').click();await page.locator('[data-history-key="summary"]').last().fill('新增履历验证');await page.evaluate(()=>SOP.setSelected('front:flow:0'));await page.locator('#flowNoteInput').fill('流程图下栏编辑验证');await page.locator('#convertFront').click();await page.locator('#editFlowGraph').click();await page.locator('.object-dialog [data-add="rect"]').click();const drawBounds=await page.locator('.object-dialog svg').boundingBox();await page.mouse.move(drawBounds.x+30,drawBounds.y+30);await page.mouse.down();await page.mouse.move(drawBounds.x+180,drawBounds.y+100,{steps:5});await page.mouse.up();await page.locator('.object-dialog [data-prop="text"]').fill('流程节点乙');await page.locator('.object-dialog [data-action="save"]').click();await page.evaluate(()=>{SOP.moveDocumentPage(0,4);SOP.moveDocumentPage(0,2);SOP.moveDocumentPage(0,5);});const fronts=await page.evaluate(async()=>{const ordered=SOP.orderedPages(),blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),zip=await JSZip.loadAsync(await blob.arrayBuffer()),text=await zip.file('word/document.xml').async('string'),round=await SOP_WORD.importDocx(await blob.arrayBuffer());const doc=new DOMParser().parseFromString(text,'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',tables=[...doc.getElementsByTagNameNS(W,'body')[0].children].filter(x=>x.localName==='tbl'),rows=t=>[...t.children].filter(x=>x.localName==='tr'),cs=r=>[...r.children].filter(x=>x.localName==='tc'),coverCell=cs(rows(tables.find(t=>t.textContent.includes('封面可编辑验证')))[0])[1],flowTable=tables.find(t=>t.textContent.includes('流程节点乙')&&t.textContent.includes('流程图下栏编辑验证'));return {coverCentered:coverCell.getElementsByTagNameNS(W,'jc')[0].getAttributeNS(W,'val')==='center',coverSize:coverCell.getElementsByTagNameNS(W,'sz')[0].getAttributeNS(W,'val'),mergedHeader:cs(rows(flowTable)[0]).length===1,noteSaved:round.frontContent.flowNote==='流程图下栏编辑验证',kinds:ordered.map(x=>x.kind),numbers:SOP.layout.map(p=>[p.pageNo,p.total]),cover:text.includes('封面可编辑验证'),history:text.includes('新增履历验证'),flow:text.includes('流程节点乙'),orderSaved:JSON.stringify(round.pageOrder)===JSON.stringify(SOP.project.pageOrder),contentSaved:round.frontContent.coverHeading==='封面可编辑验证'};});assert.deepEqual(fronts.kinds,['body','history','body','cover','body','flow']);assert.deepEqual(fronts.numbers,[[1,3],[2,3],[3,3]]);assert(fronts.coverCentered&&fronts.coverSize==='32'&&fronts.mergedHeader&&fronts.noteSaved);assert(fronts.cover&&fronts.history&&fronts.flow&&fronts.orderSaved&&fronts.contentSaved);await page.setViewportSize({width:1500,height:1200});await page.waitForTimeout(300);await page.locator('[data-document-index="5"]').dragTo(page.locator('[data-document-index="0"]'));assert.equal(await page.evaluate(()=>SOP.orderedPages()[0].kind),'flow');assert.deepEqual(await page.evaluate(()=>SOP.layout.map(p=>[p.pageNo,p.total])),[[1,3],[2,3],[3,3]]);

  await page.evaluate(()=>{const p=SOP.clone(SOP.project);delete p.pageOrder;p.meta.author='封面制定';p.meta.date='2026-10-25';p.meta.version='A1';p.pages=[SOP.blankPage()];delete p.pages[0].signoff;SOP.replaceProject(p);});assert.equal(await page.locator('[data-signoff="author"]').inputValue(),'封面制定');await page.locator('[data-signoff="author"]').fill('工序编制');await page.locator('[data-signoff="authorDate"]').fill('2026-10-31');await page.locator('[data-signoff="reviewerDate"]').fill('2026-11-01');await page.locator('[data-pin="signoff"]').click();assert(await page.locator('[data-signoff="author"]').evaluate(n=>n.readOnly));await page.locator('#addBtn').click();assert.equal(await page.locator('[data-signoff="author"]').inputValue(),'工序编制');await page.locator('[data-pin="signoff"]').click();await page.locator('[data-signoff="author"]').fill('第二页编制');const independentSignoff=await page.evaluate(async()=>{SOP.project.meta.author='改后的封面';SOP.project.meta.date='2027-01-01';SOP.recalc();const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),round=await SOP_WORD.importDocx(await blob.arrayBuffer());return {first:round.pages[0].signoff,second:round.pages[1].signoff,cover:round.meta.author};});assert.equal(independentSignoff.first.author,'工序编制');assert.equal(independentSignoff.second.author,'第二页编制');assert.equal(independentSignoff.first.authorDate,'2026-10-31');assert.equal(independentSignoff.second.reviewerDate,'2026-11-01');assert.equal(independentSignoff.cover,'改后的封面');
  const fit=await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project),operation=SOP.blankPage();
   operation.steps='1、核对工件位置。\n2、确认安装正确。';
   operation.requirements='验收末行完整。';
   operation.photos=Array.from({length:2},(_,i)=>({id:SOP.uid(),data:project.settings.logo,caption:'配图 '+(i+1),marks:[]}));
   project.pages=[operation];SOP.replaceProject(project);await SOP.prepareImages();SOP.refresh();
   return {count:SOP.layout.length,photos:SOP.layout[0].photos.length,scale:SOP.layout[0].fitScale};
  });
  assert.deepEqual(fit,{count:1,photos:2,scale:1});assert.equal(await page.locator('#fitMode').count(),0);
  const fitWord=await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project);
   project.settings.importance='2';
   project.settings.management='备注：';
   const blob=await SOP_WORD.exportDocx(project,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer());
   const xml=await zip.file('word/document.xml').async('string');
   const content=new DOMParser().parseFromString(xml,'application/xml').documentElement.textContent.replace(/\s+/g,'');
   return ['2、确认安装正确。','验收末行完整。','配图2','重要度：a、关键','管理手段：a、记录表'].every(text=>content.includes(text));
  });
  assert(fitWord);

  for(const level of ['绝密','机密','一般']){await page.locator('#settingsBtn').click();assert.equal(await page.locator('input[data-setting="confidential"]').count(),0);await page.locator('[data-setting="confidentialLevel"]').selectOption(level);await page.locator('#dialogApply').click();const selected=await page.evaluate(async level=>{const expected='保密等级：'+['绝密','机密','一般'].map(x=>(x===level?'☑':'☐')+x).join('  ');SOP.refresh();const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front),z=await JSZip.loadAsync(await blob.arrayBuffer()),header=new DOMParser().parseFromString(await z.file('word/header-sop.xml').async('string'),'application/xml'),text=[...header.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].map(n=>n.textContent).join(''),round=await SOP_WORD.importDocx(await blob.arrayBuffer());return document.querySelector('#previewStage .confidential').textContent===expected&&text.includes(expected)&&round.settings.confidentialLevel===level;},level);assert(selected);}await page.waitForTimeout(700);await page.reload();await page.waitForFunction(()=>window.SOP?.project.settings.confidentialLevel==='一般');assert.deepEqual(errors,[]);
  const operationIds=await page.evaluate(()=>{
   const project=SOP.clone(SOP.project);
   for(const key of ['originalFront','frontContent','nativeWord','pageOrder'])delete project[key];
   Object.assign(project.settings,{cover:false,history:false,flow:true});
   project.pages=['准备','检验','包装'].map(name=>({...SOP.blankPage(),name}));
   SOP.replaceProject(project);
   return project.pages.map(operation=>operation.id);
  });
  const label=page.locator('#processLabelInput');
  const projectedLabel=page.locator('#previewStage [data-print-box="工序号"]');
  assert(await label.evaluate(input=>{
   const before=(other)=>Boolean(input.compareDocumentPosition(other)&Node.DOCUMENT_POSITION_FOLLOWING);
   return input.type==='text'&&before(document.querySelector('[data-meta="station"]'))&&Boolean(input.compareDocumentPosition(document.querySelector('#nameInput'))&Node.DOCUMENT_POSITION_PRECEDING);
  }));
  await label.fill('010');
  await page.waitForFunction(()=>document.querySelector('#previewStage [data-print-box="工序号"]').textContent==='010');
  await page.evaluate(id=>SOP.setSelected(id),operationIds[1]);
  await label.fill('A-01');
  await page.evaluate(()=>SOP.moveRenderedPage(0,2));
  assert.equal(await projectedLabel.textContent(),'010');
  await page.evaluate(id=>SOP.setSelected(id),operationIds[2]);
  assert.equal(await label.inputValue(),'');
  assert.equal(await projectedLabel.textContent(),'02');
  await page.evaluate(id=>{
   SOP.setSelected(id);
   document.querySelector('#continueBtn').click();
  },operationIds[0]);
  assert.equal(await label.inputValue(),'010');
  await label.fill('012');
  await page.waitForFunction(()=>document.querySelector('#previewStage [data-print-box="工序号"]').textContent==='012');
  await page.evaluate(async()=>{
   const dir=await navigator.storage.getDirectory();
   const file=await dir.getFileHandle('operation-numbers.sop.json',{create:true});
   window.showSaveFilePicker=async()=>file;
   window.showOpenFilePicker=async()=>[file];
  });
  await page.locator('#saveAsBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('operation-numbers.sop.json'));
  await page.locator('#importBtn').click();
  await page.waitForFunction(()=>document.querySelector('#processLabelInput').value==='A-01');
  const previewFlowLabels=await page.evaluate(()=>{
   const labels=[],original=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(text,...args){
    if(this.canvas.width===1500&&this.canvas.height===850)labels.push(text);
    return original.call(this,text,...args);
   };
   try{SOP.setSelected('front:flow:0');}
   finally{CanvasRenderingContext2D.prototype.fillText=original;SOP.setSelected(SOP.project.pages[0].id);}
   return labels;
  });
  assert.deepEqual(previewFlowLabels,['检验','包装','准备']);
  const operationNumbers=await page.evaluate(async()=>{
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front);
   const bytes=await blob.arrayBuffer(),zip=await JSZip.loadAsync(bytes);
   const xml=await zip.file('word/document.xml').async('string');
   const document=new DOMParser().parseFromString(xml,'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const rows=table=>[...table.children].filter(node=>node.localName==='tr');
   const tables=[...document.getElementsByTagNameNS(W,'tbl')];
   const visible=tables.filter(table=>rows(table)[2]?.textContent.includes('工序作业内容')).map(table=>rows(table)[3].getElementsByTagNameNS(W,'tc')[0].textContent);
   const embedded=await SOP_WORD.importDocx(bytes);
   zip.remove('customXml/sop-project.xml');
   const imported=await SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'}));
   return {
    visible, saved:embedded.pages.map(operation=>operation.processLabel??''),
    imported:imported.pages.map(operation=>operation.processLabel),
    pageNos:SOP.layout.map(operation=>operation.pageNo),
    flow:[...rows(tables.find(table=>rows(table)[0]?.textContent.includes('工艺流程图')))[1]
     .getElementsByTagNameNS(W,'txbxContent')].map(node=>node.textContent)
   };
  });
  assert.deepEqual(operationNumbers,{
   visible:['A-01','02','012','012'], saved:['A-01','','012','012'],
   imported:['A-01','02','012','012'], pageNos:[1,2,3,4], flow:['检验','包装','准备']
  });
  await label.fill('');
  await page.waitForFunction(()=>document.querySelector('#previewStage [data-print-box="工序号"]').textContent==='01');

  await page.evaluate(()=>{
   const project=SOP.clone(SOP.project);
   project.pages[0].materials=[{name:'示例物料',spec:'M4',qty:'1'}];
   project.pages[0].checks=[{feature:'位置',standard:'平齐',self:'全检',audit:'抽检',importance:'自定',method:'复核'}];
   SOP.replaceProject(project);
  });
  await page.locator('[data-tab="quality"]').click();
  const inspection=(row,key)=>page.locator('[data-check="'+row+'"][data-key="'+key+'"]');
  assert.equal(await inspection(0,'importance').inputValue(),'自定');
  assert.equal(await inspection(0,'method').inputValue(),'复核');
  await page.locator('#addCheck').click();
  const options=(row,key)=>inspection(row,key).locator('option').evaluateAll(items=>items.map(item=>[item.value,item.text]));
  const defaultImportance=[['','留空'],['a','a · 关键'],['b','b · 重要'],['c','c · 一般']];
  const defaultMethods=[['','留空'],['a','a · 记录表'],['b','b · 控制图'],['c','c']];
  assert.deepEqual(await options(0,'importance'),[...defaultImportance,['自定','自定']]);
  assert.deepEqual(await options(0,'method'),[...defaultMethods,['复核','复核']]);
  assert.deepEqual(await options(1,'importance'),defaultImportance);
  assert.deepEqual(await options(1,'method'),defaultMethods);
  assert.equal(await inspection(1,'importance').inputValue(),'');
  assert.equal(await inspection(1,'method').inputValue(),'');
  await inspection(1,'importance').selectOption('b');
  await inspection(1,'method').selectOption('c');
  await inspection(1,'importance').selectOption('');
  await page.locator('[data-pin="checks"]').click();
  assert(await inspection(1,'method').isDisabled());
  await page.locator('[data-pin="checks"]').click();
  assert(await inspection(1,'method').isEnabled());

  for(const width of [1440,360]){
   await page.setViewportSize({width,height:900});
   const tidy=await page.locator('#editContent').evaluate(editor=>{
    const box=element=>element.getBoundingClientRect();
    const center=(rectangle,axis)=>axis==='x'?(rectangle.left+rectangle.right)/2:(rectangle.top+rectangle.bottom)/2;
    const inspection=editor.querySelector('[data-remove-check]');
    const material=editor.querySelector('[data-remove-material]');
    const row=box(inspection.closest('.check-row'));
    const checkBox=box(inspection),materialBox=box(material),cell=box(material.closest('td'));
    const input=box(editor.querySelector('[data-check="0"][data-key="standard"]'));
    return Math.abs(checkBox.right-row.right)<1&&Math.abs(center(checkBox,'y')-center(input,'y'))<1&&
     Math.abs(center(materialBox,'x')-center(cell,'x'))<1&&Math.abs(center(materialBox,'y')-center(cell,'y'))<1&&
     [...editor.querySelectorAll('.check-extra :is(select,input)')].every(element=>box(element).right<=row.right+1)&&
     [inspection,material].every(button=>getComputedStyle(button).placeItems==='center'&&getComputedStyle(button,'::before').transform!==getComputedStyle(button,'::after').transform);
   });
   assert(tidy,'Inspection controls and delete buttons align at '+width+'px');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#saveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('项目文件已保存'));
  await page.evaluate(()=>{
   SOP.project.pages[0].checks[1].method='a';
   SOP.renderEditor();
  });
  await page.locator('#importBtn').click();
  await page.waitForFunction(()=>SOP.project.pages[0].checks[1]?.method==='c');
  assert.equal(await inspection(0,'importance').inputValue(),'自定');
  assert.equal(await inspection(0,'method').inputValue(),'复核');
  assert.equal(await inspection(1,'importance').inputValue(),'');
  assert.equal(await inspection(1,'method').inputValue(),'c');
  assert.equal(await page.locator('#previewStage [data-print-box="检验 1 管理手段"]').textContent(),'复核');
  assert.equal(await page.locator('#previewStage [data-print-box="检验 2 管理手段"]').textContent(),'c');
  const inspectionWord=await page.evaluate(async()=>{
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer());
   const xml=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
   const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const operation=[...xml.getElementsByTagNameNS(W,'tbl')].find(table=>table.textContent.includes('工序作业内容'));
   return [...operation.getElementsByTagNameNS(W,'tr')].slice(12,14).map(row=>[...row.getElementsByTagNameNS(W,'tc')].slice(8,10).map(cell=>cell.textContent));
  });
  assert.deepEqual(inspectionWord,[['自定','复核'],['','c']]);
  const importedChecks=await page.evaluate(async()=>{
   const project=SOP.clone(SOP.project);
   project.settings.importance='2、重要度：Ａ、重点；c＝一般项。';
   project.settings.management='管理手段:b:巡检表 / c:逐批确认';
   const blob=await SOP_WORD.exportDocx(project,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer());
   zip.remove('customXml/sop-project.xml');
   SOP.replaceProject(await SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'})));
   return SOP.project.pages[0].checks;
  });
  const importedImportance=importedChecks[0].importance,importedMethod=importedChecks[0].method;
  assert.equal(importedImportance.trim(),'自定');
  assert.equal(importedMethod.trim(),'复核');
  assert.deepEqual(await options(0,'importance'),[['','留空'],['a','a · 重点'],['b','b'],['c','c · 一般项'],[importedImportance,'自定']]);
  assert.deepEqual(await options(0,'method'),[['','留空'],['a','a'],['b','b · 巡检表'],['c','c · 逐批确认'],[importedMethod,'复核']]);
  await inspection(1,'importance').selectOption('');
  await inspection(1,'method').selectOption('c');
  await page.locator('[data-pin="checks"]').click();
  await page.evaluate(()=>document.querySelector('#continueBtn').click());
  assert(await inspection(0,'importance').isDisabled());
  assert(await inspection(1,'method').isDisabled());
  assert.equal(await inspection(0,'importance').inputValue(),importedImportance);
  assert.equal(await inspection(0,'method').inputValue(),importedMethod);
  assert.equal(await inspection(1,'importance').inputValue(),'');
  assert.equal(await inspection(1,'method').locator('option:checked').textContent(),'c · 逐批确认');
  await page.evaluate(()=>{
   Object.assign(SOP.project.settings,{importance:'2',management:'备注：'});
   SOP.renderEditor();
   SOP.refresh();
  });
  assert.deepEqual(await options(0,'importance'),[...defaultImportance,[importedImportance,'自定']]);
  assert.deepEqual(await options(0,'method'),[...defaultMethods,[importedMethod,'复核']]);
  assert.deepEqual(errors,[]);
  console.log('PASS: browser launch, company/logo, page order, operation numbers, inspection dropdowns and alignment, Word roundtrip and project storage');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
