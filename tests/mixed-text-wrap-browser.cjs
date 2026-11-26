'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path');
const {chromium}=require(process.env.SOP_PLAYWRIGHT_MODULE||'playwright');

async function main(){
 const server=spawn(process.execPath,['scripts/serve.cjs','--port','0'],{cwd:path.resolve(__dirname,'..'),windowsHide:true});
 let browser;
 try{
  const [address]=await once(server.stdout,'data');
  browser=await chromium.launch({headless:true,executablePath:process.env.SOP_TEST_BROWSER});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(JSON.parse(address).url);
  await page.waitForFunction(()=>window.SOP&&!document.querySelector('#saveBtn').disabled);
  const model='HRBH258UUT1P5';
  const mixed='1. 在夹取电机齿轮箱的外齿轮和齿轮箱法兰上打润油脂后，将交叉滚子轴承'+model;
  const result=await page.evaluate(async({model,mixed})=>{
   const p=SOP.blankPage();
   p.steps=[mixed,'工'.repeat(37)+'，备注','工'.repeat(36)+'（检查）'].join('\n');
   p.requirements=mixed;
   p.contentStyle={fontSize:12.5,letterSpacing:0};
   p.stepsTextColors=[[mixed.indexOf(model)+2,mixed.indexOf(model)+7,'#c00000']];
   SOP.replaceProject({...SOP.clone(SOP.project),pages:[p]});
   const lines=paragraph=>{
    const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT),range=document.createRange(),rows=[];
    let top;
    for(let node=walker.nextNode();node;node=walker.nextNode()){
     for(let i=0;i<node.length;i++){
      range.setStart(node,i);range.setEnd(node,i+1);
      const rect=range.getBoundingClientRect();
      if(rect.top!==top){rows.push('');top=rect.top;}
      rows[rows.length-1]+=node.data[i];
     }
    }
    return rows;
   };
   const steps=[...document.querySelectorAll('#previewStage [data-text-section="steps"]')];
   const requirement=document.querySelector('#previewStage [data-text-section="requirements"]');
   const selection=getSelection(),range=document.createRange();
   range.selectNodeContents(steps[0]);selection.removeAllRanges();selection.addRange(range);
   const copied=selection.toString();selection.removeAllRanges();
   const plain={...p,steps:'',requirements:''};
   const longText='工'.repeat(34)+model+'工'.repeat(32);
   const measured=SOP.operationBodySpace(plain).pixels-SOP.operationBodySpace({...plain,steps:longText}).pixels;
   const lineHeight=parseFloat(getComputedStyle(steps[0]).lineHeight);
   const blob=await SOP_WORD.exportDocx(SOP.project,SOP.layout,SOP.front);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer());
   const doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
   const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const read=(node,name)=>node.getElementsByTagNameNS(W,name)[0];
   const word=[...doc.getElementsByTagNameNS(W,'p')].filter(node=>node.textContent===mixed).map(node=>({
    wordWrap:read(node,'wordWrap')?.getAttributeNS(W,'val'),kinsoku:read(node,'kinsoku')?.getAttributeNS(W,'val'),
    hardBreak:!!read(node,'br'),color:read(node,'color')?.getAttributeNS(W,'val')||null,
   }));
   const preview={steps:steps.map(lines),requirement:lines(requirement)};
   const snapshot=(await SOP_WORD.importDocx(await blob.arrayBuffer())).pages[0];
   zip.remove('customXml/sop-project.xml');
   const raw=await SOP_WORD.importDocx(await zip.generateAsync({type:'arraybuffer'}));
   SOP.replaceProject(raw);
   const imported=[...document.querySelectorAll('#previewStage .imported-body p')].filter(node=>node.textContent===mixed);
   return {...preview,copied,word,measured,lineHeight,imported:imported.map(lines),snapshot:[snapshot.steps,snapshot.requirements],sourceSteps:p.steps};
  },{model,mixed});
  assert.equal(result.imported.length,2);
  for(const lines of [result.steps[0],result.requirement,...result.imported]){
   assert.equal(lines.length,2);
   assert.equal(lines.join(''),mixed);
   assert(lines[0].length>mixed.indexOf(model)&&lines[0].length<mixed.length,lines.join(' | '));
  }
  assert.equal(result.steps[1].length,2);
  assert(!result.steps[1][1].startsWith('，'),'A Chinese comma must stay with the preceding character');
  assert.equal(result.steps[2].length,2);
  assert(!result.steps[2][0].endsWith('（'),'A Chinese opening parenthesis must stay with the following character');
  assert.equal(result.copied,mixed);
  assert(Math.abs(result.measured-2*result.lineHeight-2)<.1,`Unexpected measured height ${result.measured}`);
  assert.deepEqual(result.word,[{wordWrap:'0',kinsoku:'1',hardBreak:false,color:'C00000'},{wordWrap:'0',kinsoku:'1',hardBreak:false,color:null}]);
  assert.deepEqual(result.snapshot,[result.sourceSteps,mixed]);
  console.log('PASS: mixed operation text wraps at character boundaries in preview, measurement and editable Word');
 }finally{
  await browser?.close();
  server.kill();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
