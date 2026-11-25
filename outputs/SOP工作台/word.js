(() => {
'use strict';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',P='http://schemas.openxmlformats.org/package/2006/relationships',CT='http://schemas.openxmlformats.org/package/2006/content-types';
const xml=s=>new DOMParser().parseFromString(s,'application/xml'),serialize=d=>new XMLSerializer().serializeToString(d);
const children=(e,n)=>[...e.children].filter(x=>x.localName===n),first=(e,n)=>children(e,n)[0],desc=(e,n)=>[...e.getElementsByTagNameNS(W,n)],txt=(e,includeDrawings=false)=>{if(!e)return '';let out='';const walk=n=>{if(n.nodeType!==1)return;if(n.namespaceURI===W&&n.localName==='t'){out+=n.textContent;return;}if(n.namespaceURI===W&&['br','cr','tab'].includes(n.localName)){out+=n.localName==='tab'?'\t':'\n';return;}if(n.localName==='AlternateContent'){const chosen=[...n.children].find(c=>c.localName==='Choice')||[...n.children].find(c=>c.localName==='Fallback');if(chosen)walk(chosen);return;}if(!includeDrawings&&['drawing','pict'].includes(n.localName))return;for(const c of n.children)walk(c);if(n.namespaceURI===W&&n.localName==='p'&&!out.endsWith('\n'))out+='\n';};walk(e);return out.replace(/\n+$/,'');};
const cell=(t,r,c)=>children(children(t,'tr')[r],'tc')[c],cells=r=>children(r,'tc');
function el(doc,name,attrs={}){const e=doc.createElementNS(W,'w:'+name);for(const [k,v]of Object.entries(attrs))e.setAttributeNS(W,'w:'+k,String(v));return e;}
function run(doc,text,size=21){const r=el(doc,'r'),pr=el(doc,'rPr');pr.append(el(doc,'rFonts',{ascii:'宋体',hAnsi:'宋体',eastAsia:'宋体'}),el(doc,'snapToGrid',{val:0}),el(doc,'sz',{val:size}),el(doc,'szCs',{val:size}));r.append(pr);String(text??'').split('\n').forEach((line,i)=>{if(i)r.append(el(doc,'br'));const t=el(doc,'t');t.setAttribute('xml:space','preserve');t.textContent=line;r.append(t);});return r;}
function para(doc,text='',size=21,center=false){const p=el(doc,'p'),pr=el(doc,'pPr');pr.append(el(doc,'snapToGrid',{val:0}),el(doc,'spacing',{before:0,after:30,line:280,lineRule:'auto'}));if(center)pr.append(el(doc,'jc',{val:'center'}));p.append(pr,run(doc,text,size));return p;}
const {operationText,dimensions:operationDimensions}=window.SOP_TEMPLATE;
const fullWidthText=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u;
const halfWidthEastAsian=/[\uff61-\uffdc]/u;
const compressiblePunctuation=/[\u3001\u3002\u3008-\u3011\u3014-\u301f\uff01\uff08\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\uff3b\uff3d\uff5b\uff5d]/u;
function operationRuns(runs){
 return runs.flatMap(({text,...style})=>{
  const segments=[];
  for(const character of text){
   const kind=compressiblePunctuation.test(character)?'punctuation':fullWidthText.test(character)&&!halfWidthEastAsian.test(character)?'fullWidth':'default';
   const last=segments.at(-1);
   if(kind!=='punctuation'&&last?.kind===kind)last.text+=character;
   else segments.push({...style,text:character,kind});
  }
  return segments;
 });
}
function exactParagraphSpacing(doc,p,line,after=0){
 first(first(p,'pPr'),'spacing').replaceWith(el(doc,'spacing',{before:0,after,line,lineRule:'exact'}));
}
function bodyParagraph(doc,runs,page,key,nextFitId){
 const f=window.SOP.textStyle(page,key),size=Math.round(f.fontSize*2),p=para(doc,'',size),pr=first(p,'pPr');
 first(p,'r').remove();
 // Match the workbench's text spacing, including mixed Chinese and Latin text.
 pr.prepend(el(doc,'overflowPunct',{val:0}),el(doc,'autoSpaceDE',{val:0}),el(doc,'autoSpaceDN',{val:0}),el(doc,'adjustRightInd',{val:0}));
 exactParagraphSpacing(doc,p,Math.round(f.fontSize*operationText.lineHeight*20),operationText.paragraphAfter);
 pr.append(el(doc,'contextualSpacing',{val:0}),el(doc,'jc',{val:'left'}));
 for(const segment of operationRuns(runs)){
  const r=run(doc,segment.text,size),style=first(r,'rPr');
  // The reference keeps half/full-width balance for its labels and imported originals.
  // Word and WPS double tracking on generated full-width runs with that option enabled.
  if(segment.kind!=='default')style.prepend(el(doc,'rStyle',{val:operationText.fullWidthStyleId}));
  style.append(el(doc,'spacing',{val:Math.round(f.letterSpacing*(segment.kind==='default'?20:10))}));
  if(segment.kind==='punctuation')style.append(el(doc,'fitText',{val:Math.round((f.fontSize+f.letterSpacing)*20),id:nextFitId()}));
  if(segment.color)style.append(el(doc,'color',{val:segment.color.slice(1).toUpperCase()}));
  if(segment.background==='#ffff00')style.append(el(doc,'highlight',{val:'yellow'}));
  else if(segment.background)style.append(el(doc,'shd',{val:'clear',color:'auto',fill:segment.background.slice(1).toUpperCase()}));
  p.append(r);
 }
 return p;
}
function operationHeading(doc,text){
 const {headingSize,lineHeight}=operationText,p=para(doc,text,headingSize*2);
 exactParagraphSpacing(doc,p,Math.round(headingSize*lineHeight*20),operationText.headingAfter);
 return p;
}
function operationRequirementBlocks(doc,page,nextFitId){
 const lines=window.SOP.bodyLines(page,'requirements');
 if(!lines.length)return [];
 return [operationHeading(doc,'二、工艺技术要求：'),...lines.map(line=>bodyParagraph(doc,line,page,'requirements',nextFitId))];
}
const cleanHeaderText=text=>String(text??'').replace(/[\t\r\n]+/g,' ').trim();
function setCell(c,s,size=19){const doc=c.ownerDocument;for(const child of [...c.children])if(child.localName!=='tcPr')c.removeChild(child);c.append(para(doc,s,size));}
function centerExisting(c){let pr=first(c,'tcPr');if(!pr){pr=el(c.ownerDocument,'tcPr');c.prepend(pr);}for(const x of children(pr,'vAlign'))x.remove();pr.append(el(c.ownerDocument,'vAlign',{val:'center'}));for(const paragraph of children(c,'p')){let pp=first(paragraph,'pPr');if(!pp){pp=el(c.ownerDocument,'pPr');paragraph.prepend(pp);}for(const x of [...children(pp,'jc'),...children(pp,'ind'),...children(pp,'spacing')])x.remove();pp.append(el(c.ownerDocument,'jc',{val:'center'}),el(c.ownerDocument,'ind',{left:0,right:0,firstLine:0}),el(c.ownerDocument,'spacing',{before:0,after:0,line:280,lineRule:'auto'}));}}
function centerCell(c,s,size=19){setCell(c,s,size);centerExisting(c);}
function mergeFlowTitle(t,title){const row=children(t,'tr')[0],cs=cells(row);if(!cs.length)return;const c=cs[0],doc=c.ownerDocument,width=cs.reduce((sum,c)=>sum+Number(first(first(c,'tcPr'),'tcW')?.getAttributeNS(W,'w')||0),0),span=cs.reduce((sum,c)=>sum+Number(first(first(c,'tcPr'),'gridSpan')?.getAttributeNS(W,'val')||1),0);for(const other of cs.slice(1))other.remove();const pr=first(c,'tcPr');for(const node of [...children(pr,'tcW'),...children(pr,'gridSpan')])node.remove();pr.prepend(el(doc,'tcW',{w:width,type:'dxa'}),el(doc,'gridSpan',{val:span}));centerCell(c,title,26);}
function flowNoteText(project){if(project.frontContent?.flowNote!==undefined)return String(project.frontContent.flowNote);if(project.originalFront?.flow){const d=xml('<root>'+project.originalFront.flow.blocks.map(b=>b.xml).join('')+'</root>'),t=desc(d,'tbl')[0];if(t){const rows=children(t,'tr');return txt(cells(rows.at(-1))[0]);}}return window.SOP_REFERENCE?.defaults?.flowNote||'注：□表示一般操作，◇表示检查及测试。★代表关键工序，▲代表特殊工序';}
function base64Utf8(s){const bytes=new TextEncoder().encode(s);let b='';for(let i=0;i<bytes.length;i+=32768)b+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(b);}
function fromBase64(s){return new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));}
async function hashText(s){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function imageSize(data){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve([im.naturalWidth,im.naturalHeight]);im.onerror=reject;im.src=data;});}

function fillParagraph(p,value){
 const doc=p.ownerDocument,pr=first(p,'pPr'),style=first(first(p,'r')||pr||p,'rPr')||first(pr||p,'rPr');
 const replacement=run(doc,value);
 if(style)first(replacement,'rPr').replaceWith(style.cloneNode(true));
 for(const child of [...p.children])if(child!==pr)child.remove();
 p.append(replacement);
 return replacement;
}
function fillCell(c,value){
 const p=first(c,'p');
 fillParagraph(p,value);
 for(const other of children(c,'p').slice(1))other.remove();
}
const populated=record=>Object.values(record||{}).some(value=>String(value??'').trim());
const revisionRecords=p=>p.changeRecords||[p.changeRecord];
const historyFields=['date','number','version','summary','author','reviewer','approver'];
const materialFields=['name','spec','qty'];
const checkFields=['feature','standard','self','audit','importance','method'];
const revisionFields=['number','mark','count','document','signature'];
const coverSignerFields={批准:['approver','approverSignature'],质量会签:['qualitySigner','qualitySignature'],生产会签:['productionSigner','productionSignature'],审核:['reviewer','reviewerSignature'],制定:['author','authorSignature']};
function coverSignatureParagraph(p,label,meta,native){
 const doc=p.ownerDocument,pr=first(p,'pPr');
 const [labelWidth,gap,nameWidth,signLabelWidth,signWidth]=[20,1,27,14,29].map(mm=>Math.round(mm*1440/25.4));
 const left=5720,nameStart=left+labelWidth+gap,signLabelStart=nameStart+nameWidth+gap,signStart=signLabelStart+signLabelWidth+gap;
 const spacing=first(pr,'spacing'),indent=first(pr,'ind'),tabs=el(doc,'tabs');
 tabs.append(...[[nameStart,nameWidth],[signLabelStart,signLabelWidth],[signStart,signWidth]].map(([start,width])=>el(doc,'tab',{val:'center',pos:Math.round(start+width/2)})));
 pr.insertBefore(tabs,spacing);
 indent.removeAttributeNS(W,'firstLineChars');
 indent.removeAttributeNS(W,'firstLine');
 indent.setAttributeNS(W,'w:left',left);
 first(pr,'jc').setAttributeNS(W,'w:val','left');
 const labelText=label.length===2?[...label].join('　'):label;
 const [name,signature]=coverSignerFields[label];
 fillParagraph(p,labelText+'：');
 for(const value of [meta[name],'签字：',meta[signature]]){
  const field=run(doc,cleanHeaderText(value),22);
  first(field,'t').before(el(doc,'tab'));
  p.append(field);
 }
 // Anchor each rule to its own paragraph inside the original cover cell.
 const ruleY=26.6;
 for(const [i,[start,width]]of [[nameStart,nameWidth],[signStart,signWidth]].entries()){
  const rule=native.nativeShape({name:'封面'+label+(i===0?'姓名线':'签字线'),x:start/20,y:ruleY,width:width/20,height:.01,geometry:'line',stroke:'111111',lineWidth:.5,connector:true});
  rule.firstElementChild.firstElementChild.setAttribute('behindDoc','1');
  p.append(rule);
 }
}
function referenceCover(t,project,native){
 const ps=desc(t,'p'),c=project.frontContent||{},m=coverValues(project);
 fillParagraph(ps[1],c.coverHeading??'三阶文件');
 fillParagraph(ps[2],project.settings.company);
 const info=[m.number,[m.product,m.title].filter(Boolean).join(' '),m.bare,m.packed,m.version,m.date];
 for(const [i,value]of info.entries())fillParagraph(ps[i+3],txt(ps[i+3]).replace('[[VALUE]]',()=>value||''));
 for(const [i,label]of Object.keys(coverSignerFields).entries())coverSignatureParagraph(ps[i+9],label,m,native);
}
function coverSignerParagraph(p){
 const parts=txt(p).split('\t'),label=parts[0].replace(/[\s：:]/g,'');
 if(parts.length===4&&Object.hasOwn(coverSignerFields,label)&&/^签字[：:]$/.test(parts[2].trim()))return {label,name:parts[1].trim(),signature:parts[3].trim()};
}
function fillCoverSignerName(p,value){
 const [start,end]=desc(p,'tab').filter(node=>node.parentElement.localName==='r');
 const texts=desc(p,'t').filter(text=>(start.compareDocumentPosition(text)&Node.DOCUMENT_POSITION_FOLLOWING)&&(text.compareDocumentPosition(end)&Node.DOCUMENT_POSITION_FOLLOWING));
 if(!texts.length){
  const text=el(p.ownerDocument,'t');
  start.after(text);
  texts.push(text);
 }
 texts.forEach((text,i)=>{text.setAttribute('xml:space','preserve');text.textContent=i===0?cleanHeaderText(value):'';});
}
function coverSignerCells(row){
 if(row?.localName!=='tr')return;
 const cs=cells(row),label=txt(cs[1]).replace(/[\s：:]/g,'');
 if(cs.length===8&&Object.hasOwn(coverSignerFields,label)&&/^签字[：:]$/.test(txt(cs[5]).trim()))return {label,name:cs[3],signature:cs[7]};
}
function readCoverValues(table){
 const result={};
 for(const p of desc(table,'p')){
  if(coverSignerCells(p.parentElement?.parentElement))continue;
  const signer=coverSignerParagraph(p);
  if(signer){const [name,signature]=coverSignerFields[signer.label];result[name]=signer.name;result[signature]=signer.signature;continue;}
  const m=txt(p).match(/^([^：:]+)[：:](.*)$/s);if(!m)continue;
  const key=m[1].replace(/\s/g,''),value=m[2].trim();
  const field={文件编号:'number',裸机成品料号:'bare',包装成品料号:'packed',版本:'version',生效日期:'date'}[key];
  if(field)result[field]=value;
  if(Object.hasOwn(coverSignerFields,key)){
   const [name,signature]=value.split(/\s*签字[：:]\s*/);
   result[coverSignerFields[key][0]]=name.trim();
   result[coverSignerFields[key][1]]=signature?.trim()||'';
  }
 }
 for(const row of desc(table,'tr')){
  const fields=coverSignerCells(row);
  if(!fields)continue;
  const [name,signature]=coverSignerFields[fields.label];
  result[name]=txt(fields.name).trim();
  result[signature]=txt(fields.signature).trim();
 }
 return result;
}
function coverValues(project){
 const cover=project.originalFront?.cover;
 if(!cover||project.frontContent?.coverMode==='editable')return project.meta;
 const d=xml('<root>'+cover.blocks.map(b=>b.xml).join('')+'</root>'),t=desc(d,'tbl')[0];
 if(!t)return project.meta;
 const result={...project.meta};
 for(const [key,value]of Object.entries(readCoverValues(t)))if(!result[key]&&result[key]===cover.metaBaseline?.[key])result[key]=value;
 return result;
}
function orderedExportPages(project,layout,front){
 if(project===window.SOP.project&&layout===window.SOP.layout&&front===window.SOP.front)return window.SOP.orderedPages();
 const entries=[...front.map(page=>({kind:page.kind,key:'front:'+page.kind+':'+(page.chunk||0),page})),...layout.map(page=>({kind:'body',key:'body:'+page.sourceId+':'+page.fragment,page}))],remaining=new Map(entries.map(x=>[x.key,x]));
 const ordered=[];
 for(const key of project.pageOrder||[])if(remaining.has(key)){ordered.push(remaining.get(key));remaining.delete(key);}
 for(const entry of entries)if(remaining.delete(entry.key)){
  const previous=entries.slice(0,entries.indexOf(entry)).reverse().find(x=>x.kind===entry.kind&&ordered.some(page=>page.key===x.key));
  if(previous&&(entry.kind==='body'||entry.page.chunk))ordered.splice(ordered.findIndex(x=>x.key===previous.key)+1,0,entry);
  else ordered.push(entry);
 }
 return ordered;
}

async function exportDocx(project,layout,front,proofKey){
 const documentPages=orderedExportPages(project,layout,front);
 const proof=proofKey?documentPages.find(entry=>entry.kind==='body'&&entry.key===proofKey):null;
 if(proofKey&&!proof)throw Error('当前工序已变化，请重新选择校样页。');
 const ordered=proof?[proof]:documentPages;
 const source=proof?project.pages.find(p=>p.id===proof.page.sourceId):null;
 await window.SOP_IMPORT.refreshBody(proof?{...project,pages:source?[source]:[]}:project);
 if(!ordered.length)throw Error('请先添加至少一张页面。');
 if(ordered.some(entry=>entry.kind==='history')&&project.history.slice(15).some(populated))throw Error('修改履历超过模板的 15 条记录。');
 for(const {page:p,kind}of ordered)if(kind==='body'){
  const fields=[[p.materials,6,'物料'],[p.checks,2,'检验'],[revisionRecords(p),2,'更改记录']];
  const overflow=fields.find(([records,max])=>records.slice(max).some(populated));
  if(overflow)throw Error(`工序第 ${p.pageNo} 页「${p.name||'未命名工序'}」的${overflow[2]}超过模板的 ${overflow[1]} 条，请拆分工序。`);
 }

 const z=await JSZip.loadAsync(window.SOP_ASSETS.template,{base64:true});
 const d=xml(await z.file('word/document.xml').async('string')),body=desc(d,'body')[0];
 const [cover,history,flow,base]=children(body,'tbl');
 const [coverBreak,historyTitle,historyBreak,flowBreak,operationEnd]=children(body,'p');
 const section=first(body,'sectPr'),rels=xml(await z.file('word/_rels/document.xml.rels').async('string')),ct=xml(await z.file('[Content_Types].xml').async('string'));
 const proofBlocks=proof?window.SOP_IMPORT.bodyBlocks(proof.page):null;
 const importNodes=await window.SOP_IMPORT.exporter(proof&&!proofBlocks?null:project.nativeWord,z,rels,ct,d,proof?proofBlocks:undefined);
 const twips=(node,key)=>Number(node?.getAttributeNS(W,key)||0);
 const tableCellWidth=(t,c)=>{
  const margins=first(first(c,'tcPr'),'tcMar')||first(first(t,'tblPr'),'tblCellMar');
  return (twips(first(first(c,'tcPr'),'tcW'),'w')-twips(first(margins,'left'),'w')-twips(first(margins,'right'),'w'))/20;
 };
 const contentWidth=operationDimensions.operationContentWidthTwips/20;
 let imageN=0,pictureN=0,drawingN=16002,fitTextN=0;
 const nextFitId=()=>++fitTextN;
 const mediaByData=new Map();
 const native=window.SOP_NATIVE.create(d,{nextId:()=>++drawingN,paragraph:para});
 async function pictureMedia(source){
  const existing=mediaByData.get(source);
  if(existing)return existing;
  let data=source;
  const jpeg=data.startsWith('data:image/jpeg'),ext=jpeg?'jpeg':'png';
  if(!jpeg&&!data.startsWith('data:image/png')){
   const im=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('无法读取作业图片，请替换后重试。'));im.src=data;});
   const canvas=document.createElement('canvas');canvas.width=im.width;canvas.height=im.height;canvas.getContext('2d').drawImage(im,0,0);data=canvas.toDataURL('image/png');
  }
  const [width,height]=await imageSize(data);
  const name='sop-image-'+(++imageN)+'.'+ext;
  z.file('word/media/'+name,data.split(',')[1],{base64:true});
  if(![...ct.documentElement.children].some(e=>e.getAttribute('Extension')===ext)){
   const type=ct.createElementNS(CT,'Default');type.setAttribute('Extension',ext);type.setAttribute('ContentType',jpeg?'image/jpeg':'image/png');ct.documentElement.append(type);
  }
  const media={name,width,height};
  mediaByData.set(source,media);
  return media;
 }
 async function picture(data,widthPt,heightPt,label){
  const {name,width:w,height:h}=await pictureMedia(data);
  const scale=Math.min(widthPt/w,heightPt/h),cx=Math.round(w*scale*12700),cy=Math.round(h*scale*12700),id=++drawingN;
  const pictureIndex=++pictureN,rid='rIdSopImage'+pictureIndex;
  const rel=rels.createElementNS(P,'Relationship');rel.setAttribute('Id',rid);rel.setAttribute('Type',R+'/image');rel.setAttribute('Target','media/'+name);rels.documentElement.append(rel);
  const p=xml(`<w:r xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="SOP配图${pictureIndex}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="SOP配图${pictureIndex}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`).documentElement;
  const dp=p.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')[0];dp.setAttribute('descr',String(label||'作业图片'));return d.importNode(p,true);
 }
 function drawingParagraph(height){
  const p=para(d,'',2);
  exactParagraphSpacing(d,p,Math.max(20,Math.round(height*20)));
  return p;
 }
 function anchorPicture(r,x,y,width,height){
  const ns='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const inline=r.getElementsByTagNameNS(ns,'inline')[0];
  const wp=(name,attrs={})=>{const e=d.createElementNS(ns,'wp:'+name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
  const anchor=wp('anchor',{distT:0,distB:0,distL:0,distR:0,simplePos:0,relativeHeight:++drawingN,behindDoc:0,locked:0,layoutInCell:1,allowOverlap:1});
  anchor.append(wp('simplePos',{x:0,y:0}));
  for(const [dir,relativeFrom,position]of [['H','column',x],['V','paragraph',y]]){
   const node=wp('position'+dir,{relativeFrom}),offset=wp('posOffset');
   offset.textContent=Math.round(position*12700);
   node.append(offset);anchor.append(node);
  }
  if(width!==undefined){
   const extent=inline.getElementsByTagNameNS(ns,'extent')[0];
   for(const node of [extent,...inline.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','ext')]){
    node.setAttribute('cx',Math.round(width*12700));node.setAttribute('cy',Math.round(height*12700));
   }
  }
  for(const child of [...inline.children]){
   if(child.localName==='docPr')anchor.append(wp('wrapNone'));
   anchor.append(child);
  }
  inline.replaceWith(anchor);
  return r;
 }
 async function canvasParagraph(model,width,availableHeightPt){
  const m=window.SOP_OBJECTS.normalize(model),scale=width/m.width;
  const pp=drawingParagraph(Number.isFinite(availableHeightPt)?availableHeightPt:window.SOP_OBJECTS.contentHeight(m)*scale);
  for(const o of m.objects){const x=o.x*scale,y=o.y*scale,w=o.w*scale,h=o.h*scale;
   if(o.type==='photo'){
    const r=await picture(o.data,w,h,'画布独立照片');
    pp.append(anchorPicture(r,x,y,w,h),...native.photoMarks(o,x,y,w,h));
    if(o.caption){
     const lines=window.SOP_OBJECTS.wrapText(o.caption,o.w,14);
     // The SVG hanging baseline starts slightly above the top of a Word text paragraph.
     pp.append(native.nativeShape({name:'画布图片说明 '+o.id,x,y:y+h-1.5*scale,width:w,height:17*scale*lines.length,text:lines.join('\n'),stroke:null,fontSize:14*scale,
      textLayout:{fontFamily:'宋体',lineHeight:17*scale,leftInset:0,rightInset:0,anchor:'t'}}));
    }
   }else pp.append(native.canvasShape(o,scale));
  }return pp;
 }
 async function photoParagraph({items,height}){
  const p=drawingParagraph(height);
  for(const {photo,image,caption}of items){
   const r=await picture(photo.data,image.width,image.height,photo.caption);
   const extent=r.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0];
   const width=Number(extent.getAttribute('cx'))/12700,height=Number(extent.getAttribute('cy'))/12700;
   const x=image.x+(image.width-width)/2,y=image.y+(image.height-height)/2;
   p.append(anchorPicture(r,x,y),...native.photoMarks(photo,x,y,width,height));
   if(caption?.text){
    const {x,y,width,height,text,fontSize,lineHeight}=caption;
    p.append(native.nativeShape({name:'作业配图说明',x,y,width,height,text,fontSize,stroke:null,textLayout:{fontFamily:'宋体',lineHeight,leftInset:0,rightInset:0,anchor:'t'}}));
   }
  }
  return p;
 }
 async function logo(t){
  const drawing=desc(t,'drawing')[0];
  if(!drawing||project.settings.showLogo===false)return drawing?.remove();
  const value=project.settings.logo;
  if(!value)return drawing.remove();
  const original=window.SOP_REFERENCE?.defaults?.logo;
  if(original&&value===original){z.file('word/media/image1.png',original.split(',')[1],{base64:true});return;}
  const extent=drawing.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0];
  drawing.parentElement.replaceWith(await picture(value,Number(extent.getAttribute('cx'))/12700,Number(extent.getAttribute('cy'))/12700,'公司 Logo'));
 }
 if(!proof)await logo(cover);
 await logo(base);
 const frontCount=documentPages.filter(x=>x.kind!=='body').length,operationCount=documentPages.length-frontCount;
 const title=[project.meta.product,project.meta.title].filter(Boolean).join(' ');
 const confidentiality=cleanHeaderText(window.SOP_IMPORT.confidentialityText(project.settings));
 const copyright=project.settings.copyright||'';
 const addRelationship=(id,type,target)=>{
  const rel=rels.createElementNS(P,'Relationship');rel.setAttribute('Id',id);rel.setAttribute('Type',R+'/'+type);rel.setAttribute('Target',target);rels.documentElement.append(rel);
 };
 const headerTemplate=await z.file('word/header4.xml').async('string');
 const header4=[...rels.documentElement.children].find(e=>e.getAttribute('Target')==='header4.xml');
 const headerType=[...ct.documentElement.children].find(e=>e.getAttribute('PartName')==='/word/header4.xml');
 function operationSection(number){
  const sec=section.cloneNode(true),header=xml(headerTemplate);
  if(proof){
   // Keep the field formatting in both Office engines. PAGE uses the actual section start;
   // the total uses a constant formula instead of recounting the proof file.
   const instructions=desc(header,'instrText');
   const formula=instructions.find(node=>node.textContent.trim()==='=');
   const subtract=instructions.find(node=>node.textContent.includes('[[FRONTPAGES]]')).parentElement;
   for(let run=formula.parentElement.nextElementSibling;run!==subtract;){
    const next=run.nextElementSibling;
    run.remove();run=next;
   }
   subtract.remove();
   formula.textContent='= '+operationCount+' ';
  }
  for(const n of desc(header,'t')){
   const tokens={'[[PAGE]]':number,'[[TOTALPAGES]]':documentPages.length,'[[OPERATIONS]]':operationCount,'[[CONFIDENTIAL]]':confidentiality};
   if(Object.hasOwn(tokens,n.textContent))n.textContent=tokens[n.textContent];
  }
  for(const n of desc(header,'instrText'))n.textContent=n.textContent.replace('[[FRONTPAGES]]',String(frontCount));
  const filename=number===1?'header-sop.xml':`header-sop-${number}.xml`;
  z.file('word/'+filename,serialize(header));
  if(number===1||proof){
   z.remove('word/header4.xml');header4.setAttribute('Target',filename);headerType.setAttribute('PartName','/word/'+filename);
  }else{
   const id='rIdSopHeader'+number,type=headerType.cloneNode(true);type.setAttribute('PartName','/word/'+filename);ct.documentElement.append(type);
   addRelationship(id,'header',filename);first(sec,'headerReference').setAttributeNS(R,'r:id',id);
  }
  first(sec,'pgNumType').setAttributeNS(W,'w:start',String(number));
  return sec;
 }
 function endSection(entry,number){
  if(entry.kind==='body')return operationSection(number);
  const p={cover:coverBreak,history:historyBreak,flow:flowBreak}[entry.kind];
  return desc(p,'sectPr')[0].cloneNode(true);
 }
 function addSectionEnd(sec,final){
  const p=operationEnd.cloneNode(true),pr=first(p,'pPr');
  if(final){body.append(p,sec);return;}
  pr.append(sec);body.append(p);
 }
 function setExactRows(t,minimumHeight={}){
  for(const [index,row]of children(t,'tr').entries()){
   const pr=first(row,'trPr'),height=first(pr,'trHeight');
   if(!first(pr,'cantSplit'))pr.insertBefore(el(d,'cantSplit'),height);
   if(!height)continue;
   // WPS adds half a point for the borders when laying out source minimum-height rows.
   if(height.getAttributeNS(W,'hRule')==='atLeast')height.setAttributeNS(W,'w:val',Math.max(twips(height,'val')+10,minimumHeight[index]||0));
   height.setAttributeNS(W,'w:hRule','exact');
  }
 }
 function referenceFlow(t,chunk){
  setExactRows(t,{2:615});
  const c=cell(t,1,0),chartSize={width:tableCellWidth(t,c),height:twips(first(first(c.parentNode,'trPr'),'trHeight'),'val')/20};
  fillCell(cell(t,0,0),(project.frontContent?.flowTitle??'工艺流程图')+(chunk?'（续）':''));
  for(const child of [...c.children])if(child.localName!=='tcPr')child.remove();
  const original=project.originalFront?.flow;
  if(original&&project.frontContent?.flowMode!=='editable'&&!project.frontContent?.flowGraph){
   const source=importNodes(original.blocks).find(n=>n.localName==='tbl'),area=source&&cell(source,1,0);
   const blocks=area?[...area.children].filter(n=>n.localName!=='tcPr'):[];
   c.append(...(blocks.length?blocks:[para(d,'',2)]));
  }else c.append(native.flowParagraph(project,chunk,chartSize));
  const note=flowNoteText(project);
  fillCell(cell(t,2,0),note==='注：□表示一般操作，◇表示检查及测试。★代表关键工序，▲代表特殊工序'?note.replace('。★','。\n★'):note);
 }
 async function referenceOperation(t,p){
  fillCell(cell(t,0,1),title);
  fillCell(cell(t,0,3),project.meta.number);
  fillCell(cell(t,1,3),(p.name||'')+(p.isContinuation?'（续）':''));
  fillCell(cell(t,3,0),window.SOP_TEMPLATE.operationLabel(p));
  fillCell(cell(t,3,1),p.station);
  fillCell(cell(t,19,0),p.duration);
  fillCell(cell(t,19,1),p.people);
  const op=cell(t,3,2),imported=window.SOP_IMPORT.active(p);
  if(!imported||p.importedContent?.workbenchWidth){
   // Account for the reference grid's borders so Word uses the preview's physical text width.
   const properties=first(op,'tcPr'),margins=el(d,'tcMar');
   for(const [edge,width]of Object.entries(operationDimensions.operationWordPadding))margins.append(el(d,edge,{w:width,type:'dxa'}));
   properties.insertBefore(margins,first(properties,'vAlign')||null);
  }
  if(imported){
   for(const child of [...op.children])if(child.localName!=='tcPr')child.remove();
   op.append(...importNodes(window.SOP_IMPORT.bodyBlocks(p)));
  }else{
   for(const child of [...op.children])if(child.localName!=='tcPr')child.remove();
   op.append(operationHeading(d,'一、操作步骤：'));
   for(const line of window.SOP.bodyLines(p,'steps'))op.append(bodyParagraph(d,line,p,'steps',nextFitId));
   if(p.canvas)op.append(await canvasParagraph(p.canvas,contentWidth,p.canvasHeightPt));
   else if(p.photos.length)for(const row of window.SOP.operationPhotoLayout(p.photos))op.append(await photoParagraph(row));
   op.append(...operationRequirementBlocks(d,p,nextFitId));
   if(p.standardText)op.append(para(d,p.standardText,20));
  }
  if(!children(op,'p').length)op.append(para(d,'',2));
  for(let i=0;i<6;i++)for(const [j,key]of materialFields.entries())fillCell(cell(t,4+i,4+j),p.materials[i]?.[key]);
  for(let i=0;i<2;i++)for(const [j,key]of checkFields.entries())fillCell(cell(t,12+i,4+j),p.checks[i]?.[key]);
  fillCell(cell(t,14,3),'备注：'+(p.notes||''));
  // Older Word imports could accidentally record a check number or the note as a legend.
  for(const [row,key,label]of [[15,'importance','重要度'],[16,'management','管理手段']]){
   const value=String(project.settings[key]??'').trimStart().replace(/^\d+[、.．]\s*/, '');
   if(new RegExp('^'+label+'[：:]').test(value))fillCell(cell(t,row,3),value);
  }
  const signoff=window.SOP_IMPORT.pageSignoff(p,project.meta);
  for(const [i,key]of ['author','reviewer','approver','version'].entries())fillCell(cell(t,20,3+i),[signoff[key],signoff[key+'Date']].filter(Boolean).join('\n'));
  for(let i=0;i<2;i++)for(const [j,key]of revisionFields.entries())fillCell(cell(t,21+i,j),revisionRecords(p)[i]?.[key]);
  setExactRows(t,{21:230,22:230});
  for(const pp of desc(t,'pPr'))for(const tag of ['keepNext','keepLines','pageBreakBefore'])for(const n of children(pp,tag))n.remove();
 }
 body.replaceChildren();
 let operation=proof?documentPages.filter(entry=>entry.kind==='body').findIndex(entry=>entry===proof):0;
 for(const [index,entry]of ordered.entries()){
  const {kind,page}=entry;
  const t=({cover,history,flow,body:base})[kind].cloneNode(true);
  if(kind==='cover')referenceCover(t,project,native);
  else if(kind==='history'){
   const p=historyTitle.cloneNode(true);fillParagraph(p,project.frontContent?.historyTitle??'文件修改履历');body.append(p);
   for(let i=0;i<15;i++)for(const [j,key]of historyFields.entries()){
    const c=cell(t,i+1,j);
    fillCell(c,project.history[i]?.[key]);
    const pPr=first(first(c,'p'),'pPr');
    if(!first(pPr,'jc'))pPr.insertBefore(el(d,'jc',{val:'center'}),first(pPr,'rPr')||null);
   }
   setExactRows(t);
  }else if(kind==='flow')referenceFlow(t,page.chunk||0);
  else{operation++;await referenceOperation(t,page);}
  body.append(t);
  addSectionEnd(endSection(entry,operation),index===ordered.length-1);
 }
 const usedDrawingIds=new Set();
 for(const node of d.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')){
  const id=node.getAttribute('id');
  if(!usedDrawingIds.has(id)){usedDrawingIds.add(id);continue;}
  const unique=String(++drawingN+2000000);
  node.setAttribute('id',unique);
  for(const child of node.parentNode.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/picture','cNvPr'))if(child.getAttribute('id')===id)child.setAttribute('id',unique);
  usedDrawingIds.add(unique);
 }
 const styles=xml(await z.file('word/styles.xml').async('string'));
 const fullWidthStyle=el(styles,'style',{type:'character',customStyle:1,styleId:operationText.fullWidthStyleId});
 fullWidthStyle.append(el(styles,'name',{val:operationText.fullWidthStyleName}),el(styles,'semiHidden'));
 styles.documentElement.append(fullWidthStyle);
 z.file('word/styles.xml',serialize(styles));
 const documentXML=serialize(d);
 z.file('word/document.xml',documentXML);
 function removeTemplatePart(filename){
  z.remove('word/'+filename);
  [...rels.documentElement.children].find(node=>node.getAttribute('Target')===filename)?.remove();
  [...ct.documentElement.children].find(node=>node.getAttribute('PartName')==='/word/'+filename)?.remove();
 }
 for(let i=1;i<=4;i++){
  if(proof&&i<4){removeTemplatePart('header'+i+'.xml');removeTemplatePart('footer'+i+'.xml');continue;}
  const footerPart=`word/footer${i}.xml`,footer=xml(await z.file(footerPart).async('string'));
  const [main,end]=desc(footer,'t');
  main.textContent=copyright.endsWith('。')?copyright.slice(0,-1):copyright;end.textContent=copyright.endsWith('。')?'。':'';
  z.file(footerPart,serialize(footer));
  if(i===4&&operationCount)continue;
  const headerPart=`word/header${i}.xml`,header=xml(await z.file(headerPart).async('string'));
  if(i===4){z.remove(headerPart);header4.remove();headerType.remove();continue;}
  desc(header,'t').at(-1).textContent=confidentiality;
  z.file(headerPart,serialize(header));
 }
 if(proof&&![...d.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip')].some(node=>node.getAttributeNS(R,'embed')==='rId14'))removeTemplatePart('media/image1.png');
 const settings=xml(await z.file('word/settings.xml').async('string'));
 for(const tag of ['updateFields','documentProtection','writeProtection'])for(const e of desc(settings,tag))e.remove();
 settings.documentElement.append(el(settings,'updateFields',{val:'true'}));
 z.file('word/settings.xml',serialize(settings));
 if(!proof){
  const embedded=xml('<sop-project xmlns="urn:lenfor:sop:project"/>');
  embedded.documentElement.setAttribute('documentSha256',await hashText(documentXML));
  embedded.documentElement.textContent=base64Utf8(JSON.stringify(window.SOP.projectForStorage(project)));
  z.file('customXml/sop-project.xml',serialize(embedded));
  addRelationship('rIdSopProject','customXml','../customXml/sop-project.xml');
 }
 z.file('word/_rels/document.xml.rels',serialize(rels));
 z.file('[Content_Types].xml',serialize(ct));
 const app=xml(await z.file('docProps/app.xml').async('string'));
 const pages=app.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/extended-properties','Pages')[0];
 if(pages)pages.textContent=String(ordered.length);
 z.file('docProps/app.xml',serialize(app));
 return z.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
async function importDocx(buffer){
 const signature=new Uint8Array(buffer);if(signature[0]!==0x50||signature[1]!==0x4b)throw Error('所选文件当前无法作为标准 DOCX 读取。可能存在密码保护、终端加密或格式不符，请按公司允许的方式提供可读取的 DOCX。');
 const z=await JSZip.loadAsync(buffer);if(z.file('customXml/sop-project.xml')){const s=xml(await z.file('customXml/sop-project.xml').async('string')),savedHash=s.documentElement.getAttribute('documentSha256'),currentHash=await hashText(await z.file('word/document.xml').async('string'));if(savedHash===currentHash||!confirm('检测到 Word 在工作台外部保存或修改过。\n\n确定：读取 Word 当前内容，需重新核对图片标注。\n取消：恢复导出时的工作台项目快照。'))return window.SOP.validate(JSON.parse(fromBase64(s.documentElement.textContent)));}
 const file=z.file('word/document.xml');if(!file)throw Error('Word 文件缺少正文。');const d=xml(await file.async('string'));if(d.getElementsByTagName('parsererror').length)throw Error('无法解析 Word 文件结构。');const rels=xml(await z.file('word/_rels/document.xml.rels').async('string')),relmap=new Map([...rels.documentElement.children].map(e=>[e.getAttribute('Id'),e.getAttribute('Target')]));
 const p=window.SOP.clone(window.SOP_ASSETS.seed);delete p.originalFront;p.pages=[];p.history=[];delete p.settings.confidentialLevel;delete p.pageOrder;delete p.frontContent;p.meta={...p.meta,product:'导入的 SOP',author:'',reviewer:'',approver:'',date:''};
 const {styles:sourceStyles,theme:sourceTheme}=await window.SOP_IMPORT.typographyParts(z);
 const tables=desc(d,'tbl'),coverTable=tables.find(t=>{
  const rows=children(t,'tr');return rows.length===2&&txt(rows[1]).includes('裸机成品料号');
 });
 const coverData=coverTable?readCoverValues(coverTable):{};
 if(coverTable){const ps=desc(coverTable,'p');if(ps[2])p.settings.company=txt(ps[2]);}
 if(coverTable||tables[0]){const logo=(coverTable||tables[0]).getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip')[0],target=relmap.get(logo?.getAttributeNS(R,'embed'));p.settings.logo='';if(target){const path='word/'+target.replace(/^\.\//,''),part=z.file(path),ext=path.split('.').pop().toLowerCase();if(part&&['png','jpg','jpeg','webp'].includes(ext))p.settings.logo='data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+await part.async('base64');}}
 for(const [part,key]of [['word/header1.xml','confidential'],['word/footer1.xml','copyright']])if(z.file(part))p.settings[key]=txt(xml(await z.file(part).async('string')).documentElement,true).replace(/\t/g,' ').trim();
 const allp=desc(d,'p');for(const q of allp.slice(0,30)){const s=txt(q);if(s.startsWith('文件编号：'))p.meta.number=s.replace(/^文件编号：/,'').trim();if(s.startsWith('文件名称：')){const value=s.replace(/^文件名称：/,'').trim();p.meta.product=value.replace(/\s*(制造)?作业指导书.*$/,'').trim();}if(/^版\s*本[：:]/.test(s))p.meta.version=s.replace(/^版\s*本[：:]/,'').trim();if(s.startsWith('裸机成品料号：'))p.meta.bare=s.split('：').slice(1).join('：');if(s.startsWith('包装成品料号：'))p.meta.packed=s.split('：').slice(1).join('：');}
 const historyTable=tables.find(t=>txt(children(t,'tr')[0]).includes('文件归档申请单编号'));if(historyTable)for(const row of children(historyTable,'tr').slice(1)){const cs=cells(row);if(cs.length===7&&cs.some(c=>txt(c).trim())){const entry={};['date','number','version','summary','author','reviewer','approver'].forEach((k,i)=>entry[k]=txt(cs[i]));p.history.push(entry);}}
 const operationTables=tables.flatMap(source=>{const rows=children(source,'tr'),starts=rows.flatMap((r,i)=>i>=2&&txt(r).includes('工序作业内容')?[i-2]:[]);return starts.map((start,i)=>{const t=source.cloneNode(false);for(const child of source.children)if(child.localName!=='tr')t.append(child.cloneNode(true));for(const row of rows.slice(start,starts[i+1]??rows.length))t.append(row.cloneNode(true));return t;});});
 for(const t of operationTables){const rows=children(t,'tr');if(rows.length<6||!txt(rows[2]).includes('工序作业内容')||cells(rows[3]).length<3)continue;const isWide=cells(rows[2]).length===2,isReference=!isWide&&rows.length>=24&&txt(rows[23]).includes('更改文件号'),n=window.SOP.blankPage(),op=cells(rows[3])[isWide?0:2];if(!p.pages.length){p.meta.product=txt(cell(t,0,1));p.meta.title='';if(cell(t,0,3))p.meta.number=txt(cell(t,0,3));const signRow=rows.findIndex(r=>/编制/.test(txt(r))&&/审核/.test(txt(r))&&/批准/.test(txt(r)));const signatures=signRow>=0?cells(rows[signRow+(isReference?2:1)]):[];if(signatures.length>=4){const cs=signatures.slice(-4);for(const [i,key]of ['author','reviewer','approver'].entries()){const value=txt(cs[i]),date=value.match(/\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/);p.meta[key]=value.replace(/\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/g,'').trim();if(i===0&&date)p.meta.date=date[0];}p.meta.version=txt(cs[3]);}if(!isWide){
   const legendStart=isReference?15:13;
   if(cells(rows[legendStart]||t)[3])p.settings.importance=txt(cells(rows[legendStart])[3]);
   if(cells(rows[legendStart+1]||t)[3])p.settings.management=txt(cells(rows[legendStart+1])[3]);
  }}n.processLabel=isWide?'':txt(cells(rows[3])[0]);n.name=txt(cell(t,1,3))||'导入工序';n.station=isWide?'':txt(cells(rows[3])[1]);n.steps='';n.requirements='';let field='steps';
  for(const line of txt(op).split('\n')){
   const value=window.SOP_IMPORT.operationLine(line,field);
   field=value.field;
   if(value.text)n[field]+=(n[field]?'\n':'')+value.text;
  }

  const ids=window.SOP_IMPORT.imageIds(op);for(const rid of ids){const target=relmap.get(rid);if(!target)continue;const path='word/'+target.replace(/^\.\//,'');const f=z.file(path);if(!f)continue;const ext=path.split('.').pop().toLowerCase();if(!['png','jpg','jpeg','webp'].includes(ext))continue;const mime=ext==='jpg'?'jpeg':ext;n.photos.push({id:window.SOP.uid(),data:'data:image/'+mime+';base64,'+await f.async('base64'),caption:'作业图 '+(n.photos.length+1),marks:[]});}
  const qrow=rows.findIndex(r=>/检查频次|控制特性/.test(txt(r)));
  const materialEnd=qrow>3?qrow:Math.min(8,rows.length);
  for(const row of rows.slice(4,materialEnd)){const cs=cells(row);if(isWide&&cs.length===4&&cs.slice(1).some(c=>txt(c).trim()))n.materials.push({name:txt(cs[1]),spec:txt(cs[2]),qty:txt(cs[3])});if(cs.length>=7&&cs.slice(4,7).some(c=>txt(c).trim()))n.materials.push({name:txt(cs[4]),spec:txt(cs[5]),qty:txt(cs[6])});}
  if(qrow>=0)for(const row of rows.slice(qrow+(txt(rows[qrow+1]).includes('生产自检')?2:1))){const cs=cells(row);if(cs.length===10&&cs.slice(4).some(c=>txt(c).trim()))n.checks.push({feature:txt(cs[4]),standard:txt(cs[5]),self:txt(cs[6]),audit:txt(cs[7]),importance:txt(cs[8]),method:txt(cs[9])});}
  if(isWide&&rows[14])n.checks.push({feature:'',standard:'',self:txt(cells(rows[14])[1]),audit:txt(cells(rows[14])[2]),importance:'',method:''});
  if(!isWide){
   const notes=cells(rows[isReference?14:12]||t)[3];
   if(notes)n.notes=txt(notes).replace(/^备注[：:]\s*/,'');
   const capacity=cells(rows[isReference?19:14]||t);
   const editableText=cell=>{const value=txt(cell);return value.trim()?value:'';};
   n.duration=editableText(capacity[0]);n.people=editableText(capacity[1]);
   if(isReference)n.changeRecords=rows.slice(21,23).map(row=>Object.fromEntries(revisionFields.map((key,i)=>[key,editableText(cells(row)[i])])));
  }
  {const index=rows.findIndex(r=>/编制/.test(txt(r))&&/审核/.test(txt(r))&&/批准/.test(txt(r)));const values=rows[index+(isReference?2:1)],cs=index>=0&&values?cells(values).slice(-4):[];if(cs.length===4){for(const [j,key]of ['author','reviewer','approver'].entries()){const value=txt(cs[j]),date=value.match(/\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/);n.signoff[key]=value.replace(/\d{4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?/g,'').trim();n.signoff[key+'Date']=date?.[0]||'';}n.signoff.version=txt(cs[3]);}}
  const workbenchWidth=desc(op,'rStyle').some(style=>window.SOP_IMPORT.workbenchTracking(style.getAttributeNS(W,'val'),sourceStyles));
  n.importedContent={blocks:await window.SOP_IMPORT.capture(op,z,relmap,sourceStyles,sourceTheme),signature:window.SOP_IMPORT.signature(n),...(workbenchWidth?{workbenchWidth}:{})};
  p.pages.push(n);
 }
 if(!p.pages.length)throw Error('未识别到兼容格式的工序表。第一版支持与当前参考文件结构一致的表格型 SOP。');Object.assign(p.meta,coverData);p.nativeWord=await window.SOP_IMPORT.resources(z);await ensureOriginalFront(p,z,d,relmap,{styles:sourceStyles,theme:sourceTheme});const result=window.SOP.validate(p);result.nativeWord.projectState=window.SOP_IMPORT.projectState(result);return result;
}

function legacyMissingCount(p){
 if(!p.nativeWord?.documentXml||p.nativeWord.recoveryCompleted)return 0;
 let baseline;try{baseline=JSON.parse(p.nativeWord.projectState);}catch{return 0;}
 const d=xml(p.nativeWord.documentXml),count=desc(d,'tbl').reduce((n,t)=>n+children(t,'tr').filter((r,i)=>i>=2&&txt(r).includes('工序作业内容')).length,0);
 return baseline.pages?.length<count?count-baseline.pages.length:0;
}
async function recoverMissing(p){
 if(!legacyMissingCount(p))return null;
 const z=new JSZip();for(const [name,data]of Object.entries(p.nativeWord.files))z.file(name,data,{base64:true});z.file('word/document.xml',p.nativeWord.documentXml);z.file('[Content_Types].xml',p.nativeWord.types);
 const restored=await importDocx(await z.generateAsync({type:'arraybuffer'})),result=window.SOP.clone(p),key=page=>page.importedContent?.blocks?.map(b=>b.xml).join(''),original=new Map();
 for(const page of result.pages){const k=key(page);if(k&&!original.has(k))original.set(k,page);}
 const matches=restored.pages.map(page=>original.get(key(page)));
 if(matches.filter(Boolean).length+legacyMissingCount(p)!==restored.pages.length)throw Error('旧项目与原稿无法可靠对应，请保留备份后重新导入原 Word。');
 let added=0;for(let i=0;i<restored.pages.length;i++){if(matches[i])continue;const page=restored.pages[i];let position=0;for(let j=i-1;j>=0;j--)if(matches[j]){position=result.pages.indexOf(matches[j])+1;break;}result.pages.splice(position,0,page);matches[i]=page;added++;}
 result.nativeWord.recoveryCompleted=true;
 if(p.nativeWord.projectState===window.SOP_IMPORT.projectState(p))result.nativeWord.projectState=window.SOP_IMPORT.projectState(result);
 return {project:result,added};
}

async function ensureOriginalFront(project,zip,document,relationships,typography){
 if(!project.nativeWord?.documentXml||project.originalFront)return;
 const z=zip||new JSZip();if(!zip)for(const [name,data]of Object.entries(project.nativeWord.files))z.file(name,data,{base64:true});
 const d=document||xml(project.nativeWord.documentXml),body=desc(d,'body')[0],rels=relationships||new Map([...xml(await z.file('word/_rels/document.xml.rels').async('string')).documentElement.children].map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
 const {styles,theme}=typography||await window.SOP_IMPORT.typographyParts(z),tables=children(body,'tbl'),firstOperation=tables.find(t=>children(t,'tr').some(r=>txt(r).includes('工序作业内容'))),before=firstOperation?tables.slice(0,tables.indexOf(firstOperation)):[];
 let originalMeta=project.meta;try{originalMeta=JSON.parse(project.nativeWord.projectState||'null')?.meta||project.meta;}catch{}project.originalFront={};for(const [i,kind]of ['cover','history','flow'].entries()){const table=before[i];if(!table)continue;const wrapper=d.createElement('capture'),siblings=children(body,'p').filter(p=>txt(p).trim());const prior=before[i-1],all=[...body.children],start=prior?all.indexOf(prior)+1:0;for(const item of all.slice(start,all.indexOf(table)))if(siblings.includes(item)&&!desc(item,'sectPr').length)wrapper.append(item.cloneNode(true));wrapper.append(table.cloneNode(true));project.originalFront[kind]={metaBaseline:window.SOP.clone(originalMeta),blocks:await window.SOP_IMPORT.capture(wrapper,z,rels,styles,theme),source:'imported-word',notice:'原稿原生对象保留；浏览器仅作近似预览，复杂形状及分组请用 Word/WPS 核对。'};project.settings[kind]=true;}
 project.frontContent={...project.frontContent};if((project.frontContent.flowManual||project.frontContent.flowGraph)&&!project.frontContent.flowMode)project.frontContent.flowMode='editable';
}
function originalFrontBlocks(project,kind){
 const original=project.originalFront?.[kind];if(!original)return [];if(kind==='flow')return original.blocks.map(block=>{const d=xml(block.xml),t=desc(d,'tbl')[0];if(t){mergeFlowTitle(t,project.frontContent?.flowTitle??'工艺流程图');if(project.frontContent?.flowNote!==undefined){const rows=children(t,'tr');setCell(cells(rows.at(-1))[0],flowNoteText(project),19);}}return {...block,xml:serialize(d.documentElement)};});if(kind!=='cover')return original.blocks;
 const baseline=original.metaBaseline||{},keys={number:'文件编号',bare:'裸机成品料号',packed:'包装成品料号',version:'版本',date:'生效日期',author:'制定',reviewer:'审核',approver:'批准',qualitySigner:'质量会签',productionSigner:'生产会签'},updates=[];
 for(const [key,label]of Object.entries(keys))if(project.meta[key]!==baseline[key])updates.push({label,value:project.meta[key]||''});
 if(project.meta.product!==baseline.product||project.meta.title!==baseline.title)updates.push({label:'文件名称',value:[project.meta.product,project.meta.title].filter(Boolean).join(' ')});
 return original.blocks.map(block=>{const d=xml(block.xml),table=desc(d,'tbl')[0];if(table&&children(table,'tr')[0]&&cells(children(table,'tr')[0]).length===2){const c=cell(table,0,1);centerCell(c,project.frontContent?.coverHeading??txt(c),32);}for(const p of desc(d,'p')){const text=txt(p),normal=text.replace(/\s/g,'');for(const {label,value}of updates){if(!normal.startsWith(label+':')&&!normal.startsWith(label+'：'))continue;const split=coverSignerCells(p.parentElement?.parentElement);if(split?.label===label){fillCell(split.name,value);break;}if(coverSignerParagraph(p)?.label===label){fillCoverSignerName(p,value);break;}const colon=text.search(/[：:]/);if(colon<0)continue;const nodes=children(p,'r').flatMap(r=>children(r,'t')),joined=nodes.map(n=>n.textContent).join(''),start=joined.search(/[：:]/)+1,end=joined.indexOf('签字',start),segment=joined.slice(start,end<0?joined.length:end),lead=segment.match(/^\s*/)[0].length,tail=segment.match(/\s*$/)[0].length,from=start+lead,to=Math.max(from,start+segment.length-tail);let pos=0,inserted=false;for(const n of nodes){const s=n.textContent,next=pos+s.length;if((next>from&&pos<to)||(!inserted&&from===to&&pos<=from&&next>=from)){n.textContent=s.slice(0,Math.max(0,from-pos))+(inserted?'':value)+(next>to?s.slice(Math.max(0,to-pos)):'');n.setAttribute('xml:space','preserve');inserted=true;}pos=next;}break;}}return {...block,xml:serialize(d.documentElement)};});
}
async function refreshOriginalCover(project,kind='cover'){const original=project.originalFront?.[kind];if(!original)return false;const key=JSON.stringify({version:3,meta:project.meta,front:project.frontContent});if(original.previewKey===key)return false;original.previewKey=key;try{const z=new JSZip();for(const [name,data]of Object.entries(project.nativeWord.files))z.file(name,data,{base64:true});const rels=new Map([...xml(await z.file('word/_rels/document.xml.rels').async('string')).documentElement.children].map(n=>[n.getAttribute('Id'),n.getAttribute('Target')])),{styles,theme}=await window.SOP_IMPORT.typographyParts(z),d=xml('<root>'+originalFrontBlocks(project,kind).map(b=>b.xml).join('')+'</root>');original.previewBlocks=await window.SOP_IMPORT.capture(d.documentElement,z,rels,styles,theme);return true;}catch(error){original.previewKey='';return false;}}
function convertOriginalFlow(project){
 const source=project.originalFront?.flow;if(!source) return {model:window.SOP_OBJECTS.normalize(),notice:'空白流程副本，请添加节点。'};
 const d=xml('<root>'+source.blocks.map(b=>b.xml).join('')+'</root>'),WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',A='http://schemas.openxmlformats.org/drawingml/2006/main',S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape',one=(n,name)=>n&&[...n.children].find(e=>e.localName===name),objects=[],lines=[];let unsupported=0;
 for(const drawing of desc(d,'drawing')){const anchor=drawing.getElementsByTagNameNS(WP,'anchor')[0]||drawing.getElementsByTagNameNS(WP,'inline')[0],sp=drawing.getElementsByTagNameNS(S,'spPr')[0];if(!anchor||!sp){unsupported++;continue;}const ext=one(anchor,'extent'),x=Number(one(one(anchor,'positionH'),'posOffset')?.textContent||0)/12700,y=Number(one(one(anchor,'positionV'),'posOffset')?.textContent||0)/12700,w=Number(ext?.getAttribute('cx')||0)/12700,h=Number(ext?.getAttribute('cy')||0)/12700,geom=one(sp,'prstGeom')?.getAttribute('prst')||'rect',transform=one(sp,'xfrm'),line=one(sp,'ln'),color=one(one(line,'solidFill'),'srgbClr')?.getAttribute('val')||'243E46',fill=one(one(sp,'solidFill'),'srgbClr')?.getAttribute('val'),texts=[...drawing.getElementsByTagNameNS(W,'txbxContent')].map(t=>[...t.getElementsByTagNameNS(W,'p')].map(p=>txt(p)).join('\n')).join('\n');
  const o={id:window.SOP.uid(),type:/line|Connector/i.test(geom)?(one(line,'tailEnd')?.getAttribute('type')==='triangle'?'arrow':'line'):geom==='ellipse'?'ellipse':geom==='diamond'?'diamond':geom==='triangle'?'triangle':'rect',x,y,w:Math.max(.01,w),h:Math.max(.01,h),text:texts,color:'#'+color,fill:fill?'#'+fill:'transparent',fontSize:14,flipX:['1','true'].includes(transform?.getAttribute('flipH')),flipY:['1','true'].includes(transform?.getAttribute('flipV'))};if(!['line','straightConnector1','bentConnector3','rect','roundRect','ellipse','diamond','triangle'].includes(geom))unsupported++;if(['line','arrow'].includes(o.type))lines.push(o);else objects.push(o);
 }
 if(!objects.length)return {model:window.SOP_OBJECTS.normalize(),notice:'此原稿无法可靠转换为节点，已保留原稿；当前副本为空白，请手工重画。'};
 const all=[...objects,...lines],minX=Math.min(...all.map(o=>o.x)),minY=Math.min(...all.map(o=>o.y));for(const o of all){o.x=(o.x-minX+20)*1.2;o.y=(o.y-minY+20)*1.2;o.w*=1.2;o.h*=1.2;o.fontSize*=1.2;}const width=Math.max(900,...all.map(o=>o.x+o.w+24)),height=Math.max(520,...all.map(o=>o.y+o.h+24)),edges=[];
 const nearest=(x,y)=>{let best=null,dist=40;for(const o of objects){const dx=Math.max(o.x-x,0,x-o.x-o.w),dy=Math.max(o.y-y,0,y-o.y-o.h),v=Math.hypot(dx,dy);if(v<dist){dist=v;best=o;}}return best;};
 for(const o of lines){const from=nearest(o.x+(o.flipX?o.w:0),o.y+(o.flipY?o.h:0)),to=nearest(o.x+(o.flipX?0:o.w),o.y+(o.flipY?0:o.h));if(from&&to&&from!==to)edges.push({id:o.id,from:from.id,to:to.id,label:''});else objects.push(o);}
 return {model:window.SOP_OBJECTS.normalize({width,height,objects,edges}),notice:'已提取原稿 DrawingML 节点及连线，连接关系按几何位置推断，请逐条核对；'+unsupported+'个复杂或不支持对象可能简化，原稿仍独立保留。'};
}
async function exportOriginal(project){if(!project.nativeWord?.documentXml)throw Error('此项目没有保留原始 Word');const z=new JSZip();for(const [name,data]of Object.entries(project.nativeWord.files))z.file(name,data,{base64:true});z.file('word/document.xml',project.nativeWord.documentXml);z.file('[Content_Types].xml',project.nativeWord.types);return z.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}
function exportProof(project,layout,front,key){
 if(typeof key!=='string'||!key)throw Error('请先选择要校样的工序。');
 return exportDocx(project,layout,front,key);
}
window.SOP_WORD={exportProof,flowNoteText,originalFrontBlocks,refreshOriginalCover,convertOriginalFlow,ensureOriginalFront,exportOriginal,exportDocx,operationRequirementBlocks,importDocx,legacyMissingCount,recoverMissing};
})();
