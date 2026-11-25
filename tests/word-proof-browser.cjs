const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');
const Zip=require('../outputs/SOP工作台/vendor/jszip.min.js');

async function main(){
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,['scripts/serve.cjs','--port','0'],{cwd:root,windowsHide:true});
 let browser;
 try{
  const [output]=await once(server.stdout,'data');
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1510,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(JSON.parse(output.toString()).url);
  await page.waitForFunction(()=>window.SOP&&document.body.dataset.recovery);
  const info=await page.evaluate(()=>{
   const base=SOP.clone(SOP.project);
   const pic=(color)=>{
    const c=document.createElement('canvas');c.width=55;c.height=35;
    const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,55,35);
    return {width:55,height:35,data:c.toDataURL(),caption:'独立照片',marks:[{type:'arrow',x:.1,y:.1,x2:.4,y2:.8,color:'#cc5533'}]};
   };
   const source=SOP.blankPage();
   Object.assign(source,{name:'其他工序数据专用哨兵',steps:'其他页正文专用哨兵',photos:[pic('#559922')],
    materials:Array.from({length:7},(_,i)=>({name:'其他物料'+i}))});
   const target=SOP.blankPage(source.processId);
   Object.assign(target,{name:'校样当前工序',steps:'只包含这道工序的正文。',requirements:'放行前确认位置。',photos:[pic('#cc551a')],processLabel:'09'});
   const last=SOP.blankPage();
   Object.assign(last,{name:'校样另一个页面',steps:'其他页终端标记'});
   Object.assign(base.settings,{cover:true,flow:true,history:true,showLogo:false});
   base.frontContent={coverMode:'editable',coverHeading:'其他封面专用哨兵'};
   base.history=[{summary:'其他履历专用哨兵'}];
   base.pages=[source,target,last];
   base.pageOrder=['body:'+source.id+':0','front:cover:0','body:'+target.id+':0','front:history:0','body:'+last.id+':0','front:flow:0'];
   SOP.replaceProject(base);
   SOP.setSelected(target.id);
   return {source:source.id,target:target.id,last:last.id,photo:target.photos[0].data.split(',')[1]};
  });
  const proof=page.locator('#wordProofBtn');
  await proof.waitFor();
  assert.equal(await proof.textContent(),'下载本页 Word 校样');
  assert.match(await proof.getAttribute('title'),/手动保留或删除/);
  assert.equal((await page.evaluate(()=>SOP.validateProjectedPages())).length,1);
  async function downloadProof(){
   const [download]=await Promise.all([page.waitForEvent('download'),proof.click()]);
   return {name:download.suggestedFilename(),bytes:await fs.readFile(await download.path())};
  }
  const browserProof=await downloadProof();
  assert.match(browserProof.name,/09_校样当前工序（续）_Word校样\.docx$/);
  const generated=await Zip.loadAsync(browserProof.bytes);
  async function readProof(zip){
   const doc=await zip.file('word/document.xml').async('string');
   const headerFiles=Object.keys(zip.files).filter(name=>/^word\/header[^/]+\.xml$/.test(name));
   assert.equal(headerFiles.length,1);
   const header=await zip.file(headerFiles[0]).async('string');
   const app=await zip.file('docProps/app.xml').async('string');
   assert.match(app,/<Pages>1<\/Pages>/);
   assert.equal((doc.match(/<w:tbl[ >]/g)||[]).length,1);
   assert(!zip.file('customXml/sop-project.xml'));
   assert(!zip.file('word/media/image1.png'));
   assert(!zip.file('word/footer1.xml'));
   assert(!doc.includes('其他工序数据专用哨兵')&&!doc.includes('其他页正文专用哨兵')&&!doc.includes('其他履历专用哨兵'));
   assert(doc.includes('只包含这道工序的正文')&&doc.includes('放行前确认位置')&&doc.includes('SOP标注'));
   assert.match(header,/<w:instrText[^>]*> PAGE <\/w:instrText>/);
   assert.match(header,/<w:instrText[^>]*>= 3 <\/w:instrText>/);
   assert(!header.includes('NUMPAGES'));
   const label=[...header.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(match=>match[1]).join('').replace(/\s+/g,' ').trim();
   assert.match(label,/第 2 页 共 3 页/);
   return doc;
  }
  const generatedDoc=await readProof(generated);
  assert(generatedDoc.includes('校样当前工序（续）'));
  assert.match(generatedDoc,/>09<\//);
  const generatedMedia=Object.keys(generated.files).filter(name=>/^word\/media\/[^/]+$/.test(name));
  assert.equal(generatedMedia.length,1);
  assert.equal(await generated.file(generatedMedia[0]).async('base64'),info.photo);

  await page.evaluate(id=>SOP.setSelected(id),info.source);
  await proof.click();
  const issues=page.locator('#exportIssuesDialog');
  await issues.waitFor();
  assert.match(await issues.innerText(),/其他工序数据专用哨兵/);
  assert.doesNotMatch(await issues.innerText(),/校样当前工序/);
  await issues.locator('#closeExportIssues').click();
  await page.evaluate(()=>SOP.setSelected('front:cover:0'));
  await proof.waitFor({state:'hidden'});

  await page.evaluate(id=>{
   SOP.setSelected(id);
   const original=SOP_WORD.exportProof;
   SOP_WORD.exportProof=async(...args)=>{
    await new Promise(resolve=>window.releaseProof=resolve);
    try{return await original(...args);}finally{SOP_WORD.exportProof=original;}
   };
  },info.target);
  let releasedDownloads=0;
  const observe=()=>releasedDownloads++;
  page.on('download',observe);
  await proof.click();
  await page.waitForFunction(()=>typeof window.releaseProof==='function');
  await page.evaluate(id=>{SOP.setSelected(id);window.releaseProof();},info.last);
  await page.waitForFunction(()=>!document.querySelector('#wordProofBtn').disabled);
  await page.waitForTimeout(100);
  assert.equal(releasedDownloads,0,'Changing the selected page must cancel in-flight proofs');
  page.off('download',observe);

  await page.evaluate(async()=>{
   const source=SOP.clone(SOP.project);
   source.pages[0].materials=[];
   SOP.replaceProject(source);
   const formal=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await formal.arrayBuffer());
   const parse=name=>zip.file(name).async('string').then(text=>new DOMParser().parseFromString(text,'application/xml'));
   const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
   const doc=await parse('word/document.xml'),rels=await parse('word/_rels/document.xml.rels');
   const step=[...doc.getElementsByTagNameNS(W,'p')].find(p=>p.textContent==='只包含这道工序的正文。');
   const start=doc.createElementNS(W,'w:bookmarkStart'),end=doc.createElementNS(W,'w:bookmarkEnd');
   for(const bookmark of [start,end])bookmark.setAttributeNS(W,'w:id','701');
   start.setAttributeNS(W,'w:name','currentProofBookmark');
   step.children[0].after(start);step.append(end);
   const unused=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');
   unused.setAttribute('Id','rIdUnrelatedAttachment');unused.setAttribute('Type',R+'/package');
   unused.setAttribute('Target','embeddings/unreferenced-attachment.bin');
   rels.documentElement.append(unused);
   zip.file('word/embeddings/unreferenced-attachment.bin','unrelated private attachment');
   zip.file('customXml/extra-source.xml','unrelated private source snapshot');
   const serializer=new XMLSerializer();
   zip.file('word/document.xml',serializer.serializeToString(doc));
   zip.file('word/_rels/document.xml.rels',serializer.serializeToString(rels));
   zip.remove('customXml/sop-project.xml');
   const native=await SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'}));
   SOP.replaceProject(native);
   await SOP.prepareImages();
   SOP.setSelected(SOP.project.pages[1].id);
  });
  const nativeProof=await downloadProof();
  const native=await Zip.loadAsync(nativeProof.bytes);
  const nativeDoc=await readProof(native);
  assert.match(nativeDoc,/w:name="currentProofBookmark"/);
  const media=Object.keys(native.files).filter(name=>/^sop-import\/word\/media\/[^/]+$/.test(name));
  assert.equal(media.length,1);
  assert.equal(await native.file(media[0]).async('base64'),info.photo);
  assert(!Object.keys(native.files).some(name=>/embeddings|customXml|sop-import\/docProps/.test(name)));
  const rels=await native.file('word/_rels/document.xml.rels').async('string');
  assert(!rels.includes('rIdUnrelatedAttachment'));
  assert.deepEqual(errors,[]);

  if(process.env.SOP_PROOF_QA_OUTPUT){
   await fs.mkdir(process.env.SOP_PROOF_QA_OUTPUT,{recursive:true});
   await fs.writeFile(path.join(process.env.SOP_PROOF_QA_OUTPUT,'current-generated.docx'),browserProof.bytes);
   await fs.writeFile(path.join(process.env.SOP_PROOF_QA_OUTPUT,'current-native.docx'),nativeProof.bytes);
  }
  console.log('PASS: current proof, isolated preflight, native bookmarks/media, no full snapshot, stable page numbers and selection cancellation');
 }finally{
  if(browser)await browser.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
