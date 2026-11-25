/* SOP 工作台：浏览器本地运行，不向外部服务发送文件。 */
(() => {
'use strict';
const A=window.SOP_ASSETS,T=window.SOP_TEMPLATE,MAT_ROWS=A.layout==='wide-v2'?T.materialRows:4,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const uid=()=>globalThis.crypto?.randomUUID?.()||'sop-'+Date.now().toString(36)+Math.random().toString(36).slice(2);
const clone=o=>JSON.parse(JSON.stringify(o));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initialProject=clone(A.seed);
if(window.SOP_REFERENCE?.defaults){
 const {company,logo,confidential,confidentialLevel,copyright}=window.SOP_REFERENCE.defaults;
 Object.assign(initialProject.settings,{company,logo,confidential,confidentialLevel,copyright});
}
let project=validate(initialProject),selected=project.pages[0]?.id,tab='content',view='process',layout=[],front=[],undo=[],saveTimer,refreshTimer,db,replacePhotoTarget,photoEdit;
let autosaveReady=false,revision=0,lastSaved=0,projectFiles;
const imageCache=new Map();
function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.classList.toggle('error',error);t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,error?8500:4200);}
function snapshot(){undo.push({project:clone(project),selected});if(undo.length>18)undo.shift();$('#undoBtn').disabled=false;}
function page(){if(String(selected).startsWith('front:'))return null;return project.pages.find(p=>p.id===selected)||project.pages[0];}
function textStyle(p,key){const v=p.contentStyle||p.textStyles?.[key]||{},number=(x,f,min,max)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Number(x))):f;return {fontSize:number(v.fontSize,10.5,6,36),letterSpacing:number(v.letterSpacing,0,-1,10)};}
function textColors(page,key,kind){
 const text=String(page[key]||''), mask=Array(text.length).fill('');
 for(const range of Array.isArray(page[key+kind])?page[key+kind]:[]){
  if(Array.isArray(range)&&Number.isInteger(range[0])&&Number.isInteger(range[1])&&range[0]>=0&&range[1]<=text.length){
   const color=range[2]??(kind==='Highlights'?'#ffff00':'');
   if(SOP_COLORS.valid(color))mask.fill(color,range[0],range[1]);
  }
 }
 return mask;
}
function saveTextColors(page,key,kind,mask){
 const ranges=[];
 for(let i=0;i<mask.length;i++){
  if(!mask[i])continue;
  const start=i;
  while(mask[i+1]===mask[start])i++;
  ranges.push([start,i+1,mask[start]]);
 }
 if(ranges.length)page[key+kind]=ranges;
 else delete page[key+kind];
}
function bodyLines(page,key){
 const backgrounds=textColors(page,key,'Highlights'), foregrounds=textColors(page,key,'TextColors');
 let offset=0;
 return String(page[key]||'').split('\n').map(text=>{
  const runs=[];
  for(let start=0;start<text.length;){
   const background=backgrounds[offset+start], color=foregrounds[offset+start];
   let end=start+1;
   while(end<text.length&&backgrounds[offset+end]===background&&foregrounds[offset+end]===color)end++;
   runs.push({text:text.slice(start,end),background,color});
   start=end;
  }
  offset+=text.length+1;
  return text.trim()?runs:null;
 }).filter(Boolean);
}
function styledParagraph(p,key,runs){
 const f=textStyle(p,key);
 const html=runs.map(({text,color,background})=>color||background
  ?'<span style="color:'+(color||'inherit')+';background-color:'+(background||'transparent')+'">'+esc(text)+'</span>'
  :esc(text)).join('');
 return '<p data-text-section="'+key+'" style="font-size:'+f.fontSize+'pt;letter-spacing:'+f.letterSpacing+'pt">'+html+'</p>';
}
function highlightControls(key){
 return '<div class="row"><div data-text-color="'+key+'"></div><div data-text-background="'+key+'"></div></div>';
}
function bindBodyText(input,p,key){
 bindInput(input,value=>{
  const old=p[key];
  let start=0,tail=0;
  while(start<Math.min(old.length,value.length)&&old[start]===value[start])start++;
  while(tail<Math.min(old.length,value.length)-start&&old[old.length-1-tail]===value[value.length-1-tail])tail++;
  for(const kind of ['TextColors','Highlights']){
   if(!p[key+kind]?.length)continue;
   const mask=textColors(p,key,kind);
   const next=mask.slice(0,start).concat(Array(value.length-start-tail).fill(''),mask.slice(old.length-tail));
   saveTextColors(p,key,kind,next);
  }
  p[key]=value;
 });
 for(const [selector,kind,label,clearLabel] of [
  ['data-text-color','TextColors','文字颜色','恢复默认文字颜色'],
  ['data-text-background','Highlights','文字底色','无底色']
 ]){
  const host=$('['+selector+'="'+key+'"]');
  if(!host)continue;
  SOP_COLORS.mount(host,{label,value:'transparent',transparent:true,clearLabel,onChange:color=>{
   const {selectionStart:start,selectionEnd:end}=input;
   if(start===end)return toast('请先在正文输入框中选中文字。');
   snapshot();
   const mask=textColors(p,key,kind);
   mask.fill(color==='transparent'?'':color.toLowerCase(),start,end);
   saveTextColors(p,key,kind,mask);
   input.focus();
   input.setSelectionRange(start,end);
   changed();
   refresh();
  }});
 }
}
function textControls(p){const f=textStyle(p,'steps'),fixed=p.fixed.includes('contentStyle'),disabled=fixed?' disabled':'';return `<div class="field shared-text-format"><div class="field-top"><strong>正文文字格式</strong><button class="pin ${fixed?'pinned':''}" data-pin="contentStyle" title="只固定字号与字间距，不固定文字内容">${fixed?'● 格式已固定 · 解锁':'固定格式'}</button></div><div class="text-format-controls"><label title="单位：磅">字号<input type="number" min="6" max="36" step="0.5" data-text-format="content" data-style-key="fontSize" value="${f.fontSize}"${disabled}></label><label title="单位：磅；0 为标准字间距">字间距<input type="number" min="-1" max="10" step="0.1" data-text-format="content" data-style-key="letterSpacing" value="${f.letterSpacing}"${disabled}></label></div><small>操作步骤、工艺技术要求共用；文字内容分别固定。</small></div>`;}

function blankPage(processId,category){return {id:uid(),processId:processId||uid(),...(category?{processCategory:category}:{}),name:'新工序',signoff:{author:'',authorDate:'',reviewer:'',reviewerDate:'',approver:'',approverDate:'',version:''},fitSinglePage:false,station:'',duration:'',people:'',steps:'',requirements:'',notes:'',photos:[],materials:[],checks:[],fixed:[]};}
function validate(p){
 const previousState=p?.schema==='sop-studio/v1'?window.SOP_IMPORT?.projectState(p):null;
 if(p?.schema!=='sop-studio/v1'||!p.meta||!p.settings||!Array.isArray(p.pages))throw Error('这不是有效的 SOP 工作台项目文件。');
 if(p.pages.length>300)throw Error('第一版每份项目最多支持 300 张基础工序页。');
 p.pages.forEach(x=>{if(typeof x.name!=='string'||!Array.isArray(x.photos)||!Array.isArray(x.materials)||!Array.isArray(x.checks))throw Error('项目中的工序数据不完整。');for(const ph of x.photos)if(!/^data:image\/(png|jpeg|webp);base64,/.test(ph.data))throw Error('项目包含不支持的图片数据。'); if(x.canvas)x.canvas=window.SOP_OBJECTS.restorePhotoCaptions(x.canvas,x.photos);if(x.canvasDraft?.objects)x.canvasDraft=window.SOP_OBJECTS.restorePhotoCaptions(x.canvasDraft,x.photos); x.id=x.id||uid();x.processId=x.processId||uid();if(x.processLabel!==undefined)x.processLabel=String(x.processLabel??'').trim();x.fixed=Array.isArray(x.fixed)?x.fixed:[];x.steps=String(x.steps||'');x.requirements=String(x.requirements||'');x.notes=String(x.notes||'');if(x.contentStyle)x.contentStyle=textStyle(x,'steps');if(x.textStyles)x.textStyles={steps:textStyle({textStyles:x.textStyles},'steps'),requirements:textStyle({textStyles:x.textStyles},'requirements')};x.signoff=window.SOP_IMPORT.pageSignoff(x,p.meta);});
 const numbers=T.numberProcesses(p.pages);
 for(const page of p.pages){
  const category=numbers.get(page.processId).processCategory;
  if(category)page.processCategory=category;
  else delete page.processCategory;
 }
 if(p.settings.logo===undefined)p.settings.logo=A.logo||'';
 if(p.settings.logo&&!/^data:image\/(png|jpeg|webp);base64,/.test(p.settings.logo))throw Error('Logo 图片格式不支持，请使用 PNG、JPEG 或 WebP。');
 if(p.settings.logo?.length>16*1024*1024)throw Error('Logo 图片过大，请先缩小后再导入。');
 if(p.settings.showLogo===undefined)p.settings.showLogo=true;
 if(p.signoffDefault)p.signoffDefault=window.SOP_IMPORT.pageSignoff({signoff:p.signoffDefault},p.meta);
 p.history=Array.isArray(p.history)?p.history:[];p.settings.numbering='body';if(previousState&&p.nativeWord?.projectState===previousState)p.nativeWord.projectState=window.SOP_IMPORT.projectState(p);return p;
}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('sop-studio-new-template-20261030',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbRead(key='current'){return new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function dbWrite(value){return new Promise((resolve,reject)=>{const t=db.transaction('projects','readwrite');t.objectStore('projects').put(value,'current');t.objectStore('projects').put(projectFiles?.state()||null,'fileBinding');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('自动保存中断'));});}
function changed(){revision++;document.body.dataset.recovery='pending';projectFiles?.changed();clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{if(!autosaveReady){document.body.dataset.recovery='failed';projectFiles?.status();return;}const current=revision;try{await dbWrite(projectForStorage(project));lastSaved=current;document.body.dataset.recovery='saved';}catch(e){document.body.dataset.recovery='failed';toast('本机恢复缓存不可用，请及时点击“保存”写入项目文件。',true);}projectFiles?.status();},400);clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,220);}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function filename(){return (project.meta.product+'_'+project.meta.title+'_'+project.meta.version).replace(/[\\/:*?"<>|]/g,'_');}
function drawMarks(ctx,marks,w,h){for(const m of marks||[]){const x=m.x*w,y=m.y*h,x2=m.x2*w,y2=m.y2*h;ctx.strokeStyle=m.color||'#e22d32';ctx.fillStyle=m.color||'#e22d32';ctx.lineWidth=Math.max(2,w/260);ctx.lineCap='round';if(m.type==='rect'){ctx.strokeRect(Math.min(x,x2),Math.min(y,y2),Math.abs(x2-x),Math.abs(y2-y));}else if(m.type==='line'){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();}else if(m.type==='arrow'){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();const a=Math.atan2(y2-y,x2-x),size=Math.max(9,w/35);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-size*Math.cos(a-.48),y2-size*Math.sin(a-.48));ctx.lineTo(x2-size*Math.cos(a+.48),y2-size*Math.sin(a+.48));ctx.closePath();ctx.fill();}else if(m.type==='circle'){ctx.beginPath();ctx.ellipse((x+x2)/2,(y+y2)/2,Math.max(1,Math.abs(x2-x)/2),Math.max(1,Math.abs(y2-y)/2),0,0,Math.PI*2);ctx.stroke();}else if(m.type==='text'){const size=w*(Number(m.fontSize)||1/28);ctx.font=`600 ${size}px "Microsoft YaHei",sans-serif`;const t=String(m.text||'标注');const tw=ctx.measureText(t).width;if(m.background!=='transparent'){ctx.fillStyle=m.background||'#fff7b7';const pad=w/200;ctx.fillRect(x-pad,y-size,tw+pad*2,size*1.4);}ctx.fillStyle=m.color||'#e22d32';ctx.fillText(t,x,y);}}}
async function loadImage(data){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('无法读取图片，请使用 PNG、JPEG 或 WebP。'));im.src=data;});}
async function annotated(photo){
 if(!photo.marks?.length)return photo.data;
 const key=photo.data+'|'+JSON.stringify(photo.marks);
 if(imageCache.has(key))return imageCache.get(key);
 const im=await loadImage(photo.data),canvas=document.createElement('canvas');
 const scale=Math.min(1,window.SOP_OBJECTS.photoMaxEdge/Math.max(im.naturalWidth,im.naturalHeight));
 canvas.width=Math.max(1,Math.round(im.naturalWidth*scale));
 canvas.height=Math.max(1,Math.round(im.naturalHeight*scale));
 const context=canvas.getContext('2d');
 if(!context)throw Error('无法显示图片标注。');
 context.drawImage(im,0,0,canvas.width,canvas.height);
 drawMarks(context,photo.marks,canvas.width,canvas.height);
 const result=window.SOP_OBJECTS.encodePhotoCanvas(canvas,photo.data);
 imageCache.set(key,result);
 if(imageCache.size>150)imageCache.delete(imageCache.keys().next().value);
 return result;
}
function projectForStorage(source){
 return {...source,pages:source.pages.map(page=>{
  const saved={...page,photos:page.photos.map(({rendered,...photo})=>rendered&&rendered!==photo.data&&!photo.marks?.length?{...photo,rendered}:photo)};
  for(const field of ['canvas','canvasDraft']){
   const model=page[field];
   if(!model?.objects?.some(object=>object.type==='photo'&&object.rendered===object.data))continue;
   saved[field]={...model,objects:model.objects.map(object=>{
    if(object.type!=='photo'||object.rendered!==object.data)return object;
    const {rendered,...photo}=object;
    return photo;
   })};
  }
  return saved;
 })};
}
function canvasText(p,key){
 if(key==='requirements'&&!p.requirements.trim())return '';
 const heading=key==='steps'?'一、操作步骤：':'二、工艺技术要求：';
 const text=p[key].trim()?bodyLines(p,key).map(runs=>styledParagraph(p,key,runs)).join(''):'';
 const label=key==='steps'?'操作步骤':'工艺技术要求';
 return '<section class="op-text-section"'+(p[key].trim()?' data-print-part="'+key+'" data-print-label="'+label+'"':'')+'><h3>'+heading+'</h3>'+text+'</section>';
}
function canvasSpace(p,model=p.canvas){
 const host=$('#measureRoot'),wide=A.layout==='wide-v2',mm=25.4/1440;
 const {operationContentWidthTwips,operationHeightTwips,operationSidePaddingTwips}=T.dimensions;
 const widthMm=wide?(operationContentWidthTwips+2*operationSidePaddingTwips)*mm:273.05*.474,heightMm=wide?operationHeightTwips*mm:122;
 const sidePad=wide?operationSidePaddingTwips*mm:2,verticalPad=wide?0:2;
 host.innerHTML='<div class="op-cell'+(wide?' reference-measure':'')+'" style="display:flow-root;width:'+widthMm+'mm;padding:'+verticalPad+'mm '+sidePad+'mm"><div>'+canvasText(p,'steps')+canvasText(p,'requirements')+'</div></div>';
 const box=host.firstElementChild,inner=box.firstElementChild,style=getComputedStyle(box);
 const width=box.getBoundingClientRect().width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
 const available=Math.max(0,(heightMm-verticalPad*2)*96/25.4-inner.getBoundingClientRect().height-2);
 host.replaceChildren();
 return {height:available*(model?.width||900)/width,pixels:available,textOverflow:available<=0};
}
function operationPhotos(photos){
 const tags=photo=>'<img src="'+esc(photo.rendered||photo.data)+'" alt="'+esc(photo.caption||'作业图片')+'"><figcaption>'+esc(photo.caption||'')+'</figcaption>';
 if(!photos.length)return '';
 if(A.layout!=='wide-v2')return '<div class="op-images">'+photos.map(photo=>'<figure class="op-image">'+tags(photo)+'</figure>').join('')+'</div>';
 const width=(T.dimensions.operationContentWidthTwips/20-15.75)/2;
 const figure=(photo,index)=>{
  const originalWidth=Number(photo.width)||1,originalHeight=Number(photo.height)||1;
  const ratio=Math.min(width/originalWidth,105/originalHeight);
  return '<figure class="op-image" data-print-part="photos.'+index+'" data-print-label="作业配图 '+(index+1)+'" style="width:'+(originalWidth*ratio)+'pt;--photo-height:'+(originalHeight*ratio)+'pt">'+tags(photo)+'</figure>';
 };
 return Array.from({length:Math.ceil(photos.length/2)},(_,i)=>'<div class="reference-photo-row">'+photos.slice(i*2,i*2+2).map((photo,j)=>figure(photo,i*2+j)).join('')+'</div>').join('');
}
function operationPhotoLayout(photos){
 const host=$('#measureRoot'),width=T.dimensions.operationContentWidthTwips/20;
 host.innerHTML='<div class="op-cell reference-measure" style="display:flow-root;padding:0;width:'+width+'pt">'+operationPhotos(photos)+'</div>';
 try{
  let index=0;
  return [...host.querySelectorAll('.reference-photo-row')].map(row=>{
   const rowBox=row.getBoundingClientRect(), style=getComputedStyle(row),pt=px=>px*.75;
   const rect=(element)=>{
    const box=element.getBoundingClientRect();
    return {x:pt(box.left-rowBox.left),y:pt(box.top-rowBox.top),width:pt(box.width),height:pt(box.height)};
   };
   const items=[...row.children].map(figure=>{
    const caption=figure.querySelector('figcaption'),captionBox=rect(caption),photo=photos[index++];
    const image=rect(figure.querySelector('img'));
    if(!captionBox.height)return {photo,image};
    const {fontSize,lineHeight}=getComputedStyle(caption),node=caption.firstChild,range=document.createRange(),lines=[];
    let start=0,lineTop=null;
    for(let offset=0;offset<node.length;){
     const next=offset+(node.data.codePointAt(offset)>0xffff?2:1);
     range.setStart(node,offset);range.setEnd(node,next);
     const box=range.getBoundingClientRect();
     if(box.width){
      if(lineTop!==null&&box.top!==lineTop){lines.push(node.data.slice(start,offset).trim());start=offset;}
      lineTop=box.top;
     }
     offset=next;
    }
    lines.push(node.data.slice(start).trim());
    return {photo,image,caption:{...captionBox,text:lines.join('\n'),fontSize:pt(parseFloat(fontSize)),lineHeight:pt(parseFloat(lineHeight))}};
   });
   return {items,height:pt(rowBox.height+parseFloat(style.marginBottom))};
  });
 }finally{host.replaceChildren();}
}
function opHtml(p){
 if(p.canvas){
  const space=canvasSpace(p);
  return '<div class="manual-op-layout">'+canvasText(p,'steps')+'<div class="page-object-content" data-print-area="canvas" style="height:'+space.pixels+'px;overflow:hidden">'+(space.height>0?window.SOP_OBJECTS.svg(p.canvas,'',false,{viewHeight:space.height}):'')+'</div>'+canvasText(p,'requirements')+'</div>';
 }
 if(window.SOP_IMPORT?.active(p))return '<div data-print-part="imported" data-print-label="导入原稿">'+window.SOP_IMPORT.preview(p)+'</div>';
 const steps=A.layout==='wide-v2'||p.steps.trim()||p.photos.length?canvasText(p,'steps'):'';
 return steps+operationPhotos(p.photos)+canvasText(p,'requirements')+(p.standardText?'<p>'+esc(p.standardText)+'</p>':'');
}
function paginateOne(p){const space=p.canvas?canvasSpace(p):null;return [{...p,...(space?{canvasHeight:space.height,canvasHeightPt:space.pixels*.75}:{}),fitSinglePage:false,fitScale:1,importedPreviewScale:1,manualSinglePage:true,sourceId:p.id,fragment:0,id:p.id+':0',standardText:window.SOP_IMPORT?.active(p)||A.layout==='wide-v2'?'':project.settings.standardText||''}];}
function uniqueProcesses(pages=layout){const ids=new Set();return pages.filter(p=>{if(ids.has(p.processId))return false;ids.add(p.processId);return true;});}
function recalc(){
 layout=project.pages.flatMap(p=>paginateOne(p));
 front=[];
 if(project.settings.cover)front.push({kind:'cover'});
 if(project.settings.history)front.push({kind:'history'});
 if(project.settings.flow){
  const count=(project.originalFront?.flow&&project.frontContent?.flowMode!=='editable')||project.frontContent?.flowGraph?1:Math.max(1,Math.ceil(flowNodes().length/24));
  for(let i=0;i<count;i++)front.push({kind:'flow',chunk:i});
 }
 layout=orderedPages().filter(entry=>entry.kind==='body').map(entry=>entry.page);
 const numbers=T.numberProcesses(layout),seen=new Set();
 for(const [index,page] of layout.entries()){
  Object.assign(page,numbers.get(page.processId));
  page.isContinuation=seen.has(page.processId);
  seen.add(page.processId);
  page.bodyNo=page.pageNo=index+1;
  page.total=layout.length;
 }
 $('#measureRoot').replaceChildren();
}
function metadataTitle(){return [project.meta.product,project.meta.title].filter(Boolean).join(' ');}
function paperChrome(inner,cls=''){return `<article class="paper ${cls}"><div class="confidential">${esc(window.SOP_IMPORT.confidentialityText(project.settings))}</div>${inner}<div class="copyright">${esc(project.settings.copyright)}</div></article>`;}
function logoHtml(){return project.settings.showLogo!==false&&project.settings.logo?`<img src="${esc(project.settings.logo)}" alt="公司 Logo">`:'';}
function operationPaper(p){if(A.layout==='wide-v2'){
 const canvasOverflow=p.canvas&&window.SOP_OBJECTS.contentHeight(p.canvas)>(p.canvasHeight??canvasSpace(p).height);
 return T.operationPaper(p,project,opHtml(p),canvasOverflow);
}const m=project.meta;const mats=[...p.materials];while(mats.length<4)mats.push({});const checks=[...p.checks];while(checks.length<2)checks.push({});const sign=(name)=>esc(name)+(m.date?'<br>'+esc(m.date):'');return paperChrome(`<div class="doc-head"><div>${logoHtml()}</div><div>${esc(metadataTitle())}</div><div class="doc-fields"><div><b>工艺文件编号</b><span>${esc(m.number)}</span></div><div><b>工序作业名称</b><span>${esc(p.name)}${p.isContinuation?'（续）':''}</span></div></div><div class="doc-pages"><div>共 ${p.total} 页</div><div>第 ${p.pageNo} 页</div></div></div><div class="doc-labels"><div>工序号</div><div>工位号</div><div>工序作业内容</div><div>工装、工具、设备</div></div><div class="doc-body"><div class="doc-vertical"><div class="station-number">${esc(T.operationLabel(p))}</div><div class="station-foot"><div>工时</div><div>${esc(p.duration)}</div></div></div><div class="doc-vertical"><div class="station-number">${esc(T.stationLabel(p))}</div><div class="station-foot"><div>人力</div><div>${esc(p.people)}</div></div></div><div class="op-cell">${opHtml(p)}</div><div class="doc-right"><table class="doc-table materials"><colgroup><col style="width:10%"><col style="width:39%"><col style="width:34%"><col style="width:17%"></colgroup><tr><th>序号</th><th>编码＋名称</th><th>图号或规格</th><th>备注</th></tr>${mats.map((r,i)=>`<tr><td>${r.name?i+1:''}</td><td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td>${esc(r.qty)}</td></tr>`).join('')}</table><table class="doc-table checks"><tr><th>序号</th><th>控制特性</th><th>技术要求</th><th>生产自检</th><th>质量抽检</th><th>重要度</th><th>管理手段</th></tr>${checks.map((r,i)=>`<tr><td>${r.feature?i+1:''}</td><td>${esc(r.feature)}</td><td>${esc(r.standard)}</td><td>${esc(r.self)}</td><td>${esc(r.audit)}</td><td>${esc(r.importance)}</td><td>${esc(r.method)}</td></tr>`).join('')}</table><div class="doc-notes">备注：${esc(p.notes)}</div><div class="doc-legend">${esc(project.settings.importance)}</div><div class="doc-legend">${esc(project.settings.management)}</div></div></div><div class="doc-sign"><div class="revision-box"><span>序号</span><span>标记</span><span>处数</span><span>更改文件号</span><span>签字（日期）</span></div><div><table class="sign-table"><tr><td>编制（日期）</td><td>审核（日期）</td><td>批准（日期）</td><td>版本号</td></tr><tr><td>${sign(m.author)}</td><td>${sign(m.reviewer)}</td><td>${sign(m.approver)}</td><td>${esc(m.version)}</td></tr></table></div></div>`);}
function flowNodes(){return project.frontContent?.flowManual?String(project.frontContent.flowText||'').split('\n').filter(x=>x.trim()).map(name=>({name})):uniqueProcesses().filter(p=>p.name.trim());}
function flowImage(chunk=0){const all=flowNodes(),ps=all.slice(chunk*24,chunk*24+24),c=document.createElement('canvas');c.width=1500;c.height=850;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#333';ctx.fillStyle='#111';ctx.lineWidth=2;ctx.font='22px Microsoft YaHei';const rows=Math.min(8,Math.max(1,ps.length)),colWidth=460,boxW=380,boxH=58,dy=96;
 if(ps.length)ctx.translate((c.width-(Math.ceil(ps.length/8)-1)*colWidth-boxW)/2-45,(c.height-(rows-1)*dy-boxH)/2-35);
 ps.forEach((p,i)=>{const col=Math.floor(i/8),row=i%8,x=45+col*colWidth,y=35+row*dy;ctx.strokeRect(x,y,boxW,boxH);ctx.textAlign='center';const label=T.operationLabel(p,chunk*24+i+1)+'. '+p.name;let text=label;while(ctx.measureText(text).width>boxW-20&&text.length>1)text=text.slice(0,-2)+'…';ctx.fillText(text,x+boxW/2,y+36);if(i<ps.length-1){let tx=x+boxW/2,ty=y+boxH,nx=tx,ny=y+dy;if(row===7){tx=x+boxW;ty=y+boxH/2;nx=x+colWidth+boxW/2;ny=35;}ctx.beginPath();ctx.moveTo(tx,ty);if(row===7){ctx.lineTo(x+colWidth-30,ty);ctx.lineTo(x+colWidth-30,64);ctx.lineTo(nx-190,64);ctx.stroke();ctx.beginPath();ctx.moveTo(nx-190,64);ctx.lineTo(nx-201,58);ctx.lineTo(nx-201,70);}else{ctx.lineTo(nx,ny);ctx.stroke();ctx.beginPath();ctx.moveTo(nx,ny);ctx.lineTo(nx-6,ny-11);ctx.lineTo(nx+6,ny-11);}ctx.closePath();ctx.fill();}});return c.toDataURL('image/png');}
function flowNoteText(){return window.SOP_WORD?.flowNoteText(project)??'注：□表示一般操作，◇表示检查及测试。★代表关键工序，▲代表特殊工序';}
function frontPaper(f){
 const c=project.frontContent||{},original=project.originalFront?.[f.kind];
 if(original&&c[f.kind+'Mode']!=='editable'){
  const blocks=f.kind==='cover'?window.SOP_WORD.originalCoverPreview(project):original.previewBlocks||original.blocks;
  if(blocks)return T.originalPaper(project,f.kind,window.SOP_IMPORT.preview({importedContent:{blocks}}),f.kind==='flow'?flowNoteText():undefined);
 }
 if(f.kind==='cover')return T.coverPaper(project);
 if(f.kind==='history')return T.historyPaper(project);
 const chart=c.flowGraph
  ?window.SOP_OBJECTS.svg(window.SOP_OBJECTS.resolvedFlow(c.flowGraph,project.pages),'',false,{centerContent:true})
  :'<img class="flow-img" src="'+flowImage(f.chunk)+'" alt="按工序顺序生成的流程图">';
 return T.flowPaper(project,chart,flowNoteText(),f.chunk);
}
function issuePageTitle(entry,index){
 const page=entry.page;
 return '文档第 '+(index+1)+' 页 · '+(entry.kind==='body'
  ? '工序 '+T.operationLabel(page)+' '+(page.name||'未命名工序')+(page.isContinuation||page.fragment?'（续）':'')
  : frontNames[entry.kind]+(page.chunk?'（续 '+(page.chunk+1)+'）':''));
}
function issueReport(entry,index,findings){return {key:entry.key,title:issuePageTitle(entry,index),findings,revision};}
function renderIssueList(host,reports){
 host.replaceChildren();
 host.hidden=!reports.length;
 if(!reports.length)return;
 const alert=document.createElement('section');
 alert.className='preview-issues';
 alert.setAttribute('aria-label','超框明细');
 alert.innerHTML='<p>请调整超框内容后再导出。选择下方项目可定位到编辑处。</p>';
 const groups=document.createElement('ul');
 alert.append(groups);
 for(const report of reports){
  const group=document.createElement('li'),heading=document.createElement('strong'),list=document.createElement('ul');
  heading.textContent=report.title;
  group.append(heading,list);
  groups.append(group);
  for(const finding of report.findings){
   const item=document.createElement('li'),button=document.createElement('button');
   button.type='button';
   button.className='preview-issue-button';
   button.dataset.issueTarget=finding.target;
   button.dataset.issuePage=report.key;
   button.textContent=finding.message;
   button.setAttribute('aria-label',report.title+' · '+finding.message);
   button.onclick=()=>locateIssue(report,finding);
   item.append(button);
   list.append(item);
  }
 }
 host.append(alert);
}

let highlightedIssue,issueHighlightTimer;
function clearIssueHighlight(){
 clearTimeout(issueHighlightTimer);
 highlightedIssue=undefined;
 $('#previewStage .reference-issue-focus')?.classList.remove('reference-issue-focus');
}
const issueSelector=(attribute,value)=>'['+attribute+'="'+CSS.escape(String(value))+'"]';
function highlightIssue(paper,entry,findings){
 if(!highlightedIssue||highlightedIssue.pageKey!==entry.key)return;
 const finding=findings.find(item=>item.target===highlightedIssue.target);
 if(!finding){clearIssueHighlight();return;}
 let area=paper.querySelector('[data-print-box]'+issueSelector('data-print-target',finding.area))||paper.querySelector(issueSelector('data-print-area',finding.area));
 if(finding.area==='canvas'&&!area?.offsetHeight)area=paper.querySelector('.op-cell');
 const detail=area?.querySelector(issueSelector('data-print-part',finding.target));
 const detailBounds=detail?.getBoundingClientRect(),areaBounds=area?.getBoundingClientRect();
 const visible=detailBounds&&detailBounds.width>0&&detailBounds.bottom>areaBounds.top&&detailBounds.top<areaBounds.bottom;
 const marker=visible&&detail instanceof HTMLElement&&getComputedStyle(detail).display!=='inline'?detail:area;
 marker?.classList.add('reference-issue-focus');
}
function focusIssueControl(input){
 if(!input||input.disabled)return false;
 input.scrollIntoView({block:'center'});
 input.focus({preventScroll:true});
 return document.activeElement===input;
}
function issueEditorControl(entry,finding){
 const [group,key,field]=finding.target.split('.');
 const find=(attribute,value)=>$(issueSelector(attribute,value));
 const editor=(attribute,value)=>$('#editContent '+issueSelector(attribute,value));
 const locked=field=>editor('data-pin',field);
 const settings=()=>{focusIssueControl($('#settingsBtn'));editSettings();return find('data-setting',key);};
 const frontField=(target,name)=>$('#editContent '+issueSelector('data-front-target',target)+issueSelector('data-front-key',name));
 if(group==='settings')return entry.kind==='cover'&&frontField('settings',key)||settings();
 if(group==='meta'){
  const coverControl=entry.kind==='cover'&&(frontField('meta',key)||editor('data-original-meta',key));
  if(coverControl)return coverControl;
  focusIssueControl($('#metaBtn'));
  editMetadata();
  return find('data-docmeta',key);
 }
 if(group==='front')return frontField('front',key)||(key==='flowNote'?$('#flowNoteInput'):null)||$('#convertFront');
 if(group==='original')return $('#convertFront');
 const rowFields={material:['data-material','data-key','data-remove-material','materials'],check:['data-check','data-key','data-remove-check','checks'],change:['data-change-row','data-change-key','data-remove-change'],history:['data-history-row','data-history-key','data-delete-history']};
 if(Object.hasOwn(rowFields,group)){
  const [rowAttribute,fieldAttribute,removeAttribute,pin]=rowFields[group];
  if(pin&&entry.page.fixed.includes(pin))return locked(pin);
  if(!field)return editor(removeAttribute,key);
  return $('#editContent '+issueSelector(rowAttribute,key)+issueSelector(fieldAttribute,field));
 }
 if(group==='signoff')return entry.page.fixed.includes('signoff')?locked('signoff'):editor('data-signoff',key);
 if(group==='steps'||group==='requirements')return entry.page.fixed.includes(group)?locked(group):$('#'+group+'Input');
 if(group==='photos')return entry.page.fixed.includes('photos')?locked('photos'):$$('#photoGrid .photo-card')[Number(key)]?.querySelector('button[data-edit-photo]');
 if(group==='canvas')return entry.page.fixed.includes('photos')?locked('photos'):$('#editPageCanvas');
 const ids={name:'nameInput',processLabel:'processLabelInput',notes:'notesInput'};
 if(Object.hasOwn(ids,group))return $('#'+ids[group]);
 if(['station','duration','people'].includes(group))return editor('data-meta',group);
 return null;
}
function locateIssue(report,finding){
 const pageKey=report.key,entry=orderedPages().find(item=>item.key===pageKey);
 for(const id of ['#previewDialog','#exportIssuesDialog'])if($(id).open)$(id).close();
 if(!entry||report.revision!==revision){
  refresh();
  focusIssueControl($('#previewCaption'));
  toast('页面内容已更新，请选择最新的超框明细。',true);
  return;
 }
 if(entry.kind==='body'){
  selected=entry.page.sourceId;
  if(entry.page.isContinuation||entry.page.fragment)$('#pageView').click();
  const group=finding.target.split('.')[0];
  setEditorTab(['material','check','change','notes','signoff'].includes(group)?'quality':'content');
 }else selected=entry.key;
 renderEditor();
 clearIssueHighlight();
 highlightedIssue={pageKey,target:finding.target};
 refresh();
 issueHighlightTimer=setTimeout(clearIssueHighlight,7000);
 if(focusIssueControl(issueEditorControl(entry,finding)))return;
 focusIssueControl($('#editorTitle'));
 toast(finding.label+'没有独立编辑入口，请核对预览中标出的区域。',true);
}

function mountPaper(host,html,width,entry,index,showIssues=false){
 const previousTarget=host.contains(document.activeElement)?document.activeElement.dataset.issueTarget:undefined;
 host.innerHTML='<div class="page-frame">'+html+'</div>';
 const frame=host.firstElementChild,paper=frame.firstElementChild,scale=Math.min(1,width/1122.52);
 const findings=T.printIssues(paper);
 paper.style.transform='scale('+scale+')';
 frame.style.width=(1122.52*scale)+'px';
 frame.style.height=(793.7*scale)+'px';
 if(showIssues&&findings.length){
  const list=document.createElement('div');
  renderIssueList(list,[issueReport(entry,index,findings)]);
  frame.before(list);
 }
 if(showIssues)highlightIssue(paper,entry,findings);
 if(previousTarget) (host.querySelector(issueSelector('data-issue-target',previousTarget))||$('#previewCaption')).focus({preventScroll:true});
 return findings;
}

const frontNames={cover:'封面',history:'修改履历',flow:'工艺流程图'};
const frontKey=f=>'front:'+f.kind+':'+(f.chunk||0);
const bodyKey=p=>'body:'+p.sourceId+':'+p.fragment;
function orderedPages(){const all=[...front.map(f=>({kind:f.kind,key:frontKey(f),page:f})),...layout.map(p=>({kind:'body',key:bodyKey(p),page:p}))],map=new Map(all.map(x=>[x.key,x])),result=[];for(const key of project.pageOrder||[]){if(map.has(key)){result.push(map.get(key));map.delete(key);}}for(const entry of all)if(map.has(entry.key)){const previous=all.slice(0,all.indexOf(entry)).reverse().find(x=>x.kind===entry.kind&&result.some(r=>r.key===x.key));if(previous&&(entry.kind==='body'||entry.page.chunk))result.splice(result.findIndex(x=>x.key===previous.key)+1,0,entry);else result.push(entry);map.delete(entry.key);}return result;}
function selectedDocumentIndex(){return orderedPages().findIndex(x=>x.kind==='body'?x.page.sourceId===selected:x.key===selected);}
function refreshNav(){
 const nav=$('#navList'),byProcess=view==='process',seen=new Set();
 const selectedProcess=byProcess?layout.find(page=>page.sourceId===selected)?.processId:undefined;
 nav.replaceChildren();
 for(const [index,entry] of orderedPages().entries()){
  const page=entry.page,isBody=entry.kind==='body',grouped=isBody&&byProcess;
  if(grouped&&seen.has(page.processId))continue;
  if(grouped)seen.add(page.processId);
  const active=grouped?page.processId===selectedProcess:isBody?page.sourceId===selected:entry.key===selected;
  const name=isBody?page.name||'未命名工序':frontNames[page.kind];
  const title=(grouped?T.operationLabel(page)+' · ':'')+name+(page.fragment||page.chunk?' · 续页':'');
  const badge=grouped?'':isBody?page.pageNo:'—';
  const button=document.createElement('button');
  button.type='button';
  button.className='nav-item'+(active?' active':'');
  if(active)button.setAttribute('aria-current','true');
  button.draggable=true;
  button.dataset.documentIndex=index;
  button.innerHTML='<span class="nav-num">'+badge+'<span class="drag-grip" aria-hidden="true">⠿</span></span>'+
   '<span class="nav-entry"><strong>'+esc(title)+'</strong><small>全文第 '+(index+1)+' 页 · '+(isBody?'工序页':'内容可编辑')+'</small></span>';
  button.onclick=()=>{
   if(isBody&&page.fragment)materialize(layout.indexOf(page));
   else selected=isBody?page.sourceId:entry.key;
   renderEditor();
   refresh();
  };
  button.ondragstart=event=>{
   event.dataTransfer.setData('text/plain','sop-document:'+index);
   event.dataTransfer.effectAllowed='move';
  };
  button.ondragover=event=>{event.preventDefault();button.classList.add('drop-before');};
  button.ondragleave=()=>button.classList.remove('drop-before');
  button.ondrop=event=>{
   event.preventDefault();
   const data=event.dataTransfer.getData('text/plain');
   if(/^sop-document:\d+$/.test(data))moveDocumentPage(Number(data.split(':')[1]),index,false,{groupProcesses:byProcess});
  };
  button.ondragend=()=>nav.querySelectorAll('.drop-before').forEach(item=>item.classList.remove('drop-before'));
  nav.append(button);
 }
}
function moveDocumentPage(from,to,swap=false,{groupProcesses=false}={}){
 recalc();
 const entries=orderedPages(),moved=entries[from],target=entries[to];
 if(!Number.isInteger(from)||!Number.isInteger(to)||!moved||!target)throw Error('请选择有效的页面位置。');
 if(from===to)return;
 let order=entries;
 if(swap){
  [order[from],order[to]]=[order[to],order[from]];
 }else{
  const group=entry=>groupProcesses&&entry.kind==='body'
   ?entries.filter(candidate=>candidate.kind==='body'&&candidate.page.processId===entry.page.processId)
   :[entry];
  const source=group(moved),destination=group(target);
  if(source.includes(target))return;
  const forward=from<to;
  const anchor=forward?destination.at(-1):destination[0];
  order=entries.filter(entry=>!source.includes(entry));
  order.splice(order.indexOf(anchor)+(forward?1:0),0,...source);
 }
 snapshot();
 for(const entry of order)if(entry.kind==='body'){
  const page=clone(entry.page);
  page.id=page.fragment?uid():page.sourceId;
  for(const key of ['sourceId','fragment','bodyNo','pageNo','total','processNo','stationNo','standardText','isContinuation'])delete page[key];
  entry.page=page;
  entry.key='body:'+page.id+':0';
 }
 project.pages=order.filter(entry=>entry.kind==='body').map(entry=>entry.page);
 project.pageOrder=order.map(entry=>entry.key);
 selected=moved.kind==='body'?moved.page.id:moved.key;
 view='page';
 $('#pageView').classList.add('active');
 $('#processView').classList.remove('active');
 renderEditor();
 changed();
 refresh();
 toast('页面顺序及全篇页码已更新。');
}
function moveRenderedPage(from,to,swap=false){recalc();const all=orderedPages();moveDocumentPage(all.findIndex(x=>x.kind==='body'&&x.page===layout[from]),all.findIndex(x=>x.kind==='body'&&x.page===layout[to]),swap);}
function openMovePage(){recalc();const all=orderedPages();if(all.length<2)return;const current=Math.max(0,selectedDocumentIndex()),options=value=>all.map((entry,i)=>'<option value="'+i+'" '+(i===value?'selected':'')+'>全文第 '+(i+1)+' 页 · '+esc(entry.kind==='body'?entry.page.name:frontNames[entry.kind])+'</option>').join('');showForm('调整页面顺序','<div class="notice">封面、履历、流程图和工序页均可任意移动或交换。</div><div class="form-grid"><label class="wide"><span>调整方式</span><select id="moveMode"><option value="move">移动到目标位置</option><option value="swap">与目标页面交换</option></select></label><label class="wide"><span>要移动的页面</span><select id="moveSource">'+options(current)+'</select></label><label class="wide"><span>移动后的最终位置</span><select id="moveDestination">'+options(current)+'</select></label></div>',()=>moveDocumentPage(Number($('#moveSource').value),Number($('#moveDestination').value),$('#moveMode').value==='swap'));$('#dialogApply').textContent='移动并更新页码';}
function materialize(index){snapshot();const all=orderedPages(),chosen=layout[index];for(const entry of all)if(entry.kind==='body'){const x=clone(entry.page);x.id=x.fragment?uid():x.sourceId;if(entry.page===chosen)selected=x.id;for(const k of ['sourceId','fragment','bodyNo','pageNo','total','processNo','stationNo','standardText','isContinuation'])delete x[k];entry.page=x;entry.key='body:'+x.id+':0';}project.pages=all.filter(x=>x.kind==='body').map(x=>x.page);project.pageOrder=all.map(x=>x.key);changed();}
function refreshRecovery(){
 let box=$('#legacyRecoveryNotice');if(!box){box=document.createElement('div');box.id='legacyRecoveryNotice';box.className='notice';$('.editor').insertBefore(box,$('.editor-heading'));}
 const count=window.SOP_WORD?.legacyMissingCount(project)||0;box.hidden=!count;
 if(count){box.innerHTML='<strong>当前为旧版导入数据，检测到漏读 '+count+' 个工序。</strong><br>更新代码不会自动补回旧项目。恢复前会下载项目备份，已有修改和页序保留。<br><button id="recoverMissingBtn" class="primary">备份并恢复漏读工序</button>';
 $('#recoverMissingBtn').onclick=async()=>{const button=$('#recoverMissingBtn');button.disabled=true;try{const before=clone(project),result=await window.SOP_WORD.recoverMissing(before);if(!result)return;download(new Blob([JSON.stringify(before,null,2)],{type:'application/json'}),filename()+'_恢复前备份.sop.json');snapshot();project=result.project;selected=project.pages[0]?.id;await prepareImages();renderEditor();changed();refresh();toast('已恢复 '+result.added+' 个漏读工序，当前前置 '+front.length+' 页＋正文 '+layout.length+' 页，共 '+(front.length+layout.length)+' 页。');}catch(e){toast('恢复失败：'+e.message,true);button.disabled=false;}};
 }
}
function refresh(){window.SOP_IMPORT.refreshBody(project).then(updated=>{if(updated)refresh();});if(window.SOP_WORD?.refreshOriginalCover)Promise.all(['cover','flow'].map(kind=>window.SOP_WORD.refreshOriginalCover(project,kind))).then(updated=>{if(updated.some(Boolean))refresh();});refreshRecovery();$('#brandLogo').src=A.appLogo||A.logo;recalc();if(!project.pages.find(p=>p.id===selected)&&!front.some(f=>frontKey(f)===selected))selected=project.pages[0]?.id;$('#projectTitle').textContent=metadataTitle();$('#pageCount').textContent=layout.length+' 工序页';refreshNav();const selectedFront=front.find(f=>frontKey(f)===selected);const p=layout.find(x=>x.sourceId===selected);refreshProcessNumberWarning(p);$('#copyBtn').disabled=!!selectedFront;$('#continueBtn').disabled=!!selectedFront;const index=selectedDocumentIndex(),entry=orderedPages()[index];$('#wordProofBtn').hidden=entry?.kind!=='body';if(highlightedIssue?.pageKey!==entry?.key)clearIssueHighlight();if(entry)mountPaper($('#previewStage'),paperFor(entry),$('#previewStage').clientWidth,entry,index,true);$('#previewStage').ondblclick=event=>{if(event.target.closest('.preview-issues'))return;const entry=selectedFront?$('#editFlowGraph'):$('#editPageCanvas');entry?.click();};$('#previewCaption').textContent=selectedFront?'文档位置 '+(selectedDocumentIndex()+1)+' · 不计工序页码':p?`第 ${p.pageNo} 页 / 共 ${p.total} 页`:'尚未添加工序';if(!entry)$('#previewStage').innerHTML='<div class="empty-state">添加一道工序开始编写</div>';$('#layoutHint').textContent=selectedFront?'内容、顺序均可修改；导出时保持当前页序。':p?'固定单页 · 不自动缩放或续页，超框或遮挡请手动调整。':'';if(p?.canvas){const available=canvasSpace(p).height;$('#layoutHint').textContent=available<=0?'文字已占满内容框，请先调整文字。':window.SOP_OBJECTS.contentHeight(p.canvas)>available?'画布使用文字之外的剩余空间；有元素超出区域，请手动调整。':'文字保留完整高度，剩余区域用于画布；不自动缩放或续页。';}$('#undoBtn').disabled=!undo.length;}
function pin(field){const p=page();if(!p)return;snapshot();if(field==='contentStyle'&&!p.fixed.includes(field))p.contentStyle=textStyle(p,'steps');p.fixed=p.fixed||[];p.fixed=p.fixed.includes(field)?p.fixed.filter(x=>x!==field):[...p.fixed,field];renderEditor();changed();}
function applySignoffToAll(){
 const current=page();
 if(!current?.fixed.includes('signoff'))return;
 snapshot();
 project.signoffDefault=clone(current.signoff);
 for(const operation of project.pages){
  operation.signoff=clone(project.signoffDefault);
  if(!operation.fixed.includes('signoff'))operation.fixed.push('signoff');
 }
 renderEditor();changed();refresh();
 toast('已更新 '+project.pages.length+' 张工序页，新增工序页将沿用此设置。');
}
function bindInput(el,cb,{snapshotOnEdit=false}={}){
 let firstEdit=true;
 el.addEventListener('focus',()=>{if(snapshotOnEdit)firstEdit=true;else snapshot();});
 el.addEventListener('input',event=>{
  if(snapshotOnEdit&&firstEdit){snapshot();firstEdit=false;}
  cb(event.target.value);
  changed();
 });
}
function fieldTop(label,key){const text=['steps','requirements'].includes(key);return `<div class="field-top"><strong>${label}</strong><button class="pin ${page().fixed.includes(key)?'pinned':''}" data-pin="${key}">${page().fixed.includes(key)?(text?'● 文字已固定 · 解锁':'● 已固定沿用 · 解锁'):(text?'固定文字':'设为固定沿用')}</button></div>`;}

function configureFlow(){
 const content=project.frontContent||{},saved=content.flowSetup;
 const pages=new Map();
 for(const page of project.pages)if(!pages.has(page.processId))pages.set(page.processId,page);
 const rows=(saved?.rows||[]).filter(row=>!row.processId||pages.has(row.processId)).map(row=>({...row}));
 for(const [key,page] of pages)if(!rows.some(row=>row.processId===key))rows.push({key,processId:key,name:page.name,role:'main'});
 const name=row=>row.processId?pages.get(row.processId).name:row.name;
 showForm('配置工艺流程图',`
  <div class="flow-config">
   <p>主工序依表中顺序连线。预装支线请选择汇入位置，跨列连接会从列间绕行。</p>
   <div class="flow-config-toolbar"><label>列数 <select id="flowColumns">${['自动',1,2,3,4,5,6].map((v,i)=>`<option value="${i}" ${i===(saved?.columns||0)?'selected':''}>${v}</option>`).join('')}</select></label><button type="button" id="flowAddStep">＋ 添加独立步骤</button></div>
   <table><thead><tr><th>工序或步骤</th><th>类型</th><th>汇入到此工序之前</th><th>进线标签</th><th>关键</th><th>形状</th><th>顺序</th></tr></thead><tbody id="flowConfigRows"></tbody></table>
   <div id="flowConfigError" role="alert"></div>
  </div>`,null);
 const body=$('#flowConfigRows'),apply=$('#dialogApply'),dialog=$('#formDialog');
 function draw(focus){
  const targets=rows.filter(row=>row.role==='main');
  body.innerHTML=rows.map((row,i)=>`<tr data-flow-row="${i}">
   <td>${row.processId?esc(name(row)):`<input data-flow-key="name" aria-label="步骤名称" value="${esc(row.name)}">`}</td>
   <td><select data-flow-key="role" aria-label="步骤类型">${[['main','主工序'],['branch','预装支线'],['omit','不显示']].map(([value,label])=>`<option value="${value}" ${row.role===value?'selected':''}>${label}</option>`).join('')}</select></td>
   <td>${row.role==='branch'?`<select data-flow-key="target" aria-label="汇入工序"><option value="">请选择</option>${targets.map(target=>`<option value="${esc(target.key)}" ${row.target===target.key?'selected':''}>${esc(name(target)||'独立步骤')}</option>`).join('')}</select>`:'—'}</td>
   <td><input data-flow-key="label" aria-label="进线标签" placeholder="如 Y" value="${esc(row.label||'')}" ${row.role==='omit'?'disabled':''}></td>
   <td><input type="checkbox" data-flow-key="star" aria-label="关键工序" ${row.star?'checked':''}></td>
   <td><select data-flow-key="shape" aria-label="节点形状">${Object.entries(window.SOP_OBJECTS.flowShapes).map(([value,label])=>`<option value="${value}" ${row.shape===value?'selected':''}>${label}</option>`).join('')}</select></td>
   <td><div class="flow-config-order"><button type="button" data-flow-move="-1" aria-label="上移" ${i===0?'disabled':''}>↑</button><button type="button" data-flow-move="1" aria-label="下移" ${i===rows.length-1?'disabled':''}>↓</button>${row.processId?'':'<button type="button" data-flow-delete aria-label="删除独立步骤">×</button>'}</div></td>
  </tr>`).join('');
  if(focus!=null)body.querySelector(`[data-flow-row="${focus}"] [data-flow-key="name"]`)?.focus();
 }
 body.oninput=event=>{
  const key=event.target.dataset.flowKey;
  if(!key)return;
  const row=rows[Number(event.target.closest('tr').dataset.flowRow)];
  row[key]=key==='star'?event.target.checked:event.target.value;
  if(key==='role')draw();
  if(key==='name')for(const option of body.querySelectorAll('[data-flow-key="target"] option')){
   if(option.value===row.key)option.textContent=row.name||'独立步骤';
  }
 };
 body.onclick=event=>{
  const button=event.target.closest('button');
  if(!button)return;
  const i=Number(button.closest('tr').dataset.flowRow),row=rows[i];
  const offset=Number(button.dataset.flowMove);
  if(offset){rows.splice(i,1);rows.splice(i+offset,0,row);}
  if(button.hasAttribute('data-flow-delete'))rows.splice(i,1);
  draw();
 };
 $('#flowAddStep').onclick=()=>{rows.push({key:uid(),name:'',role:'main'});draw(rows.length-1);};
 apply.hidden=false;
 apply.textContent='生成预览';
 apply.onclick=()=>{
  const columns=Number($('#flowColumns').value),configured=rows.map(row=>({...row,name:name(row).trim()}));
  try{
   if(configured.some(row=>row.role!=='omit'&&!row.name))throw Error('请填写独立步骤的名称。');
   const graph=window.SOP_OBJECTS.generateFlow(configured,columns);
   window.SOP_OBJECTS.open(graph,{title:'流程图生成预览',flow:true,preview:true,onSave:value=>{
    snapshot();
    project.frontContent={...project.frontContent,flowSetup:{rows:configured,columns},flowGraph:value,flowMode:'editable'};
    dialog.close();renderEditor();changed();refresh();
   }});
  }catch(error){$('#flowConfigError').textContent=error.message;}
 };
 draw();
}

const coverMetaFields=[['product','产品型号'],...T.coverFields,...T.coverSigners];
function renderFrontEditor(kind){$('.tabs').hidden=true;if(project.originalFront?.[kind]&&project.frontContent?.[kind+'Mode']!=='editable'){const host=$('#editContent');$('#editorTitle').textContent=frontNames[kind];$('#selectedContext').textContent='原稿保留 · 不计工序页码';host.innerHTML='<div class="notice"><strong>当前使用导入原稿</strong><p>原始 Word 对象与版式已单独保留。修改工序、文档信息或排序不会替换此页。浏览器仅尽力显示原图文，复杂分组、特殊图形及字体请在 Word/WPS 核对；本预览未生成替代顺序图。</p><p>原稿封面的编号、名称、版本、日期和左侧姓名可局部修改。右侧签字栏留作打印后手写。未知布局请在导出后核对；重排副本和原始 Word 分别保留。</p></div><button id="downloadOriginalWord">导出保留原始 Word</button><button id="convertFront" class="primary">'+(kind==='flow'?'建立可编辑流程副本':'建立版式编辑副本')+'</button>';if(kind==='cover'){host.insertAdjacentHTML('beforeend', [['number','文件编号'],['product','产品型号'],['title','文件名称'],['bare','裸机成品料号'],['packed','包装成品料号'],['version','版本'],['date','生效日期'],['author','制定'],['reviewer','审核'],['approver','批准'],['qualitySigner','质量会签'],['productionSigner','生产会签']].map(([key,label])=>'<label class="field"><span>'+label+'</span><input data-original-meta="'+key+'" value="'+esc(project.meta[key]||'')+'"></label>').join(''));host.querySelectorAll('[data-original-meta]').forEach(input=>bindInput(input,value=>project.meta[input.dataset.originalMeta]=value));}if(kind==='flow'){host.insertAdjacentHTML('beforeend','<label class="field"><span>流程图下方说明栏</span><textarea id="flowNoteInput" rows="3">'+esc(flowNoteText())+'</textarea></label>');bindInput($('#flowNoteInput'),value=>{project.frontContent={...project.frontContent,flowNote:value};});host.insertAdjacentHTML('beforeend','<button id="seedFlowGraph">配置并生成</button>');$('#seedFlowGraph').onclick=configureFlow;}$('#downloadOriginalWord').onclick=async()=>{try{download(await window.SOP_WORD.exportOriginal(project),filename()+'_原始Word.docx');}catch(err){toast(err.message,true);}};$('#convertFront').onclick=()=>{snapshot();project.frontContent={...project.frontContent,[kind+'Mode']:'editable'};if(kind==='flow'&&!project.frontContent.flowGraph){const converted=window.SOP_WORD.convertOriginalFlow(project);project.frontContent.flowGraph=converted.model;project.frontContent.flowConversion=converted.notice;}renderEditor();changed();refresh();};return;}const e=$('#editContent'),c=project.frontContent||{},m=project.meta;$('#editorTitle').textContent=frontNames[kind];$('#selectedContext').textContent='整页内容可编辑 · 可拖动或移动到任意位置';const field=(label,key,value,target='front')=>'<label class="field"><span>'+label+'</span><input data-front-target="'+target+'" data-front-key="'+key+'" value="'+esc(value)+'"></label>';
 if(kind==='cover'){e.innerHTML=field('页眉标题','coverHeading',c.coverHeading??'三阶文件')+field('公司名称','company',project.settings.company,'settings')+coverMetaFields.map(([key,label])=>field(label,key,m[key]||'','meta')).join('');}
 else if(kind==='history'){e.innerHTML=field('页面标题','historyTitle',c.historyTitle??'文件修改履历')+'<div class="notice">直接修改、添加或删除履历。每页最多 15 条记录。</div><div id="frontHistoryRows"></div><button id="addHistoryRow">＋ 添加履历</button>';const host=$('#frontHistoryRows');project.history.forEach((row,i)=>{const div=document.createElement('div');div.className='notice';div.innerHTML='<strong>履历 '+(i+1)+'</strong>'+T.historyFields.map(([key,label])=>'<label><span>'+label+'</span><input data-history-row="'+i+'" data-history-key="'+key+'" value="'+esc(row[key])+'"></label>').join('')+'<button data-delete-history="'+i+'">删除此条</button>';host.append(div);});$$('[data-history-row]').forEach(input=>bindInput(input,value=>project.history[Number(input.dataset.historyRow)][input.dataset.historyKey]=value));$$('[data-delete-history]').forEach(button=>button.onclick=()=>{snapshot();project.history.splice(Number(button.dataset.deleteHistory),1);renderFrontEditor(kind);changed();refresh();});$('#addHistoryRow').onclick=()=>{if(project.history.length>=15)return toast('此页最多 15 条，请归档后再添加。');snapshot();project.history.push({});renderFrontEditor(kind);changed();refresh();};}
 else{e.innerHTML=field('页面标题','flowTitle',c.flowTitle??'工艺流程图')+'<label class="field"><span>流程图下方说明栏</span><textarea id="flowNoteInput" rows="3" data-front-target="front" data-front-key="flowNote">'+esc(flowNoteText())+'</textarea></label><div class="notice">可按主工序和预装支线生成流程图，也可以打开画布手动调整连线。'+esc(c.flowConversion||'')+'</div><button id="editFlowGraph" class="primary">打开流程图画布</button><button id="seedFlowGraph">配置并生成</button>';$('#editFlowGraph').onclick=()=>{try{let model=c.flowGraph&&window.SOP_OBJECTS.resolvedFlow(c.flowGraph,project.pages);if(!model)model=c.flowManual?window.SOP_OBJECTS.fromProcesses(String(c.flowText||'').split('\n').filter(Boolean).map((name,i)=>({name,processId:String(i)}))):window.SOP_OBJECTS.fromProcesses(project.pages);window.SOP_OBJECTS.open(model,{title:'流程图画布',flow:true,onSave:value=>{snapshot();project.frontContent={...project.frontContent,flowGraph:value,flowMode:'editable'};renderEditor();changed();refresh();}});}catch(error){toast(error.message,true);}};$('#seedFlowGraph').onclick=configureFlow;}
 if(project.originalFront?.[kind]){e.insertAdjacentHTML('afterbegin','<button id="useOriginalFront">切回保留的原稿</button><div class="notice">当前为工作台编辑副本。原稿仍随项目保存。</div>');$('#useOriginalFront').onclick=()=>{snapshot();project.frontContent={...project.frontContent,[kind+'Mode']:'original'};renderEditor();changed();refresh();};}
 $$('[data-front-key]').forEach(input=>bindInput(input,value=>{if(input.dataset.frontTarget==='front')project.frontContent={...project.frontContent,[input.dataset.frontKey]:value};else project[input.dataset.frontTarget][input.dataset.frontKey]=value;}));
}
function renderChangeRecords(host,p){
 const records=T.recordRows(p).slice();
 const count=Math.max(T.changeRows,records.length);
 const fields=Array.from({length:count},(_,i)=>'<fieldset class="change-record-fields"><legend>第 '+(i+1)+' 行</legend>'+T.changes.map(([key,label])=>'<label><span>'+label+'</span><input data-change-row="'+i+'" data-change-key="'+key+'" value="'+esc(records[i]?.[key])+'"></label>').join('')+(i>=T.changeRows?'<button data-remove-change="'+i+'">删除超出的行</button>':'')+'</fieldset>');
 host.innerHTML='<strong>更改记录</strong>'+fields.join('');
 host.querySelectorAll('[data-change-key]').forEach(input=>bindInput(input,value=>{
  const row=Number(input.dataset.changeRow);
  while(records.length<=row)records.push({});
  records[row]={...records[row],[input.dataset.changeKey]:value};
  p.changeRecords=records;
 }));
 host.querySelectorAll('[data-remove-change]').forEach(button=>button.onclick=()=>{
  snapshot();
  records.splice(Number(button.dataset.removeChange),1);
  p.changeRecords=records;
  renderEditor();
  changed();
 });
}
function checkChoice(index,key,value,locked){
 const choices=['','a','b','c'];
 const current=String(value??'');
 if(!choices.includes(current))choices.push(current);
 const legend=T.inspectionLegend(project.settings,key==='importance'?'importance':'management');
 const letter='[a-cａ-ｃ]',separator='[、.．:：=＝·)）-]';
 const entries=legend.replace(/^[^：:]+[：:]/,'').trim().split(new RegExp('[;；\\r\\n]+|[\\s,，、。/／]+(?='+letter+'\\s*'+separator+')','iu'));
 const mapping=new RegExp('^('+letter+')\\s*'+separator+'\\s*(.+)$','iu');
 const descriptions=Object.create(null);
 for(const entry of entries){
  const match=entry.trim().match(mapping);
  if(match)descriptions[match[1].normalize('NFKC').toLowerCase()]=match[2].replace(/[。;；,，]+$/u,'').trim();
 }
 return '<select data-check="'+index+'" data-key="'+key+'"'+(locked?' disabled':'')+'>'+
  choices.map(choice=>{
   const label=descriptions[choice]?choice+' · '+descriptions[choice]:choice||'留空';
   return '<option value="'+esc(choice)+'"'+(choice===current?' selected':'')+'>'+esc(label)+'</option>';
  }).join('')+'</select>';
}
function setEditorTab(next){
 tab=next;
 $$('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
}
function editProcessNumber(){
 if(tab!=='content'){
  setEditorTab('content');
  renderEditor();
 }
 const input=$('#processLabelInput');
 if(input?.readOnly){$('#processCategoryInput').focus();return;}
 input?.focus();
 input?.select();
}
function processCategoryOptions(category){
 return '<option value="">沿用原编号</option>'+Object.entries(T.processCategories)
  .map(([code,label])=>'<option value="'+code+'"'+(code===category?' selected':'')+'>'+label+'（'+code+'）</option>').join('');
}
function processNumberWarning(action=false){
 return '<div class="process-number-warning" id="processNumberWarning" hidden>'+
  '<span id="processNumberMessage" role="status"></span>'+
  (action?'<button type="button" id="editDuplicateProcessNumber">修改工序号</button>':'')+'</div>';
}
function refreshProcessNumberWarning(current=layout.find(page=>page.sourceId===selected)){
 const box=$('#processNumberWarning');
 if(!box)return;
 const category=$('#processCategoryInput');
 if(category&&current){
  const automatic=!!category.value;
  const operation=$('#processLabelInput'),station=$('[data-meta="station"]');
  operation.readOnly=station.readOnly=automatic;
  if(automatic&&current.processCategory===category.value){
   operation.value=T.operationLabel(current);
   station.value=T.stationLabel(current);
  }
  $('#processCategoryHint').hidden=!automatic;
 }
 const label=current&&T.operationLabel(current);
 const others=new Map();
 for(const candidate of layout){
  if(label&&candidate.processId!==current.processId&&T.operationLabel(candidate)===label&&!others.has(candidate.processId)){
   others.set(candidate.processId,candidate.name||'未命名工序');
  }
 }
 const first=others.values().next().value;
 const message=others.size?'工序号「'+label+'」与「'+first+'」'+(others.size>1?'等 '+others.size+' 道工序':'')+'重复。':'';
 const text=$('#processNumberMessage');
 box.hidden=!message;
 if(text.textContent!==message)text.textContent=message;
}
function renderEditor(){if(String(selected).startsWith('front:'))return renderFrontEditor(selected.split(':')[1]);$('.tabs').hidden=false;const p=page();const e=$('#editContent');if(!p){$('#editorTitle').textContent='开始编写 SOP';$('#selectedContext').textContent='';e.innerHTML='<div class="empty-state">点击“新增工序页”，或导入已有 Word / SOP 项目。</div>';return;}$('#editorTitle').textContent=p.name||'未命名工序';$('#selectedContext').textContent='正文工序 · '+(p.fixed.length?p.fixed.length+' 项固定沿用':'内容可编辑');const locked=k=>p.fixed.includes(k)?' readonly':'';
 if(tab==='content'){e.innerHTML=`<div class="field"><label><span>工序名称</span><input id="nameInput" value="${esc(p.name)}"></label></div>
  <div class="field"><div class="process-category-row"><label><span>工序类别</span><select id="processCategoryInput" aria-describedby="processCategoryHint">${processCategoryOptions(p.processCategory)}</select></label><button type="button" id="batchProcessNumbers">批量归类</button></div><small id="processCategoryHint" hidden>工序号与工位号自动更新。选择「沿用原编号」可恢复原值。</small></div>
  <div class="field"><label><span>工序号</span><input id="processLabelInput" value="${esc(p.processLabel)}" placeholder="留空自动编号" aria-describedby="processNumberMessage"></label>${processNumberWarning()}</div>
  <div class="field field-grid"><label><span>工位号</span><input data-meta="station" value="${esc(p.station)}"></label><label><span>工时</span><input data-meta="duration" value="${esc(p.duration)}"></label><label><span>人力</span><input data-meta="people" value="${esc(p.people)}"></label></div>${textControls(p)}<div class="field">${fieldTop('操作步骤','steps')}<textarea id="stepsInput" rows="7" style="font-size:${textStyle(p,'steps').fontSize}pt;letter-spacing:${textStyle(p,'steps').letterSpacing}pt"${locked('steps')}>${esc(p.steps)}</textarea>${p.fixed.includes('steps')?'':highlightControls('steps')}</div><div class="field">${fieldTop('作业配图','photos')}<div class="photo-grid" id="photoGrid"></div>${p.fixed.includes('photos')?'':'<div class="field-note">可多选上传，也可以将截图粘贴到此页面。配图按两列排列；超出页面或发生遮挡时，请手动调整。</div><button id="uploadBtn">＋ 添加照片 / 截图</button>'}</div><div class="field">${fieldTop('工艺技术要求 / 验收要点','requirements')}<textarea id="requirementsInput" rows="3" style="font-size:${textStyle(p,'requirements').fontSize}pt;letter-spacing:${textStyle(p,'requirements').letterSpacing}pt"${locked('requirements')}>${esc(p.requirements)}</textarea>${p.fixed.includes('requirements')?'':highlightControls('requirements')}</div>`;

  $$('[data-text-format]').forEach(el=>{el.onfocus=()=>snapshot();el.oninput=()=>{if(p.fixed.includes('contentStyle'))return;p.contentStyle={...textStyle(p,'steps'),[el.dataset.styleKey]:el.value};p.contentStyle=textStyle(p,'steps');for(const key of ['steps','requirements']){const input=$('#'+key+'Input');input.style.fontSize=p.contentStyle.fontSize+'pt';input.style.letterSpacing=p.contentStyle.letterSpacing+'pt';}changed();};el.onchange=()=>{el.value=textStyle(p,'steps')[el.dataset.styleKey];};});
  bindInput($('#nameInput'),v=>{p.name=v;project.pages.filter(x=>x.processId===p.processId).forEach(x=>x.name=v);$('#editorTitle').textContent=v;});
  bindInput($('#processLabelInput'),value=>{
   for(const page of project.pages)if(page.processId===p.processId)page.processLabel=value.trim();
  },{snapshotOnEdit:true});
  $('#processCategoryInput').onchange=event=>{
   snapshot();
   setProcessCategory(p.processId,event.target.value);
   if(!event.target.value){
    $('#processLabelInput').value=p.processLabel??'';
    $('[data-meta="station"]').value=p.station??'';
   }
   changed();
   refresh();
  };
  $('#batchProcessNumbers').onclick=openBatchProcessNumbers;
  $$('[data-meta]').forEach(el=>bindInput(el,v=>p[el.dataset.meta]=v,{snapshotOnEdit:el.dataset.meta==='station'}));for(const [id,k] of [['stepsInput','steps'],['requirementsInput','requirements']])bindBodyText($('#'+id),p,k);
  if(window.SOP_IMPORT?.active(p)){e.insertAdjacentHTML('afterbegin','<div class="notice">当前页保留原稿图文及可编辑标注。未改动项目导出 Word 时保留原文档分页；段内文字可沿用原 Word 格式。增删段落、调整样式或修改配图后会重新编排，可用撤销恢复。浏览器按工序表格预览，物理页数请在 Word/WPS 中核对。</div>');}
  e.insertAdjacentHTML('afterbegin','<div class="canvas-entry"><strong>图文页面画布</strong><p>照片、文字框与箭头独立摆放，支持照片外留白。</p><button id="editPageCanvas" class="primary">'+(p.canvas?'编辑页面画布':'建立页面画布')+'</button></div>');$('#editPageCanvas').disabled=p.fixed.includes('photos');$('#editPageCanvas').onclick=()=>void openPageCanvas(p);if(p.canvas){e.insertAdjacentHTML('afterbegin','<div class="notice">本页使用独立对象画布。下方显示画布中的照片，可进入画布编辑。<button id="restorePageMaterials">返回原图文排版</button></div>');$('#restorePageMaterials').onclick=()=>{snapshot();p.canvasDraft=p.canvas;delete p.canvas;renderEditor();changed();refresh();};}
  if(p.importedContent&&!window.SOP_IMPORT.active(p))e.insertAdjacentHTML('afterbegin','<div class="notice">当前页为重排副本。无法直接转换的原图文/标注仍保存在项目的原稿中，可撤销或导出原始 Word 查阅。</div>');renderPhotos();if($('#uploadBtn')){
   if(p.canvas)$('#uploadBtn').onclick=()=>{$('#editPageCanvas').click();document.querySelector('.object-dialog[open] [data-action="upload"]')?.click();};
   else $('#uploadBtn').onclick=()=>$('#photoFile').click();
  }
 }else{e.innerHTML=`${processNumberWarning(true)}<div class="field">${fieldTop('物料清单','materials')}<table class="data-table"><thead><tr><th>编码＋名称</th><th>图号 / 规格</th><th style="width:65px">${A.layout==='wide-v2'?'备注':'数量'}</th><th style="width:28px"></th></tr></thead><tbody id="materialRows"></tbody></table>${p.fixed.includes('materials')?'':'<button id="addMaterial" style="margin-top:10px">＋ 添加物料</button>'}<div class="field-note">每张工序页预留 ${MAT_ROWS} 行。</div></div><div class="field section-gap">${fieldTop('检验与控制要求','checks')}<div id="checkRows"></div>${p.fixed.includes('checks')?'':'<button id="addCheck">＋ 添加检查项</button>'}<div class="field-note">每张工序页预留 ${A.layout==='wide-v2'?T.checkRows:2} 行。</div></div><label class="field"><span>备注</span><textarea id="notesInput" data-meta="notes" rows="3">${esc(p.notes)}</textarea></label>${A.layout==='wide-v2'?'<div id="changeRecords" class="field"></div>':''}`;
  bindInput($('#notesInput'),value=>p.notes=value);
  if($('#changeRecords'))renderChangeRecords($('#changeRecords'),p);
  const mr=$('#materialRows');p.materials.forEach((r,i)=>{const tr=document.createElement('tr');tr.innerHTML=['name','spec','qty'].map(k=>`<td><input aria-label="物料 ${i+1} ${k}" value="${esc(r[k])}"${locked('materials')} data-material="${i}" data-key="${k}"></td>`).join('')+`<td>${p.fixed.includes('materials')?'':`<button type="button" class="remove-row-button" data-remove-material="${i}" aria-label="删除物料"></button>`}</td>`;mr.append(tr);});
  $$('[data-material]').forEach(el=>bindInput(el,v=>p.materials[+el.dataset.material][el.dataset.key]=v));$$('[data-remove-material]').forEach(el=>el.onclick=()=>{snapshot();p.materials.splice(+el.dataset.removeMaterial,1);renderEditor();changed();});if($('#addMaterial'))$('#addMaterial').onclick=()=>{if(A.layout==='wide-v2'&&p.materials.length>=MAT_ROWS)return toast('每张工序页可填写 '+MAT_ROWS+' 条物料，请先在本页精简或放到另一页。',true);snapshot();p.materials.push({name:'',spec:'',qty:''});renderEditor();changed();};
  const checkRows=$('#checkRows'),checksLocked=p.fixed.includes('checks');
  p.checks.forEach((check,i)=>{
   const row=document.createElement('div');
   row.className='check-row';
   const textInput=(key,label,placeholder=label)=>'<input aria-label="'+label+'" placeholder="'+placeholder+'" data-check="'+i+'" data-key="'+key+'" value="'+esc(check[key])+'"'+locked('checks')+'>';
   const fields=[['self','生产自检'],['audit','品质抽检'],['importance','重要度'],['method','管理手段']];
   const extras=fields.map(([key,label])=>'<label><span>'+label+'</span>'+
    (key==='importance'||key==='method'?checkChoice(i,key,check[key],checksLocked):'<input data-check="'+i+'" data-key="'+key+'" value="'+esc(check[key])+'"'+locked('checks')+'>')+'</label>').join('');
   row.innerHTML=textInput('feature','控制特性')+textInput('standard','技术要求','技术要求 / 验收标准')+
    (checksLocked?'':'<button type="button" class="remove-row-button" data-remove-check="'+i+'" aria-label="删除检查项"></button>')+
    '<div class="check-extra">'+extras+'</div>';
   checkRows.append(row);
  });
  $$('[data-check]').forEach(el=>bindInput(el,value=>p.checks[Number(el.dataset.check)][el.dataset.key]=value));
  $$('[data-remove-check]').forEach(button=>button.onclick=()=>{
   snapshot();
   p.checks.splice(Number(button.dataset.removeCheck),1);
   renderEditor();
   changed();
  });
  if($('#addCheck'))$('#addCheck').onclick=()=>{
   if(A.layout==='wide-v2'&&p.checks.length>=T.checkRows)return toast('每张工序页可填写 '+T.checkRows+' 条检验，请先在本页精简或放到另一页。',true);
   snapshot();
   p.checks.push({feature:'',standard:'',self:'',audit:'',importance:'',method:''});
   renderEditor();
   changed();
  };
 }
 e.insertAdjacentHTML('beforeend',`<div class="field section-gap">${fieldTop('编制 / 审核 / 批准及版本','signoff')}<div class="signoff-fields">${[['author','编制姓名'],['authorDate','编制日期'],['reviewer','审核姓名'],['reviewerDate','审核日期'],['approver','批准姓名'],['approverDate','批准日期'],['version','工序页版本号']].map(([key,label])=>`<label><span>${label}</span><input data-signoff="${key}" value="${esc(p.signoff[key])}"${locked('signoff')}></label>`).join('')}</div>${p.fixed.includes('signoff')?'<button type="button" id="applySignoffToAll">更新到所有工序页</button>':''}<small>签核及版本与封面独立。更新到所有工序页会覆盖已有工序页的这组信息，并设为新增工序页的默认值。</small></div>`);
 const applySignoff=$('#applySignoffToAll');if(applySignoff)applySignoff.onclick=applySignoffToAll;
 $$('[data-signoff]').forEach(input=>bindInput(input,value=>p.signoff[input.dataset.signoff]=value));
 $$('[data-pin]').forEach(el=>el.onclick=()=>pin(el.dataset.pin));
 const editNumber=$('#editDuplicateProcessNumber');
 if(editNumber)editNumber.onclick=editProcessNumber;
 refreshProcessNumberWarning();
}
async function openPageCanvas(p){
 const button=$('#editPageCanvas'),source=p.canvas||p.canvasDraft;
 if(!button||button.disabled)return;
 if(p.importedContent&&!p.canvas)toast('画布仅载入照片素材；原生标注/复杂图文无法自动迁移。保存后使用重排副本，原稿仍保留，可导出原始 Word。',true);
 if(canvasSpace(p,source).textOverflow)return toast('文字已占满内容框，请先手动调整文字、字号或字间距，留出画布空间。',true);
 button.disabled=true;
 try{
  let model=source,compressed=0;
  if(!model){
   const originals=p.photos.slice(),photos=[];
   for(const photo of originals){
    const image=await window.SOP_OBJECTS.readPhoto(photo.data);
    compressed+=Number(image.data!==photo.data);
    photos.push({...photo,data:image.data,width:image.sourceWidth,height:image.sourceHeight});
   }
   if(page()!==p||p.canvas||p.canvasDraft||p.fixed.includes('photos')||originals.length!==p.photos.length||
    originals.some((photo,i)=>photo!==p.photos[i]))return;
   model=window.SOP_OBJECTS.fromPhotos(photos);
  }
  const space=canvasSpace(p,model);
  if(space.textOverflow)return toast('文字已占满内容框，请先调整文字，留出画布空间。',true);
  window.SOP_OBJECTS.open(model,{availableHeight:space.height,title:'工序图文画布',onSave:value=>{
   snapshot();
   p.canvas=value;
   if(source&&p.canvasDraft===source)delete p.canvasDraft;
   p.fitSinglePage=false;
   renderEditor();changed();refresh();
   if(compressed)toast('已压缩 '+compressed+' 张转入画布的照片，普通图文里的原配图仍可恢复。');
  }});
 }catch(error){if(page()===p)toast('画布图片加载失败：'+error.message,true);}
 finally{if(button.isConnected)button.disabled=p.fixed.includes('photos');}
}
function currentPhotos(p){return p.canvas?p.canvas.objects.filter(o=>o.type==='photo'):p.photos;}
function updateCanvasPhoto(o,photo,width,height){
 const ratio=width/height;
 const w=Math.min(o.w,o.h*ratio);
 Object.assign(o,{data:photo.data,rendered:photo.rendered,marks:photo.marks,caption:photo.caption,w,h:w/ratio,aspectRatio:ratio});
}
function renderPhotos(){
 const p=page(),g=$('#photoGrid'),photos=currentPhotos(p),locked=p.fixed.includes('photos');
 g.innerHTML=photos.map((ph,i)=>'<div class="photo-card"'+(p.canvas?' data-canvas-photo':'')+'><img src="'+esc(ph.rendered||ph.data)+'" alt="'+esc(ph.caption||('作业图片 '+(i+1)))+'" data-edit-photo="'+esc(ph.id)+'"><div class="photo-controls"><input aria-label="图片说明" value="'+esc(ph.caption)+'" data-caption="'+esc(ph.id)+'"'+(locked?' readonly':'')+'><div class="row">'+(locked?'<span class="fixed-badge">固定沿用</span>':'<button data-edit-photo="'+esc(ph.id)+'">标注 / 裁剪</button><button data-replace-photo="'+esc(ph.id)+'">更换</button><button data-remove-photo="'+esc(ph.id)+'" aria-label="删除图片">×</button>'+(p.canvas?'<button data-open-canvas-photo>在画布中编辑</button>':''))+'</div></div></div>').join('');
 if(!photos.length)g.innerHTML='<div class="upload-area photo-empty">'+(p.canvas?'画布暂无图片':'添加现场照片或粘贴截图')+'</div>';
 if(!locked&&g.querySelector('.upload-area'))g.querySelector('.upload-area').onclick=()=>$('#uploadBtn')?.click();
 g.querySelectorAll('[data-open-canvas-photo]').forEach(button=>button.onclick=()=>$('#editPageCanvas').click());
 g.querySelectorAll('[data-edit-photo]').forEach(el=>el.onclick=()=>{if(!locked)void openPhoto(el.dataset.editPhoto);});
 g.querySelectorAll('[data-caption]').forEach(el=>{if(!locked)bindInput(el,value=>{photos.find(ph=>ph.id===el.dataset.caption).caption=value;});});
 g.querySelectorAll('[data-remove-photo]').forEach(el=>el.onclick=()=>{
  snapshot();
  if(p.canvas)window.SOP_OBJECTS.remove(p.canvas,el.dataset.removePhoto);
  else p.photos=p.photos.filter(ph=>ph.id!==el.dataset.removePhoto);
  renderPhotos();changed();refresh();
 });
 g.querySelectorAll('[data-replace-photo]').forEach(el=>el.onclick=()=>{
  replacePhotoTarget={page:p,canvas:p.canvas,id:el.dataset.replacePhoto};$('#replaceFile').click();
 });
 const note=g.parentElement.querySelector('.field-note');
 if(p.canvas&&note)note.textContent='可在这里编辑画布中的图片，也可以在画布中移动、缩放或粘贴新图片。';
}
async function filePhoto(file){
 const {data,width,height}=await window.SOP_OBJECTS.readPhoto(file,{allowOtherFormats:true});
 return {id:uid(),data,width,height,caption:'',marks:[]};
}
async function addPhotos(files){
 const p=page();
 if(!p)return toast('请先新增一道工序。');
 if(p.fixed.includes('photos'))return toast('请先解锁固定配图。');
 try{
  const photos=[];
  for(const file of files)if(file.type.startsWith('image/'))photos.push(await filePhoto(file));
  if(!photos.length||page()!==p||p.canvas||p.fixed.includes('photos'))return;
  snapshot();
  p.photos.push(...photos);
  renderEditor();changed();refresh();
  toast('照片已加入工序，页码已重新计算。');
 }catch(error){toast(error.message,true);}
}
async function prepareImages(candidate=project){if(!candidate.nativeWord&&candidate.frontContent?.flowManual&&!candidate.frontContent?.flowGraph){const c=candidate.frontContent||{},source=c.flowManual?String(c.flowText||'').split('\n').filter(Boolean).map((name,i)=>({name,processId:String(i)})):candidate.pages;if(source.length<=24)candidate.frontContent={...c,flowGraph:window.SOP_OBJECTS.fromProcesses(source),flowMode:'editable'};}if(window.SOP_WORD?.ensureOriginalFront)await window.SOP_WORD.ensureOriginalFront(candidate);await window.SOP_WORD.refreshOriginalCover(candidate);await window.SOP_IMPORT.refreshBody(candidate);await prepareOperationImages(candidate.pages);}
async function prepareOperationImages(pages){for(const p of pages)for(const ph of p.photos){if(!ph.width||!ph.height){const im=await loadImage(ph.data);ph.width=im.naturalWidth;ph.height=im.naturalHeight;}if(ph.marks?.length)ph.rendered=await annotated(ph);else if(ph.rendered===ph.data)delete ph.rendered;}}
function showForm(title,html,apply){$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#dialogApply').hidden=!apply;$('#dialogApply').disabled=false;$('#dialogApply').textContent='保存';$('#dialogApply').onclick=()=>{try{apply?.();$('#formDialog').close();}catch(e){toast(e.message,true);}};$('#formDialog').showModal();}
function openBatchProcessNumbers(){
 recalc();
 const sourceById=new Map(project.pages.map(page=>[page.id,page]));
 const groups=new Map();
 for(const page of layout){
  if(!groups.has(page.processId))groups.set(page.processId,[]);
  groups.get(page.processId).push(page);
 }
 const rows=[...groups].map(([id,pages])=>({id,pages,name:pages[0].name||'未命名工序',category:pages[0].processCategory||''}));
 const numberPair=pages=>[...new Set(pages.map(page=>T.operationLabel(page)+' ／ '+(T.stationLabel(page)||'—')))].join('\n');
 let changes=new Map();
 showForm('批量归类与编号',`<div class="batch-process-form">
  <p class="notice">可逐行选择类别，或勾选多道工序后统一设为同一类别。旧手填编号保留在项目中，切回「沿用原编号」即可恢复。</p>
  <div class="row batch-process-actions">
   <button type="button" id="detectBatchCategories">识别旧工序号</button>
   <select id="batchSharedCategory" aria-label="为勾选工序设置类别">${processCategoryOptions('')}</select>
   <button type="button" id="assignBatchCategory" disabled>设置勾选项</button>
  </div>
  <div class="batch-process-scroll"><table class="batch-process-table">
   <thead><tr><th scope="col"><input type="checkbox" id="selectAllBatchProcesses" aria-label="勾选全部工序"></th><th scope="col">工序名称</th><th scope="col">当前工序号 ／ 工位号</th><th scope="col">工序类别</th><th scope="col">应用后工序号 ／ 工位号</th></tr></thead>
   <tbody>${rows.map((row,index)=>`<tr>
    <td><input type="checkbox" data-batch-process="${index}" aria-label="勾选 ${esc(row.name)}"></td>
    <th scope="row">${esc(row.name)}</th>
    <td class="batch-process-number">${esc(numberPair(row.pages))}</td>
    <td><select data-batch-category="${index}" aria-label="${esc(row.name)} 的工序类别">${processCategoryOptions(row.category)}</select></td>
    <td class="batch-process-number"><div data-batch-preview="${index}"></div><small class="batch-process-conflicts" data-batch-conflicts="${index}"></small></td>
   </tr>`).join('')}</tbody>
  </table></div>
  <p id="batchProcessStatus" role="status"></p>
 </div>`,()=>{
  if(!changes.size)return;
  snapshot();
  for(const [id,category] of changes)setProcessCategory(id,category);
  renderEditor();
  changed();
  refresh();
 });
 const apply=$('#dialogApply'),selectAll=$('#selectAllBatchProcesses');
 const inputs=$$('[data-batch-category]'),boxes=$$('[data-batch-process]');
 const previews=$$('[data-batch-preview]'),warnings=$$('[data-batch-conflicts]');
 const updateChecks=()=>{
  const count=boxes.filter(box=>box.checked).length;
  selectAll.checked=count===boxes.length;
  selectAll.indeterminate=count>0&&count<boxes.length;
  $('#assignBatchCategory').disabled=!count;
 };
 const updatePreview=(message='')=>{
  changes=new Map(rows.map((row,index)=>[row.id,inputs[index].value]).filter(([,category],index)=>category!==rows[index].category));
  const projected=layout.map(page=>{
   const source=sourceById.get(page.sourceId);
   return {...source,processCategory:changes.get(page.processId)??page.processCategory};
  });
  const numbers=T.numberProcesses(projected);
  const projectedById=new Map(projected.map(page=>[page.id,{...page,...numbers.get(page.processId)}]));
  const numberKeys=page=>[[T.operationLabel(page),'工序号'],[T.stationLabel(page),'工位号']]
   .map(([value,label])=>[String(value??'').trim(),label]).filter(([value])=>value)
   .map(([value,label])=>label+'「'+value+'」');
  const owners=new Map();
  for(const page of projectedById.values())for(const key of numberKeys(page)){
   if(!owners.has(key))owners.set(key,new Set());
   owners.get(key).add(page.processId);
  }
  const conflicts=new Set([...owners].filter(([,ids])=>ids.size>1).map(([key])=>key));
  for(const [index,row] of rows.entries()){
   const pages=row.pages.map(page=>projectedById.get(page.sourceId));
   const result=numberPair(pages);
   const duplicates=[...new Set(pages.flatMap(numberKeys))].filter(key=>conflicts.has(key));
   previews[index].textContent=result;
   previews[index].parentElement.classList.toggle('batch-process-changed',result!==numberPair(row.pages));
   warnings[index].textContent=duplicates.length?duplicates.join('、')+'重复。':'';
  }
  apply.disabled=!changes.size;
  $('#batchProcessStatus').textContent=[
   message,changes.size?'将更新 '+changes.size+' 道工序的类别。':'选择类别后可预览编号。',
   conflicts.size?'预览中有 '+conflicts.size+' 个重号。':''
  ].filter(Boolean).join(' ');
 };
 apply.textContent='应用编号';
 selectAll.onchange=()=>{for(const box of boxes)box.checked=selectAll.checked;updateChecks();};
 for(const box of boxes)box.onchange=updateChecks;
 for(const input of inputs)input.onchange=()=>updatePreview();
 $('#assignBatchCategory').onclick=()=>{
  for(const [index,box] of boxes.entries())if(box.checked)inputs[index].value=$('#batchSharedCategory').value;
  updatePreview();
 };
 $('#detectBatchCategories').onclick=()=>{
  let count=0;
  for(const [index,row] of rows.entries()){
   if(row.category||inputs[index].value)continue;
   const candidates=new Set(row.pages.map(page=>{
    const raw=String(sourceById.get(page.sourceId).processLabel??'').normalize('NFKC').trim();
    const label=raw.replace(/^\d+\s*[-.、]?\s*/,'');
    return Object.keys(T.processCategories).find(code=>T.processCategories[code]===label);
   }).filter(Boolean));
   if(candidates.size===1){inputs[index].value=candidates.values().next().value;count++;}
  }
  updatePreview(count?`识别到 ${count} 道工序。`:'没有识别到可补充的工序类别。');
 };
 updatePreview();
}
function editMetadata(){const fields=coverMetaFields;showForm('文档信息',`<div class="notice">这些信息只填写一次，所有页面同步更新。公司名称和 Logo 可在“固定格式”中修改。</div><div class="form-grid">${fields.map(([k,l])=>`<label><span>${l}</span><input data-docmeta="${k}" value="${esc(project.meta[k])}"></label>`).join('')}</div><div class="section-gap"><div class="field-top"><strong>本次修改履历</strong></div><input id="historySummary" placeholder="可选：填写本次修改内容，保存后加入修改履历"></div>`,()=>{const summary=$('#historySummary').value.trim();if(summary&&project.history.length>=T.historyRows)throw Error('当前修改履历页最多 '+T.historyRows+' 条，请先在项目中归档旧记录。');snapshot();$$('[data-docmeta]').forEach(el=>project.meta[el.dataset.docmeta]=el.value);if(summary){project.history.push({date:project.meta.date||new Date().toLocaleDateString('sv-SE'),number:project.meta.number,version:project.meta.version,summary,author:project.meta.author,reviewer:project.meta.reviewer,approver:project.meta.approver});}changed();refresh();});}
function editSettings(){const s=project.settings,reference=window.SOP_REFERENCE?.defaults;let pendingLogo=s.logo||'';
 showForm('固定格式与沿用内容',`<div class="notice">公司信息与 Logo 会同步用于封面、预览和导出。设置随当前 SOP 保存，新建时继续沿用。</div><div class="form-grid"><label class="wide"><span>公司名称</span><input data-setting="company" maxlength="100" value="${esc(s.company)}"></label><div class="wide logo-setting"><span>公司 Logo</span><div class="logo-preview"><img id="settingsLogo" alt="Logo 预览" ${pendingLogo?'src="'+esc(pendingLogo)+'"':'hidden'}><span id="logoEmpty" ${pendingLogo?'hidden':''}>尚未设置 Logo</span></div><div class="row"><button type="button" id="chooseLogo">上传 / 更换 Logo</button><button type="button" id="removeLogo">移除 Logo</button>${reference?'<button type="button" id="resetBranding">填入原稿公司格式</button>':''}</div><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><small>PNG、JPEG 或 WebP，支持透明背景；保持原比例放入原版式。</small></div><label class="check wide"><input type="checkbox" data-setting="showLogo" ${s.showLogo!==false?'checked':''}><span>在 SOP 中显示 Logo</span></label><label class="wide"><span>保密等级</span><select data-setting="confidentialLevel"><option value="" disabled ${!window.SOP_IMPORT.confidentialityLevel(s)?'selected':''}>请选择保密等级</option>${['绝密','机密','一般'].map(level=>`<option value="${level}" ${window.SOP_IMPORT.confidentialityLevel(s)===level?'selected':''}>${level}</option>`).join('')}</select><small>单选后自动生成 SOP 页眉中的保密等级文字。</small></label><label class="wide"><span>页脚版权声明</span><textarea data-setting="copyright" rows="2">${esc(s.copyright)}</textarea></label><label class="check"><input type="checkbox" data-setting="cover" ${s.cover?'checked':''}><span>包含封面</span></label><label class="check"><input type="checkbox" data-setting="history" ${s.history?'checked':''}><span>包含修改履历</span></label><label class="check"><input type="checkbox" data-setting="flow" ${s.flow?'checked':''}><span>包含顺序流程图</span></label><label><span>正文页码统计规则</span><select data-setting="numbering"><option value="body" ${s.numbering==='body'?'selected':''}>仅工序页计数（其他页面不计入）</option></select></label></div>`,()=>{

  snapshot();$$('[data-setting]').forEach(el=>s[el.dataset.setting]=el.type==='checkbox'?el.checked:el.value);if(s.confidentialLevel)s.confidential=window.SOP_IMPORT.confidentialityText(s);s.logo=pendingLogo;changed();refresh();
 });
 const updateLogo=()=>{$('#settingsLogo').hidden=!pendingLogo;if(pendingLogo)$('#settingsLogo').src=pendingLogo;else $('#settingsLogo').removeAttribute('src');$('#logoEmpty').hidden=!!pendingLogo;};
 if(reference)$('#resetBranding').onclick=()=>{
  for(const key of ['company','confidentialLevel','copyright'])$('[data-setting="'+key+'"]').value=reference[key];
  $('[data-setting="showLogo"]').checked=true;
  pendingLogo=reference.logo;
  updateLogo();
 };
 $('#chooseLogo').onclick=()=>$('#logoFile').click();$('#removeLogo').onclick=()=>{pendingLogo='';updateLogo();};
 $('#logoFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const apply=$('#dialogApply');apply.disabled=true;try{if(!/^image\/(png|jpeg|webp)$/.test(f.type)||f.size>10*1024*1024)throw Error('请选择 10MB 以内的 PNG、JPEG 或 WebP 图片。');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Logo 读取失败'));r.readAsDataURL(f);}),im=await loadImage(data);if(im.width*im.height>40000000)throw Error('Logo 分辨率过大，请缩小后上传。');const scale=Math.min(1,1600/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*scale));c.height=Math.max(1,Math.round(im.height*scale));c.getContext('2d').drawImage(im,0,0,c.width,c.height);pendingLogo=c.toDataURL('image/png');updateLogo();}catch(err){toast(err.message,true);}finally{apply.disabled=false;e.target.value='';}};
}
function setProcessCategory(processId,value){
 const category=T.processCategory(value);
 for(const page of project.pages){
  if(page.processId!==processId)continue;
  if(category)page.processCategory=category;
  else delete page.processCategory;
 }
}
function copyPage(){
 const original=page();
 if(!original)return;
 snapshot();
 const copy=clone(original);
 copy.id=uid();
 copy.processId=uid();
 copy.name+='（副本）';
 copy.photos.forEach(photo=>photo.id=uid());
 project.pages.splice(project.pages.indexOf(original)+1,0,copy);
 selected=copy.id;
 setEditorTab('content');
 renderEditor();
 changed();
 refresh();
 if(!copy.processCategory)editProcessNumber();
}
function addPage(continuation=false){const old=page();snapshot();const p=blankPage(continuation?old?.processId:undefined,old?.processCategory);if(old){if(continuation){p.name=old.name;if(old.processLabel!==undefined)p.processLabel=old.processLabel;p.station=old.station;p.signoff=clone(old.signoff);}for(const k of old.fixed||[]){if(k==='contentStyle'){p.contentStyle=clone(textStyle(old,'steps'));}else p[k]=clone(old[k]);if(k==='steps'||k==='requirements'){for(const kind of ['Highlights','TextColors'])if(old[k+kind])p[k+kind]=clone(old[k+kind]);}}p.fixed=[...(old.fixed||[])];const i=project.pages.indexOf(old);project.pages.splice(i+1,0,p);}else project.pages.push(p);
 if(project.signoffDefault){
  p.signoff=clone(project.signoffDefault);
  if(!p.fixed.includes('signoff'))p.fixed.push('signoff');
 }
 selected=p.id;renderEditor();changed();refresh();}
function deletePage(){if(String(selected).startsWith('front:')){snapshot();project.settings[selected.split(':')[1]]=false;selected=project.pages[0]?.id;renderEditor();changed();refresh();return;}const old=page();if(!old)return;const count=layout.filter(x=>x.sourceId===old.id).length;const msg=count>1?`当前基础页及其自动续页共 ${count} 页将一起删除。可用“撤销”恢复。`:'删除当前页面及其内容？可用“撤销”恢复。';if(!confirm(msg))return;snapshot();const i=project.pages.indexOf(old);project.pages.splice(i,1);selected=project.pages[Math.min(i,project.pages.length-1)]?.id;renderEditor();changed();refresh();}
function movePage(delta){recalc();const index=selectedDocumentIndex(),to=index+delta;if(index>=0&&to>=0&&to<orderedPages().length)moveDocumentPage(index,to);}
const paperFor=entry=>entry.kind==='body'?operationPaper(entry.page):frontPaper(entry.page);
async function showFull(scrollTo=0){
 try{
  await prepareImages();
  await document.fonts.ready;
  recalc();
  const dialog=$('#previewDialog'),host=$('#fullPreview'),entries=orderedPages(),reports=[];
  host.replaceChildren();
  $('#fullPreviewIssues').hidden=true;
  dialog.showModal();
  for(const [index,entry]of entries.entries()){
   const holder=document.createElement('div');
   host.append(holder);
   const findings=mountPaper(holder,paperFor(entry),Math.min(1123,Math.max(280,host.clientWidth-50)),entry,index);
   if(findings.length)reports.push(issueReport(entry,index,findings));
  }
  renderIssueList($('#fullPreviewIssues'),reports);
  $('#fullCount').textContent='工序 '+layout.length+' 页（参与页码）＋其他 '+front.length+' 张（不计页码），文档共 '+entries.length+' 张。';
  if(scrollTo)host.children[scrollTo]?.scrollIntoView({block:'start'});
  else dialog.scrollTop=0;
 }catch(error){toast('无法打开预览：'+error.message,true);}
}
async function collectProjectedIssues(pageKey){
 await document.fonts.ready;
 recalc();
 const stage=document.createElement('div');
 stage.className='reference-preflight';
 document.body.append(stage);
 try{
  const reports=[];
  for(const [index,entry]of orderedPages().entries()){
   if(pageKey&&entry.key!==pageKey)continue;
   stage.innerHTML=paperFor(entry);
   const findings=T.printIssues(stage.firstElementChild);
   if(findings.length)reports.push(issueReport(entry,index,findings));
  }
  return reports;
 }finally{stage.remove();}
}
async function validateProjectedPages(){
 return (await collectProjectedIssues()).map(report=>report.title+'（'+report.findings.map(finding=>finding.message).join('；')+'）');
}
async function printPdf(){
 const button=$('#printBtn');
 button.disabled=true;
 try{
  await prepareImages();
  const reports=await collectProjectedIssues();
  const issues=$('#fullPreviewIssues');
  renderIssueList(issues,reports);
  if(reports.length){focusIssueControl(issues.querySelector('button'));return;}
  $('#printRoot').innerHTML=orderedPages().map(paperFor).join('');
  await Promise.all([...$('#printRoot').querySelectorAll('img')].map(im=>im.decode().catch(()=>{})));
  await document.fonts.ready;
  if(window.sopDesktop){
   const result=await window.sopDesktop.exportPDF(filename()+'.pdf');
   if(result.error)throw Error(result.error);
   if(!result.canceled)toast('PDF 已保存。');
  }else{
   toast('在打印窗口中选择“另存为 PDF”，纸张使用 A4 横向，关闭浏览器附加页眉页脚。');
   setTimeout(()=>window.print(),200);
  }
 }catch(error){toast('PDF 导出失败：'+error.message,true);}
 finally{button.disabled=false;}
}
async function flushSave(){clearTimeout(saveTimer);if(!autosaveReady)throw Error('本机恢复缓存不可用，请点击“保存”写入项目文件。');await dbWrite(projectForStorage(project));lastSaved=revision;}
if(window.sopDesktop){$('#printBtn').textContent='保存 PDF';window.sopDesktop.onBeforeClose(()=>projectFiles.beforeClose());}
function renderPresets(){for(const [hostId,input,label,isBackground]of [['textColorPresets','annotationColor','文字 / 线条',false],['backgroundPresets','annotationBackground','文字背景',true]]){SOP_COLORS.mount($('#'+hostId),{value:isBackground&&$('#annotationTransparent').checked?'transparent':$('#'+input).value,label,transparent:isBackground,onChange:color=>{if(color!=='transparent')$('#'+input).value=color;if(isBackground)$('#annotationTransparent').checked=color==='transparent';renderPresets();}});}}

for(const id of ['annotationColor','annotationBackground','annotationTransparent'])$('#'+id).addEventListener('input',()=>{if(id==='annotationBackground')$('#annotationTransparent').checked=false;renderPresets();});
async function openPhoto(id){
 const p=page(),ph=currentPhotos(p).find(x=>x.id===id);
 if(!ph||p.fixed.includes('photos'))return;
 try{
  const im=await loadImage(ph.data);
  if(page()!==p||!currentPhotos(p).includes(ph)||$('#photoDialog').open)return;
  photoEdit={page:p,canvas:p.canvas,original:ph,photo:{...clone(ph),marks:clone(ph.marks||[])},im,tool:'arrow',drag:null,crop:null};
  $('#photoDialog').showModal();renderPresets();$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool==='arrow'));renderCanvas();
 }catch(error){toast('图片打开失败：'+error.message,true);}
}
function renderCanvas(){if(!photoEdit)return;const c=$('#annotationCanvas'),im=photoEdit.im,scale=Math.min(1,940/im.width,510/im.height);const pixelRatio=Math.max(2,window.devicePixelRatio||1);c.width=Math.round(im.width*scale*pixelRatio);c.height=Math.round(im.height*scale*pixelRatio);c.style.width=Math.round(im.width*scale)+'px';const ctx=c.getContext('2d');ctx.drawImage(im,0,0,c.width,c.height);drawMarks(ctx,photoEdit.photo.marks,c.width,c.height);if(photoEdit.drag&&photoEdit.tool!=='crop')drawMarks(ctx,[photoEdit.drag],c.width,c.height);const r=photoEdit.crop||(photoEdit.tool==='crop'?photoEdit.drag:null);if(r){ctx.strokeStyle='#0c78d4';ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.strokeRect(r.x*c.width,r.y*c.height,(r.x2-r.x)*c.width,(r.y2-r.y)*c.height);ctx.setLineDash([]);}$('#cropHint').textContent=photoEdit.tool==='crop'?'拖动选择范围，再点击“应用裁剪”。':'';}
const point=e=>{const r=$('#annotationCanvas').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
$('#annotationCanvas').onpointerdown=e=>{if(!photoEdit||photoEdit.transforming)return;const p=point(e),m={type:photoEdit.tool,...p,x2:p.x,y2:p.y,color:$('#annotationColor').value,text:$('#annotationText').value,background:$('#annotationTransparent').checked?'transparent':$('#annotationBackground').value,fontSize:Number($('#annotationSize').value)};if(photoEdit.tool==='text'){photoEdit.photo.marks.push(m);renderCanvas();return;}photoEdit.drag=m;e.currentTarget.setPointerCapture(e.pointerId);};
$('#annotationCanvas').onpointermove=e=>{if(!photoEdit?.drag)return;const p=point(e);photoEdit.drag.x2=p.x;photoEdit.drag.y2=p.y;renderCanvas();};
$('#annotationCanvas').onpointerup=()=>{if(!photoEdit?.drag)return;const d=photoEdit.drag;if(Math.abs(d.x-d.x2)+Math.abs(d.y-d.y2)>.015){if(photoEdit.tool==='crop')photoEdit.crop=d;else photoEdit.photo.marks.push(d);}photoEdit.drag=null;renderCanvas();};
$$('[data-tool]').forEach(b=>b.onclick=()=>{photoEdit.tool=b.dataset.tool;photoEdit.drag=null;$$('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));renderCanvas();});$('#markUndo').onclick=()=>{if(!photoEdit||photoEdit.transforming)return;photoEdit.photo.marks.pop();renderCanvas();};
async function transformPhoto(paint,remapMarks){
 const edit=photoEdit;
 if(!edit||edit.transforming)return;
 edit.transforming=true;
 try{
  const canvas=document.createElement('canvas');
  paint(canvas,edit.im);
  const data=window.SOP_OBJECTS.encodePhotoCanvas(canvas,edit.photo.data),image=await loadImage(data);
  if(photoEdit!==edit)return;
  edit.photo.marks=remapMarks(clone(edit.photo.marks));
  edit.photo.data=data;
  edit.photo.width=image.naturalWidth;
  edit.photo.height=image.naturalHeight;
  edit.im=image;
  edit.crop=null;
  renderCanvas();
 }catch(error){
  if(photoEdit===edit)toast('图片处理失败：'+error.message,true);
 }finally{edit.transforming=false;}
}
$('#rotatePhoto').onclick=()=>transformPhoto((canvas,image)=>{
 canvas.width=image.naturalHeight;
 canvas.height=image.naturalWidth;
 const context=canvas.getContext('2d');
 context.translate(canvas.width,0);
 context.rotate(Math.PI/2);
 context.drawImage(image,0,0);
},marks=>{
 for(const mark of marks){
  [mark.x,mark.y]=[1-mark.y,mark.x];
  [mark.x2,mark.y2]=[1-mark.y2,mark.x2];
 }
 return marks;
});
$('#applyCrop').onclick=()=>{
 if(!photoEdit?.crop)return toast('请先拖动选择裁剪范围。');
 const crop=photoEdit.crop,x=Math.min(crop.x,crop.x2),y=Math.min(crop.y,crop.y2);
 const width=Math.abs(crop.x2-crop.x),height=Math.abs(crop.y2-crop.y);
 if(width<.02||height<.02)return;
 return transformPhoto((canvas,image)=>{
  const w=image.naturalWidth*width,h=image.naturalHeight*height;
  canvas.width=Math.max(1,Math.round(w));
  canvas.height=Math.max(1,Math.round(h));
  canvas.getContext('2d').drawImage(image,x*image.naturalWidth,y*image.naturalHeight,w,h,0,0,canvas.width,canvas.height);
 },marks=>{
  for(const mark of marks){
   mark.x=(mark.x-x)/width;
   mark.y=(mark.y-y)/height;
   mark.x2=(mark.x2-x)/width;
   mark.y2=(mark.y2-y)/height;
  }
  return marks.filter(mark=>mark.x>=0&&mark.x<=1&&mark.y>=0&&mark.y<=1);
 });
};
$('#savePhoto').onclick=async()=>{
 const edit=photoEdit;
 if(!edit||edit.transforming)return;
 try{
  edit.photo.rendered=await annotated(edit.photo);
  const p=page();
  if(photoEdit!==edit||p!==edit.page||p.canvas!==edit.canvas||p.fixed.includes('photos'))return;
  const i=currentPhotos(p).indexOf(edit.original);
  if(i<0)return;
  snapshot();
  if(p.canvas)updateCanvasPhoto(edit.original,edit.photo,edit.im.width,edit.im.height);
  else p.photos[i]=edit.photo;
  $('#photoDialog').close();photoEdit=null;renderPhotos();changed();refresh();
 }catch(error){toast('图片编辑保存失败：'+error.message,true);}
};$('#closePhoto').onclick=()=>{$('#photoDialog').close();photoEdit=null;};
function help(){showForm('使用说明',`<div class="help"><p><strong>页面画布：</strong>选择工序后，点击“建立页面画布”，也可双击页面进入。照片外可放文字框和箭头；拖动移动，右下角缩放，右侧编辑属性。画布固定在本页，不自动缩放或续页，可返回原图文排版，草稿仍保留。</p><p><strong>流程图：</strong>导入原稿默认保留；建立编辑副本后可拖动节点、连接两个节点、修改分支标签。转换关系需核对，可随时切回原稿。按工序生成编辑副本每张最多 24 个节点；原有自动流程续页仍保留。</p><p><strong>新建：</strong>点击“新建”，填写文档信息，再按工序添加文字与现场照片。</p><p><strong>导入：</strong>支持 SOP 项目（.sop.json）和兼容当前表格结构的 .docx。原稿图片与原生标注会保留；浏览器按工序表格预览，普通 Word 导出使用固定单页模板；原稿随项目保留。请核对超框内容与浮动标注。</p><p><strong>固定沿用：</strong>在文字、配图或物料旁点击“设为固定沿用”，普通编辑会锁定。新增和复制页面时会沿用这些内容；点击“解锁”可以修改。</p><p><strong>页面：</strong>点击“按页面”查看实际页数，可拖动正文页排序，或用“移动到…”选择移动或交换两页；封面、履历和流程图也可编辑和排序，且不计入工序页码。每个工序固定一页，不自动缩放或续页。内容过多、超框或遮挡时，请手动调整字号、图片和画布位置，或主动新增工序页。</p><p><strong>保存：</strong>编辑后会在本机保留恢复缓存。“保存”或 Ctrl+S 写入当前 .sop.json；首次保存选择位置。“另存为”或 Ctrl+Shift+S 创建另一份文件并切换到它。导入 Word 不覆盖原 Word。新建、打开和关闭前会询问未保存的更改。画布内需先保存画布。部分浏览器仅支持下载副本，请核对下载完成；不同设备不会自动同步。</p><p><strong>Word：</strong>使用原稿表格骨架导出，文字、表格、图片、标注和流程图节点/连线均可继续在 WPS/Word 中单独编辑；工作台的固定沿用不会锁定导出的 Word。页码为动态域，导出附带项目数据，可再次恢复；检测到外部 Word 修改时可选择读取现有内容。</p><p><strong>PDF：</strong>桌面版点击“预览 / PDF”后选择“保存 PDF”；浏览器版在打印窗口选择 A4 横向、缩放 100%，关闭额外页眉页脚。PDF 与此工具的打印预览使用同一页面。</p><p>第一版的浏览器预览与 Word 分页可能受字体和办公软件影响；正式发放前请打开导出的 Word 核对。数据仅存储在本机，本工具无网络请求。</p></div>`,null);}
if(A.layout==='wide-v2')document.body.classList.add('template-v2');$('#brandLogo').src=A.appLogo||A.logo;$('#undoBtn').onclick=()=>{const s=undo.pop();if(!s)return;project=s.project;selected=s.selected;renderEditor();changed();refresh();};$('#newBtn').onclick=async()=>{try{if(!await projectFiles.guard('new'))return;await projectFiles.detach();clearTimeout(saveTimer);const settings=clone(project.settings);project={schema:'sop-studio/v1',meta:{...clone(A.seed.meta),product:'',number:'',version:'A0',bare:'',packed:''},settings,history:[],pages:[blankPage()]};undo=[];selected=project.pages[0].id;renderEditor();changed();refresh();editMetadata();}catch(error){toast('新建失败：'+error.message,true);}};$('#importBtn').onclick=()=>projectFiles.open();$('#saveBtn').onclick=()=>projectFiles.save(false);$('#saveAsBtn').onclick=()=>projectFiles.save(true);$('#metaBtn').onclick=editMetadata;$('#settingsBtn').onclick=editSettings;$('#helpBtn').onclick=help;$('#addBtn').onclick=()=>addPage(false);$('#continueBtn').onclick=()=>addPage(true);$('#copyBtn').onclick=copyPage;$('#deleteBtn').onclick=deletePage;$('#moveBtn').onclick=openMovePage;$('#upBtn').onclick=()=>movePage(-1);$('#downBtn').onclick=()=>movePage(1);$('#processView').onclick=()=>{view='process';$('#processView').classList.add('active');$('#pageView').classList.remove('active');refreshNav();};$('#pageView').onclick=()=>{view='page';$('#pageView').classList.add('active');$('#processView').classList.remove('active');refreshNav();};$$('[data-tab]').forEach(button=>button.onclick=()=>{setEditorTab(button.dataset.tab);renderEditor();});$$('.close-dialog').forEach(b=>b.onclick=()=>$('#formDialog').close());$('#previewAllBtn').onclick=()=>showFull();$('#zoomBtn').onclick=()=>showFull(Math.max(0,selectedDocumentIndex()));$('#pdfBtn').onclick=()=>showFull();$('#printBtn').onclick=printPdf;$('#closePreview').onclick=()=>$('#previewDialog').close();$('#photoFile').onchange=async e=>{await addPhotos(e.target.files);e.target.value='';};$('#replaceFile').onchange=async e=>{
 const file=e.target.files[0],target=replacePhotoTarget;
 e.target.value='';replacePhotoTarget=null;
 if(!file||!target)return;
 try{
  const ph=await filePhoto(file),p=page();
  if(p!==target.page||p.canvas!==target.canvas||p.fixed.includes('photos'))return;
  const old=currentPhotos(p).find(item=>item.id===target.id);
  if(!old)return;
  ph.id=old.id;ph.caption=old.caption;
  if(target.canvas&&old.marks?.length){
   ph.marks=clone(old.marks);
   ph.rendered=await annotated(ph);
  }
  if(page()!==p||p.canvas!==target.canvas||p.fixed.includes('photos')||!currentPhotos(p).includes(old))return;
  snapshot();
  if(p.canvas)updateCanvasPhoto(old,ph,ph.width,ph.height);
  else p.photos[p.photos.indexOf(old)]=ph;
  renderPhotos();changed();refresh();
 }catch(err){toast(err.message,true);}
};document.addEventListener('paste',async e=>{if($('#photoDialog').open||$('#formDialog').open||document.querySelector('.object-dialog[open]'))return;const fs=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(fs.length){e.preventDefault();if(page()?.canvas)return toast('请打开图文画布后粘贴图片。');await addPhotos(fs);}});window.addEventListener('resize',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,100);});
$('#importFile').onchange=async e=>{const f=e.target.files[0];if(f)await projectFiles.importFile(f);e.target.value='';};
$('#editorTitle').tabIndex=-1;
$('#previewCaption').tabIndex=-1;
$('#closeExportIssues').onclick=()=>$('#exportIssuesDialog').close();
$('#previewDialog').addEventListener('close',()=>{
 if(!$('#previewDialog').open)renderIssueList($('#fullPreviewIssues'),[]);
});
let exportIssuesTrigger=$('#docxBtn');
function showExportIssues(reports,trigger){
 exportIssuesTrigger=trigger;
 const host=$('#exportIssues');
 renderIssueList(host,reports);
 $('#exportIssuesDialog').showModal();
 focusIssueControl(host.querySelector('button'));
}
$('#exportIssuesDialog').addEventListener('close',()=>{
 if($('#exportIssuesDialog').open)return;
 renderIssueList($('#exportIssues'),[]);
 if(document.activeElement===document.body)(exportIssuesTrigger.hidden?$('#zoomBtn'):exportIssuesTrigger).focus();
});
$('#docxBtn').onclick=async()=>{
 const button=$('#docxBtn');
 button.disabled=true;
 button.textContent='生成中…';
 try{
  await prepareImages();
  const reports=await collectProjectedIssues();
  if(reports.length){
   showExportIssues(reports,button);
   return;
  }
  const blob=await window.SOP_WORD.exportDocx(project,layout,front);
  download(blob,filename()+'.docx');
  toast('Word 已生成，请打开核对。页码动态域和可再次导入的项目数据已写入。');
 }catch(error){toast('导出失败：'+error.message,true);}
 finally{button.disabled=false;button.textContent='导出 Word';}
};
const proofButton=$('#wordProofBtn'),desktopProof=typeof window.sopDesktop?.openProof==='function';
const proofLabel=desktopProof?'Word 校样':'下载本页 Word 校样';
proofButton.textContent=proofLabel;
proofButton.title=desktopProof?'在 Word 或 WPS 打开当前工序校样':'下载当前工序校样文件，请在浏览器下载目录手动保留或删除';
proofButton.onclick=async()=>{
 const entry=orderedPages()[selectedDocumentIndex()];
 if(entry?.kind!=='body')return;
 const currentProject=project,source=project.pages.find(p=>p.id===entry.page.sourceId);
 if(!source)return;
 const startRevision=revision,startSelection=selected;
 const stillCurrent=()=>project===currentProject&&revision===startRevision&&selected===startSelection;
 proofButton.disabled=true;
 proofButton.textContent='校样生成中…';
 try{
  const operationOnly={...currentProject,pages:[source]};
  await window.SOP_IMPORT.refreshBody(operationOnly);
  await prepareOperationImages(operationOnly.pages);
  if(!stillCurrent())return;
  const reports=await collectProjectedIssues(entry.key);
  if(!stillCurrent())return;
  if(reports.length){showExportIssues(reports,proofButton);return;}
  const blob=await window.SOP_WORD.exportProof(currentProject,layout,front,entry.key);
  if(!stillCurrent())return;
  const name='工序'+window.SOP_TEMPLATE.operationLabel(entry.page)+'_'+(entry.page.name||'未命名工序')+(entry.page.isContinuation?'（续）':'');
  const file=name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').slice(0,100).trim()+'_Word校样.docx';
  if(desktopProof){
   const bytes=new Uint8Array(await blob.arrayBuffer());
   if(!stillCurrent())return;
   const result=await window.sopDesktop.openProof({bytes,name:file});
   if(!result?.ok)throw Error(result?.error||'未能打开 Word 或 WPS。');
  }else{
   download(blob,file);
   toast('本页 Word 校样已下载，请在浏览器下载目录手动保留或删除。');
  }
 }catch(error){if(stillCurrent())toast('校样失败：'+error.message,true);}
 finally{proofButton.disabled=false;proofButton.textContent=proofLabel;}
};
window.SOP={projectForStorage,validateProjectedPages,canvasSpace,operationPhotoLayout,textStyle,bodyLines,snapshot,changed,renderEditor,moveDocumentPage,orderedPages,moveRenderedPage,get project(){return project;},get layout(){return layout;},get front(){return front;},uid,clone,esc,blankPage,validate,annotated,prepareImages,recalc,refresh,operationPaper,frontPaper,flowImage,toast,download,filename,replaceProject(p){snapshot();project=validate(p);selected=p.pages[0]?.id;renderEditor();changed();refresh();},setSelected(id){selected=id;renderEditor();refresh();}};
projectFiles=window.SOP_FILES.create({getProject:()=>projectForStorage(project),filename,toast,download,stateText:p=>window.SOP_IMPORT.projectState(p),recover:flushSave,applyProject:async(p,commit)=>{const candidate=validate(p);await prepareImages(candidate);await commit();clearTimeout(saveTimer);project=candidate;undo=[];selected=project.pages[0]?.id;renderEditor();changed();refresh();}});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();projectFiles.save(event.shiftKey);}});if(!window.sopDesktop){window.addEventListener('beforeunload',event=>projectFiles.beforeUnload(event));}
(async()=>{let saved,meta;try{db=await openDb();saved=await dbRead();if(saved){project=validate(saved);selected=project.pages[0]?.id;}meta=await dbRead('fileBinding');autosaveReady=true;document.body.dataset.recovery='saved';}catch(e){document.body.dataset.recovery='failed';}await prepareImages();renderEditor();refresh();await projectFiles.restore(meta,!!saved);})();
})();
