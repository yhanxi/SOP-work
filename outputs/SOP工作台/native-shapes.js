/* Native DrawingML shapes. Photos remain pictures; annotations and flow items are editable objects. */
(() => {
'use strict';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',A='http://schemas.openxmlformats.org/drawingml/2006/main',S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const emu=v=>Math.round(v*12700);
const canvasFont='Microsoft YaHei';
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v.slice(1).toUpperCase():'E22D32';
function create(doc,{nextId,paragraph}){
 const node=(ns,prefix,name,attrs={})=>{const e=doc.createElementNS(ns,prefix+':'+name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
 const w=(name,attrs)=>node(W,'w',name,attrs),a=(name,attrs)=>node(A,'a',name,attrs),wp=(name,attrs)=>node(WP,'wp',name,attrs),s=(name,attrs)=>node(S,'wps',name,attrs);
 function nativeShape({name,x=0,y=0,width=1,height=1,geometry='rect',text,stroke='333333',fill=null,lineWidth=.8,arrow=false,arrowAtStart=false,flipH=false,flipV=false,fontSize=10.5,textColor='111111',align='center',connector=false,textLayout=null,arrowSize='med'}){
  const id=nextId(),r=w('r'),drawing=w('drawing'),anchor=wp('anchor',{distT:0,distB:0,distL:0,distR:0,simplePos:0,relativeHeight:id,behindDoc:0,locked:0,layoutInCell:1,allowOverlap:1});
  anchor.append(wp('simplePos',{x:0,y:0}));
  for(const [dir,relative,value]of [['H','column',x],['V','paragraph',y]]){const position=wp('position'+dir,{relativeFrom:relative}),offset=wp('posOffset');offset.textContent=String(emu(value));position.append(offset);anchor.append(position);}
  const cx=Math.max(1,emu(width)),cy=Math.max(1,emu(height));anchor.append(wp('extent',{cx,cy}),wp('effectExtent',{l:0,t:0,r:0,b:0}),wp('wrapNone'),wp('docPr',{id,name,descr:name}),wp('cNvGraphicFramePr'));
  const graphic=a('graphic'),data=a('graphicData',{uri:S}),shape=s('wsp');shape.append(s(connector?'cNvCnPr':'cNvSpPr',text!==undefined?{txBox:1}:{}));
  const properties=s('spPr'),transform=a('xfrm',{...(flipH?{flipH:1}:{}),...(flipV?{flipV:1}:{})});transform.append(a('off',{x:0,y:0}),a('ext',{cx,cy}));
  const geom=a('prstGeom',{prst:geometry});geom.append(a('avLst'));properties.append(transform,geom);
  if(fill){const f=a('solidFill');f.append(a('srgbClr',{val:fill}));properties.append(f);}else properties.append(a('noFill'));
  const line=a('ln',{w:emu(lineWidth),cap:'flat'});if(stroke){const color=a('solidFill');color.append(a('srgbClr',{val:stroke}));line.append(color);}else line.append(a('noFill'));
  const headSize=arrowAtStart?arrowSize:'med';
  line.append(a('prstDash',{val:'solid'}),a('headEnd',{type:arrow&&arrowAtStart?'triangle':'none',w:headSize,len:headSize}),a('tailEnd',{type:arrow&&!arrowAtStart?'triangle':'none',w:arrowSize,len:arrowSize}));properties.append(line);shape.append(properties);
  if(text!==undefined){
   const box=s('txbx'),content=w('txbxContent'),p=paragraph(doc,String(text),Math.round(fontSize*2),align==='center');
   for(const spacing of p.getElementsByTagNameNS(W,'spacing')){
    spacing.setAttributeNS(W,'w:after','0');
    if(textLayout?.lineHeight!=null){
     spacing.setAttributeNS(W,'w:line',String(Math.max(1,Math.round(textLayout.lineHeight*20))));
     spacing.setAttributeNS(W,'w:lineRule','exact');
    }
   }
   if(textLayout&&align==='left')p.getElementsByTagNameNS(W,'pPr')[0].append(w('jc',{'w:val':'left'}));
   for(const rp of p.getElementsByTagNameNS(W,'rPr')){
    if(textLayout?.fontFamily){
     const fonts=rp.getElementsByTagNameNS(W,'rFonts')[0];
     for(const slot of ['ascii','hAnsi','eastAsia','cs'])fonts.setAttributeNS(W,'w:'+slot,textLayout.fontFamily);
    }
    if(textLayout?.bold)rp.append(w('b'),w('bCs'));
    const color=w('color');
    color.setAttributeNS(W,'w:val',textColor);
    rp.append(color);
   }
   content.append(p);box.append(content);shape.append(box);
  }
  const layout=textLayout||{};
  const body=s('bodyPr',{vert:'horz',wrap:layout.singleLine?'none':'square',
   lIns:emu(layout.leftInset??1),tIns:emu(layout.topInset??0),rIns:emu(layout.rightInset??1),bIns:emu(layout.bottomInset??0),
   anchor:layout.anchor??(text!==undefined?'ctr':'t'),anchorCtr:0,upright:1});
  if(layout.singleLine)body.append(a('noAutofit'));
  shape.append(body);
  data.append(shape);graphic.append(data);anchor.append(graphic);drawing.append(anchor);r.append(drawing);return r;
 }
 function line(name,x1,y1,x2,y2,{arrow=false,color='333333',width=.8}={}){return nativeShape({name,x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.max(.01,Math.abs(x2-x1)),height:Math.max(.01,Math.abs(y2-y1)),geometry:'line',stroke:color,lineWidth:width,arrow,flipH:x2<x1,flipV:y2<y1,connector:true});}
 function canvasShape(object,scale){
  const {type}=object,connector=type==='line'||type==='arrow',fontSize=object.fontSize*scale;
  const objects=window.SOP_OBJECTS;
  const text=connector?undefined:type==='rect'?objects.rectTextWrapped(object.text,object.w,object.fontSize):objects.wrapText(object.text,objects.flowTextWidth(object),object.fontSize).join('\n');
  return nativeShape({name:'画布对象 '+object.id,x:object.x*scale,y:object.y*scale,width:object.w*scale,height:object.h*scale,
   geometry:({text:'rect',arrow:'line',line:'line',ellipse:'ellipse',diamond:'diamond',triangle:'triangle'})[type]||'rect',
   text,stroke:type==='text'?null:object.color.slice(1),fill:object.fill==='transparent'?null:object.fill.slice(1),
   lineWidth:object.strokeWidth*scale,fontSize,textColor:object.color.slice(1),align:type==='text'?'left':'center',
   arrow:type==='arrow',arrowAtStart:object.calloutArrow,arrowSize:type==='arrow'?'lg':'med',flipH:!!object.flipX,flipV:!!object.flipY,connector,
   textLayout:connector?null:{fontFamily:canvasFont,lineHeight:fontSize*1.2,leftInset:type==='text'?4*scale:0,rightInset:0,
    topInset:type==='triangle'?object.h*.44*scale:0,bottomInset:fontSize*.14}});
 }
 function photoMarks(photo,left,top,width,height){
  const result=[];
  for(const [i,m]of (photo.marks||[]).entries()){
   const color=hex(m.color),x=left+m.x*width,y=top+m.y*height,x2=left+m.x2*width,y2=top+m.y2*height,name='SOP标注 '+(i+1)+' '+({arrow:'箭头',circle:'圈选',rect:'矩形',line:'直线',text:'文字'}[m.type]||'');
   if(m.type==='line')result.push(line(name,x,y,x2,y2,{color,width:1.2}));
   else if(m.type==='arrow')result.push(line(name,x,y,x2,y2,{arrow:true,color,width:1.2}));
   else if(m.type==='circle'||m.type==='rect')result.push(nativeShape({name,x:Math.min(x,x2),y:Math.min(y,y2),width:Math.max(.5,Math.abs(x2-x)),height:Math.max(.5,Math.abs(y2-y)),geometry:m.type==='rect'?'rect':'ellipse',stroke:color,lineWidth:1.2}));
   else if(m.type==='text'){
    // Canvas fillText renders each photo annotation on a single line.
    const fontSize=width*(Number(m.fontSize)||1/28),text=String(m.text||'标注'),padding=width/200;
    const context=document.createElement('canvas').getContext('2d');
    context.font='600 '+fontSize+'px "'+canvasFont+'",sans-serif';
    const textWidth=context.measureText(text).width;
    result.push(nativeShape({name,x:x-padding,y:y-fontSize,width:textWidth+2*padding,height:fontSize*1.4,text,stroke:null,
     fill:m.background==='transparent'?null:hex(m.background||'#fff7b7'),fontSize,textColor:color,align:'left',
     textLayout:{fontFamily:canvasFont,bold:true,singleLine:true,lineHeight:fontSize*1.2,leftInset:padding,rightInset:padding,bottomInset:fontSize*.14}}));
   }
  }
  return result;
 }
 function centerFlow(p,width,height){
  const drawings=[...p.getElementsByTagNameNS(WP,'anchor')].map(anchor=>{
   const [x,y]=anchor.getElementsByTagNameNS(WP,'posOffset');
   const size=anchor.getElementsByTagNameNS(WP,'extent')[0];
   return {x,y,left:Number(x.textContent),top:Number(y.textContent),w:Number(size.getAttribute('cx')),h:Number(size.getAttribute('cy'))};
  });
  if(!drawings.length)return p;
  const left=Math.min(...drawings.map(o=>o.left)),top=Math.min(...drawings.map(o=>o.top));
  const right=Math.max(...drawings.map(o=>o.left+o.w)),bottom=Math.max(...drawings.map(o=>o.top+o.h));
  const dx=Math.round((emu(width)-left-right)/2),dy=Math.round((emu(height)-top-bottom)/2);
  for(const o of drawings){o.x.textContent=String(o.left+dx);o.y.textContent=String(o.top+dy);}
  return p;
 }
 function flowParagraph(project,chunk=0,{width=740,height=410,bodyPages=project.pages}={}){
  if(project.frontContent?.flowGraph){const m=window.SOP_OBJECTS.resolvedFlow(project.frontContent.flowGraph,project.pages),p=paragraph(doc,' ',2),pr=[...p.children].find(e=>e.localName==='pPr'),spacing=[...pr.children].find(e=>e.localName==='spacing'),sx=Math.min(width/m.width,height/m.height),sy=sx;spacing.setAttributeNS(W,'w:line',String(Math.round(m.height*sy*20)));spacing.setAttributeNS(W,'w:lineRule','exact');spacing.setAttributeNS(W,'w:after','0');
   for(const e of m.edges){
    const points=window.SOP_OBJECTS.flowRoute(m,e).filter((v,i,list)=>!i||Math.hypot(v.x-list[i-1].x,v.y-list[i-1].y)>.001);
    if(points.length<2)continue;
    for(let i=1;i<points.length;i++){
     const a=points[i-1],b=points[i];
     p.append(line('流程连接 '+e.id+' '+i,a.x*sx,a.y*sy,b.x*sx,b.y*sy,{arrow:i===points.length-1,width:e.strokeWidth*sy,color:e.color.slice(1)}));
    }
    if(e.label){
     const label=window.SOP_OBJECTS.flowLabel(points,e,m);
     p.append(nativeShape({name:'分支标签 '+e.id,x:(label.x-label.width/2)*sx,y:(label.y-label.height/2)*sy,width:label.width*sx,height:label.height*sy,text:e.label,textColor:e.color.slice(1),stroke:null,fontSize:label.fontSize*sy}));
    }
   }
   for(const o of m.objects)p.append(nativeShape({name:'流程节点 '+o.id,x:o.x*sx,y:o.y*sy,width:o.w*sx,height:o.h*sy,geometry:({text:'rect',ellipse:'ellipse',diamond:'diamond',triangle:'triangle',arrow:'line',line:'line'})[o.type]||'rect',text:['line','arrow'].includes(o.type)?undefined:window.SOP_OBJECTS.wrapText(o.text,window.SOP_OBJECTS.flowTextWidth(o),o.fontSize).join('\n'),lineWidth:o.strokeWidth*sy,stroke:o.type==='text'?null:o.color.slice(1),fill:o.fill==='transparent'?null:o.fill.slice(1),fontSize:o.fontSize*sy,textColor:o.color.slice(1),arrow:o.type==='arrow',flipH:!!o.flipX,flipV:!!o.flipY,connector:['line','arrow'].includes(o.type)}));return centerFlow(p,width,height);
  }
  const seen=new Set(),all=project.frontContent?.flowManual?String(project.frontContent.flowText||'').split('\n').filter(x=>x.trim()).map(name=>({name})):bodyPages.filter(p=>{if(!p.name?.trim()||seen.has(p.processId))return false;seen.add(p.processId);return true;}),pages=all.slice(chunk*24,chunk*24+24),p=paragraph(doc,' ',2),pr=[...p.children].find(e=>e.localName==='pPr'),spacing=[...pr.children].find(e=>e.localName==='spacing');
  spacing.setAttributeNS(W,'w:line',String(Math.round(height*20)));spacing.setAttributeNS(W,'w:lineRule','exact');spacing.setAttributeNS(W,'w:after','0');
  const sx=Math.min(width/1500,height/850),sy=sx;
  pages.forEach((page,i)=>{
   const col=Math.floor(i/8),row=i%8,x=45+col*460,y=35+row*96;
   p.append(nativeShape({name:'流程节点 '+(chunk*24+i+1),x:x*sx,y:y*sy,width:380*sx,height:58*sy,text:window.SOP_TEMPLATE.operationLabel(page,chunk*24+i+1)+'. '+page.name,fill:'FFFFFF',fontSize:10.5}));
   if(i<pages.length-1){const points=row===7?[[x+380,y+29],[x+430,y+29],[x+430,64],[x+460,64]]:[[x+190,y+58],[x+190,y+96]];for(let j=0;j<points.length-1;j++)p.append(line('流程连线 '+(chunk*24+i+1)+'.'+(j+1),points[j][0]*sx,points[j][1]*sy,points[j+1][0]*sx,points[j+1][1]*sy,{arrow:j===points.length-2}));}
  });return centerFlow(p,width,height);
 }
 return {nativeShape,canvasShape,photoMarks,flowParagraph};
}
window.SOP_NATIVE={create};
})();
