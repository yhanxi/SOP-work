'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=spawn(process.execPath,[path.join(root,'scripts/serve.cjs'),'--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','inherit']});
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
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.SOP&&!document.querySelector('#saveBtn').disabled);

  const fixture=await page.evaluate(async()=>{
   const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const a='http://schemas.openxmlformats.org/drawingml/2006/main';
   const parse=text=>new DOMParser().parseFromString(text,'application/xml');
   const serialize=node=>new XMLSerializer().serializeToString(node);
   const add=(document,xml)=>document.importNode(parse(xml).documentElement,true);
   const zip=await JSZip.loadAsync(SOP_ASSETS.template,{base64:true});
   const doc=parse(await zip.file('word/document.xml').async('string'));
   const body=doc.getElementsByTagNameNS(w,'body')[0];
   const table=[...body.children].filter(node=>node.localName==='tbl').at(-1);
   const row=table.getElementsByTagNameNS(w,'tr')[3];
   const op=row.getElementsByTagNameNS(w,'tc')[2];
   for(const child of [...op.children])if(child.localName!=='tcPr')child.remove();
   const paras=[
    '<w:r><w:t>一、操作步骤：</w:t></w:r>',
    '<w:pPr><w:pStyle w:val="QaParagraph"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="黑体"/><w:b/><w:sz w:val="27"/><w:spacing w:val="16"/></w:rPr><w:t>检验标记甲Mix7</w:t></w:r><w:r><w:rPr><w:rStyle w:val="QaItalic"/></w:rPr><w:t>Alpha9</w:t></w:r>',
    '<w:r><w:t>二、工艺技术要求：</w:t></w:r>',
    '<w:pPr><w:pStyle w:val="QaParagraph"/></w:pPr><w:r><w:t>复核标记乙</w:t></w:r>',
   ];
   for(const content of paras)op.append(add(doc,'<w:p xmlns:w="'+w+'">'+content+'</w:p>'));
   zip.file('word/document.xml',serialize(doc));
   const styles=parse(await zip.file('word/styles.xml').async('string'));
   const defaults=styles.getElementsByTagNameNS(w,'rPrDefault')[0];
   defaults.replaceChildren(add(styles,'<w:rPr xmlns:w="'+w+'"><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/><w:spacing w:val="8"/></w:rPr>'));
   const syntheticStyles=[
    '<w:style w:type="paragraph" w:styleId="QaBase"><w:name w:val="QA Base"/><w:pPr><w:spacing w:before="120" w:after="140" w:line="320" w:lineRule="exact"/></w:pPr><w:rPr><w:color w:val="111111" w:themeColor="accent1"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="QaParagraph"><w:name w:val="QA Paragraph"/><w:basedOn w:val="QaBase"/></w:style>',
    '<w:style w:type="character" w:styleId="QaItalic"><w:name w:val="QA Italic"/><w:rPr><w:rFonts w:ascii="Courier New"/><w:i/><w:color w:val="c00000"/><w:highlight w:val="yellow"/><w:sz w:val="18"/></w:rPr></w:style>',
   ];
   for(const style of syntheticStyles)styles.documentElement.append(add(styles,style.replace('<w:style','<w:style xmlns:w="'+w+'"')));
   zip.file('word/styles.xml',serialize(styles));
   const theme=parse(await zip.file('word/theme/theme1.xml').async('string'));
   theme.getElementsByTagNameNS(a,'accent1')[0].firstElementChild.setAttribute('val','2468AD');
   zip.file('word/theme/theme1.xml',serialize(theme));
   return Array.from(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  });

  await page.locator('#importFile').setInputFiles({name:'混排样本.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(fixture)});
  await page.waitForFunction(()=>document.querySelector('#previewStage .imported-body')?.textContent.includes('Alpha9'));
  const css=token=>page.evaluate(value=>{
   const leaf=[...document.querySelectorAll('#previewStage .imported-body span')].find(span=>!span.children.length&&span.textContent===value);
   const run=getComputedStyle(leaf),p=getComputedStyle(leaf.closest('p'));
   return {font:run.fontFamily,size:parseFloat(run.fontSize),tracking:parseFloat(run.letterSpacing),weight:run.fontWeight,italic:run.fontStyle,color:run.color,highlight:getComputedStyle(leaf.parentElement).backgroundColor,line:parseFloat(p.lineHeight),before:parseFloat(p.marginTop),after:parseFloat(p.marginBottom)};
  },token);
  const near=(actual,expected)=>assert(Math.abs(actual-expected)<.01,`${actual} differs from ${expected}`);
  const chinese=await css('检验标记甲'),english=await css('Mix7'),italic=await css('Alpha9'),inherited=await css('复核标记乙');
  assert.equal(chinese.font,'黑体');assert.equal(english.font,'Arial');assert.equal(chinese.weight,'700');
  near(chinese.size,18);near(chinese.tracking,16/15);near(chinese.line,320/15);near(chinese.before,8);near(chinese.after,140/15);
  assert.equal(chinese.color,'rgb(36, 104, 173)');
  assert.equal(italic.font,'"Courier New"');assert.equal(italic.italic,'italic');near(italic.size,12);
  assert.equal(italic.color,'rgb(192, 0, 0)');assert.equal(italic.highlight,'rgb(255, 255, 0)');
  assert.equal(inherited.font,'宋体');near(inherited.size,22*2/3);near(inherited.tracking,8/15);

  async function downloadFormat(edited){
   const received=page.waitForEvent('download');
   await page.locator('#docxBtn').click();
   const bytes=await fs.readFile(await (await received).path());
   return page.evaluate(async({bytes,edited})=>{
    const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const parse=text=>new DOMParser().parseFromString(text,'application/xml');
    const attr=(node,name)=>node?.getAttributeNS(w,name);
    const find=(node,name)=>node.getElementsByTagNameNS(w,name)[0];
    const zip=await JSZip.loadAsync(new Uint8Array(bytes));
    const doc=parse(await zip.file('word/document.xml').async('string'));
    const styles=parse(await zip.file('word/styles.xml').async('string'));
    const runs=[...doc.getElementsByTagNameNS(w,'r')],findRun=text=>runs.find(run=>find(run,'t')?.textContent===text);
    const direct=findRun('检验标记甲Mix7'),italic=findRun('Alpha9'),requirement=findRun(edited?'复核标记丙':'复核标记乙');
    const stylesById=new Map([...styles.getElementsByTagNameNS(w,'style')].map(style=>[attr(style,'styleId'),style]));
    const pStyle=stylesById.get(attr(find(requirement.parentElement,'pStyle'),'val'));
    const base=stylesById.get(attr(find(pStyle,'basedOn'),'val'));
    const defaults=stylesById.get(attr(find(base,'basedOn'),'val'));
    const italicStyle=stylesById.get(attr(find(italic,'rStyle'),'val'));
    const spacing=find(base,'spacing');
    return {size:attr(find(direct,'sz'),'val'),tracking:attr(find(direct,'spacing'),'val'),east:attr(find(direct,'rFonts'),'eastAsia'),latin:attr(find(direct,'rFonts'),'ascii'),bold:!!find(direct,'b'),italic:!!find(italicStyle,'i'),color:attr(find(italicStyle,'color'),'val'),highlight:attr(find(italicStyle,'highlight'),'val'),themeColor:attr(find(base,'color'),'val'),defaults:[attr(find(defaults,'rFonts'),'eastAsia'),attr(find(defaults,'sz'),'val'),attr(find(defaults,'spacing'),'val')],paragraph:['before','after','line','lineRule'].map(key=>attr(spacing,key)),text:find(requirement,'t').textContent};
   },{bytes:Array.from(bytes),edited});
  }
  const direct=await downloadFormat(false);
  assert.deepEqual(direct,{size:'27',tracking:'16',east:'黑体',latin:'Arial',bold:true,italic:true,color:'c00000',highlight:'yellow',themeColor:'2468AD',defaults:['宋体','22','8'],paragraph:['120','140','320','exact'],text:'复核标记乙'});
  await page.locator('#requirementsInput').fill('复核标记丙');
  await page.waitForFunction(()=>document.querySelector('#previewStage .imported-body')?.textContent.includes('复核标记丙'));
  assert.deepEqual(await css('检验标记甲'),chinese);
  assert.deepEqual(await css('Alpha9'),italic);
  assert.deepEqual(await css('复核标记丙'),inherited);
  assert.deepEqual(await downloadFormat(true),{...direct,text:'复核标记丙'});
  assert.deepEqual(errors,[]);
  console.log('PASS: raw DOCX import, Chinese/Western fonts, inherited/direct styles, and native-format edit/export');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
