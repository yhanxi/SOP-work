/* Local, serializable page objects. The same geometry feeds SVG preview and native Word. */
((root) => {
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x)),id=()=>globalThis.crypto?.randomUUID?.()||'obj-'+Math.random().toString(36).slice(2),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let renderId=0;
const styleKey='sop-object-styles-v1';let remembered={};
try{
 remembered=JSON.parse(root.localStorage?.getItem(styleKey)||'{}')||{};
 remembered.rect??=remembered.callout;
 delete remembered.callout;
}catch{remembered={};}
function remember(o){remembered[o.type]={fontSize:o.fontSize,color:o.color,fill:o.fill,strokeWidth:o.strokeWidth};try{root.localStorage?.setItem(styleKey,JSON.stringify(remembered));}catch{}}

const finite=(n,f)=>Number.isFinite(Number(n))?Number(n):f;
const newShape=(type,geometry)=>({id:id(),type,text:'',fill:'#ffffff',...remembered[type],...geometry});
function normalize(input,interactive=false){
 const m=interactive?{...input,objects:input.objects.map(o=>({...o}))}:clone(input||{width:900,height:520,objects:[],edges:[]});m.width=Math.max(100,Math.min(4000,finite(m.width,900)));m.height=Math.max(100,Math.min(4000,finite(m.height,520)));m.objects=Array.isArray(m.objects)?m.objects:[];m.edges=Array.isArray(m.edges)?m.edges:[];
 const seen=new Set();m.objects=m.objects.filter(o=>['photo','text','rect','ellipse','diamond','triangle','arrow','line'].includes(o.type)).slice(0,300).map(o=>{if(o.type==='text'&&o.callout===true)o.type='rect';o.id=o.id&&!seen.has(o.id)?o.id:id();seen.add(o.id);o.w=Math.max(['line','arrow'].includes(o.type)?0:10,Math.min(m.width,finite(o.w,180)));o.h=Math.max(['line','arrow'].includes(o.type)?0:10,Math.min(m.height,finite(o.h,60)));if(['line','arrow'].includes(o.type))o.w=Math.max(0,Math.min(m.width,finite(o.w,180)));o.x=Math.max(0,Math.min(m.width-o.w,finite(o.x,30)));o.y=Math.max(0,Math.min(m.height-o.h,finite(o.y,30)));o.strokeWidth=Math.max(.5,Math.min(20,finite(o.strokeWidth,['arrow','line'].includes(o.type)?3:2)));o.fontSize=Math.max(8,Math.min(80,finite(o.fontSize,20)));o.color=/^#[a-f\d]{6}$/i.test(o.color)?o.color:'#243e46';o.fill=/^#[a-f\d]{6}$/i.test(o.fill)?o.fill:'transparent';o.text=String(o.text||'');if(o.type==='photo'){o.aspectRatio=finite(o.aspectRatio,o.w/Math.max(1,o.h));o.h=o.w/Math.max(.01,o.aspectRatio);if(o.h>m.height-o.y){o.h=m.height-o.y;o.w=o.h*o.aspectRatio;}}if(!interactive&&o.type==='photo'&&!/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(o.data||''))throw Error('画布图片必须是本地 PNG、JPEG 或 WebP 数据');return o;});
 const direct=new Set(m.edges.filter(e=>!e.join&&seen.has(e.from)&&seen.has(e.to)&&e.from!==e.to).map(e=>e.id));
 m.edges=m.edges.filter(e=>seen.has(e.from)&&(e.join?direct.has(e.join):seen.has(e.to)&&e.from!==e.to)).map(e=>({...e,id:e.id||id(),label:String(e.label||''),strokeWidth:Math.max(.5,Math.min(20,finite(e.strokeWidth,2))),color:/^#[a-f\d]{6}$/i.test(e.color)?e.color:'#243e46'}));syncConnections(m);return m;
}
function lineEndpoints(o){return {x1:o.x+(o.flipX?o.w:0),y1:o.y+(o.flipY?o.h:0),x2:o.x+(o.flipX?0:o.w),y2:o.y+(o.flipY?0:o.h)};}
function setLineEndpoints(o,p){Object.assign(o,{x:Math.min(p.x1,p.x2),y:Math.min(p.y1,p.y2),w:Math.abs(p.x2-p.x1),h:Math.abs(p.y2-p.y1),flipX:p.x2<p.x1,flipY:p.y2<p.y1});return o;}
function anchorPoints(o){
 if(['arrow','line'].includes(o.type)){const p=lineEndpoints(o);return [{x:p.x1,y:p.y1,kind:'endpoint'},{x:p.x2,y:p.y2,kind:'endpoint'},{x:(p.x1+p.x2)/2,y:(p.y1+p.y2)/2,kind:'midpoint'}];}
 if(!['photo','rect','diamond'].includes(o.type))return [];
 const vertices=o.type==='diamond'?[[o.x+o.w/2,o.y],[o.x+o.w,o.y+o.h/2],[o.x+o.w/2,o.y+o.h],[o.x,o.y+o.h/2]]:[[o.x,o.y],[o.x+o.w,o.y],[o.x+o.w,o.y+o.h],[o.x,o.y+o.h]];
 return [...vertices.map(([x,y])=>({x,y,kind:'corner'})),...vertices.map(([x,y],i)=>({x:(x+vertices[(i+1)%4][0])/2,y:(y+vertices[(i+1)%4][1])/2,kind:'midpoint'}))];
}
function facingEdgeAnchor(rect,point,previous){
 // Anchor slots 4–7 are the top, right, bottom and left midpoints.
 const outside=[point.y<=rect.y,point.x>=rect.x+rect.w,point.y>=rect.y+rect.h,point.x<=rect.x];
 const inside=!outside.some(Boolean);
 const candidates=anchorPoints(rect).slice(4).map((anchor,i)=>({
  index:i+4,distance:Math.hypot(point.x-anchor.x,point.y-anchor.y)
 })).filter((_,i)=>inside||outside[i]);
 const nearest=candidates.reduce((best,anchor)=>anchor.distance<best.distance?anchor:best);
 const current=candidates.find(anchor=>anchor.index===previous);
 const tolerance=Math.min(6,Math.min(rect.w,rect.h)*.1);
 return current&&current.distance<=nearest.distance+tolerance?current.index:nearest.index;
}
function photoAt(model,{x,y}){
 return model.objects.findLast(o=>o.type==='photo'&&x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h&&o.w>0&&o.h>0);
}
function photoAttachment(photo,{x,y}){
 return {targetId:photo.id,relativeX:Math.min(1,(x-photo.x)/photo.w),relativeY:Math.min(1,(y-photo.y)/photo.h)};
}
function nearestAnchor(model,point,excludeId,scale={x:1,y:1},radius=10,visible=()=>true){
 let closest=null,distance=radius;
 for(const o of model.objects){if(o.id===excludeId)continue;for(const [anchorIndex,anchor] of anchorPoints(o).entries()){const d=Math.hypot((anchor.x-point.x)*scale.x,(anchor.y-point.y)*scale.y);if(d<=distance&&visible(o,anchor)){distance=d;closest={...anchor,targetId:o.id,anchorIndex};}}}
 return closest;
}
// Persist the anchor index or the photo-relative point so the endpoint follows resizing.
function attachEndpoint(model,o,key,anchor){
 o.attachments=o.attachments||{};delete o.attachments[key];
 if(anchor){const seen=new Set(),depends=id=>{if(id===o.id)return true;if(seen.has(id))return false;seen.add(id);const target=model.objects.find(v=>v.id===id);return Object.values(target?.attachments||{}).some(a=>a&&depends(a.targetId));};
  if(!depends(anchor.targetId)){
   const binding=Number.isFinite(anchor.relativeX)
    ?{targetId:anchor.targetId,relativeX:anchor.relativeX,relativeY:anchor.relativeY}
    :{targetId:anchor.targetId,anchorIndex:anchor.anchorIndex};
   if(key==='start'&&o.calloutArrow)binding.auto=false;
   o.attachments[key]=binding;
  }
 }
 if(!Object.keys(o.attachments).length)delete o.attachments;
}
function syncConnections(model){
 const objects=new Map(model.objects.map(o=>[o.id,o])),state=new Map();
 function visit(o){if(state.get(o.id)===2)return;state.set(o.id,1);
  if(!['arrow','line'].includes(o.type)){delete o.attachments;state.set(o.id,2);return;}
  const ends=lineEndpoints(o),bindings={};
  // Resolve the photo point before choosing the callout's facing edge.
  for(const [key,n]of [['end','2'],['start','1']]){
   const a=o.attachments?.[key],target=objects.get(a?.targetId);
   if(!target||target===o||state.get(target.id)===1)continue;
   visit(target);
   let point;
   if(target.type==='photo'&&[a.relativeX,a.relativeY].every(v=>Number.isFinite(v)&&v>=0&&v<=1)){
    point={x:target.x+target.w*a.relativeX,y:target.y+target.h*a.relativeY};
    bindings[key]={targetId:target.id,relativeX:a.relativeX,relativeY:a.relativeY};
   }else{
    let {anchorIndex,auto}=a;
    if(key==='start'&&target.type==='rect'&&target.callout&&auto!==false){
     const oldMidpoint=Number.isInteger(anchorIndex)&&anchorIndex>=4&&anchorIndex<=7;
     if(a.edge===true||(o.calloutArrow&&(auto===true||(auto===undefined&&oldMidpoint)))){
      auto=true;o.calloutArrow=true;
      anchorIndex=facingEdgeAnchor(target,{x:ends.x2,y:ends.y2},anchorIndex);
     }
    }
    if(Number.isInteger(anchorIndex)){
     point=anchorPoints(target)[anchorIndex];
     if(point)bindings[key]={targetId:target.id,anchorIndex,...(typeof auto==='boolean'?{auto}:{})};
    }
   }
   if(point){ends['x'+n]=point.x;ends['y'+n]=point.y;}
  }
  if(Object.keys(bindings).length)o.attachments=bindings;else delete o.attachments;setLineEndpoints(o,ends);state.set(o.id,2);
 }
 for(const o of model.objects)visit(o);return model;
}
function mapPhotoAttachmentPoints(model,photoId,transform){
 for(const o of model.objects)for(const key of ['start','end']){
  const attachment=o.attachments?.[key];
  if(attachment?.targetId!==photoId||!Number.isFinite(attachment.relativeX))continue;
  const [x,y]=transform(attachment.relativeX,attachment.relativeY);
  if(x < -1e-8||x > 1+1e-8||y < -1e-8||y > 1+1e-8){delete o.attachments[key];continue;}
  attachment.relativeX=Math.max(0,Math.min(1,x));attachment.relativeY=Math.max(0,Math.min(1,y));
 }
}
function lineAngle(o){const p=lineEndpoints(o);return Math.atan2(p.y2-p.y1,p.x2-p.x1)*180/Math.PI;}
function setLineAngle(o,angle,bounds,length=Math.hypot(o.w,o.h)){
 const radians=finite(angle,0)*Math.PI/180,cs=Math.cos(radians),sn=Math.sin(radians),width=bounds?.width||4000,height=bounds?.height||4000;length=Math.max(1,finite(length,180));length=Math.min(length,width/Math.max(.000001,Math.abs(cs)),height/Math.max(.000001,Math.abs(sn)));const dx=Math.abs(cs)<1e-10?0:cs*length,dy=Math.abs(sn)<1e-10?0:sn*length;let cx=o.x+o.w/2,cy=o.y+o.h/2;cx=Math.max(Math.abs(dx)/2,Math.min(width-Math.abs(dx)/2,cx));cy=Math.max(Math.abs(dy)/2,Math.min(height-Math.abs(dy)/2,cy));return setLineEndpoints(o,{x1:cx-dx/2,y1:cy-dy/2,x2:cx+dx/2,y2:cy+dy/2});
}
function resizeCorner(o,start,corner,dx,dy,bounds){
 const left=corner.includes('w'),top=corner.includes('n'),ax=left?start.x+start.w:start.x,ay=top?start.y+start.h:start.y;
 const maxW=left?ax:bounds.width-ax,maxH=top?ay:bounds.height-ay;
 let w=Math.max(Math.min(15,maxW),Math.min(maxW,start.w+(left?-dx:dx))),h=Math.max(Math.min(15,maxH),Math.min(maxH,start.h+(top?-dy:dy)));
 if(o.type==='photo'){
  const ratio=o.aspectRatio||start.w/start.h;
  const requested=Math.abs(dx)>=Math.abs(dy)?w:h*ratio;
  w=Math.min(maxW,maxH*ratio,Math.max(Math.min(15,15*ratio),requested));h=w/ratio;
 }
 Object.assign(o,{x:left?ax-w:ax,y:top?ay-h:ay,w,h});return o;
}
function wrapText(text,width,fontSize){const max=Math.max(1,(width-8)/fontSize),out=[];for(const line of String(text||'').split('\n')){let row='',units=0;for(const c of Array.from(line)){const n=c.charCodeAt(0)>255?1:.58;if(row&&units+n>max){out.push(row);row='';units=0;}row+=c;units+=n;}out.push(row);}return out;}
function rectTextWrapped(text,width,fontSize){
 if(!root.document?.body)return wrapText(text,width,fontSize).join('\n');
 // Hard wrapping serializes the same native line breaks used by the canvas text field.
 const form=document.createElement('form'),input=document.createElement('textarea');
 form.style.cssText='position:absolute;left:-10000px;top:0;visibility:hidden;width:'+width+'px';
 form.className='object-inline-editor object-inline-centered';
 input.name='text';input.wrap='hard';input.style.fontSize=fontSize+'px';input.value=text;
 form.append(input);document.body.append(form);
 try{return new FormData(form).get('text').replace(/\r\n/g,'\n');}
 finally{form.remove();}
}
function edgePoints(m,e){const a=m.objects.find(o=>o.id===e.from),b=m.objects.find(o=>o.id===e.to);if(!a||!b)return null;const ac={x:a.x+a.w/2,y:a.y+a.h/2},bc={x:b.x+b.w/2,y:b.y+b.h/2},dx=bc.x-ac.x,dy=bc.y-ac.y;const t=(o,sign)=>{const xx=Math.abs(dx)/Math.max(.001,o.w/2),yy=Math.abs(dy)/Math.max(.001,o.h/2);return 1/Math.max(.001,o.type==='triangle'?Math.max(2*xx-sign*2*dy/o.h,sign*2*dy/o.h):o.type==='diamond'?xx+yy:o.type==='ellipse'?Math.hypot(xx,yy):Math.max(xx,yy));};return {x1:ac.x+dx*t(a,1),y1:ac.y+dy*t(a,1),x2:bc.x-dx*t(b,-1),y2:bc.y-dy*t(b,-1)};}
const center=o=>({x:o.x+o.w/2,y:o.y+o.h/2});
const sideWidth=o=>o.w*(o.type==='triangle'?.25:.5);
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const mix=(a,b,t)=>a+(b-a)*t;
function pointOnRoute(points,ratio){
 const total=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
 let remaining=total*clamp(ratio,0,1);
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=distance(a,b);
  if(length&&remaining<=length){const t=remaining/length;return {x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)};}
  remaining-=length;
 }
 return points.at(-1);
}
function projectOnRoute(points,p){
 let walked=0,total=0,best=Infinity,offset=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],length=distance(a,b);
  if(!length)continue;
  const t=clamp(((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/(length*length),0,1);
  const d=distance(p,{x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
  if(d<best){best=d;offset=walked+t*length;}
  walked+=length;total+=length;
 }
 return total?clamp(offset/total,.04,.96):.5;
}
function flowRoute(m,e){
 const from=m.objects.find(o=>o.id===e.from);
 if(!from)return [];
 if(e.join){
  const main=m.edges.find(edge=>edge.id===e.join&&!edge.join);
  const target=main&&pointOnRoute(flowRoute(m,main),finite(e.ratio,.5));
  if(!target)return [];
  const start=center(from);
  start.x+=target.x>=start.x?sideWidth(from):-sideWidth(from);
  const lane=(start.x+target.x)/2;
  return [start,{x:lane,y:start.y},{x:lane,y:target.y},target];
 }
 const to=m.objects.find(o=>o.id===e.to);
 if(!to)return [];
 if(!e.route){
  const p=edgePoints(m,e);
  return [{x:p.x1,y:p.y1},{x:p.x2,y:p.y2}];
 }
 const a=center(from),b=center(to),across=e.route==='across';
 if(across){
  const side=b.x>=a.x?1:-1;
  a.x+=side*sideWidth(from);b.x-=side*sideWidth(to);
 }else{
  const side=b.y>=a.y?1:-1;
  a.y+=side*from.h/2;b.y-=side*to.h/2;
 }
 const axis=across?'x':'y',limit=across?m.width:m.height;
 const lane=clamp((a[axis]+b[axis])/2+finite(e.bend,0),0,limit);
 return [a,{...a,[axis]:lane},{...b,[axis]:lane},b];
}
function flowLabel(points,edge,model){
 const fontSize=18,height=24;
 const textWidth=Array.from(edge.label||'').reduce((width,char)=>width+(/[\u0000-\u00ff]/.test(char)?.62:1)*fontSize,0);
 const width=Math.max(16,textWidth+8);
 const margin=4,mid=pointOnRoute(points,.5);
 const boxes=model.objects.filter(node=>!['arrow','line'].includes(node.type));
 function fits({x,y}){
  if(x-width/2<0||x+width/2>model.width||y-height/2<0||y+height/2>model.height)return false;
  return !boxes.some(node=>x+width/2+margin>node.x&&x-width/2-margin<node.x+node.w&&y+height/2+margin>node.y&&y-height/2-margin<node.y+node.h);
 }
 const manual={x:mid.x+finite(edge.labelX,0),y:mid.y+finite(edge.labelY,0)};
 if((edge.labelX!=null||edge.labelY!=null)&&fits(manual))return {...manual,width,height,fontSize};
 const segments=[];
 for(let i=1;i<points.length;i++){
  const start=points[i-1],end=points[i],length=distance(start,end);
  if(length<=.01)continue;
  const previous=segments.at(-1);
  if(previous){
   const ax=previous.end.x-previous.start.x,ay=previous.end.y-previous.start.y;
   const bx=end.x-start.x,by=end.y-start.y;
   if(Math.abs(ax*by-ay*bx)<.01&&ax*bx+ay*by>0){
    previous.end=end;previous.length+=length;continue;
   }
  }
  segments.push({start,end,length});
 }
 segments.sort((a,b)=>b.length-a.length);
 const clearance=6+edge.strokeWidth/2;
 for(const {start,end} of segments){
  const vertical=Math.abs(end.y-start.y)>=Math.abs(end.x-start.x);
  for(const t of [.5,.25,.75]){
   const p={x:mix(start.x,end.x,t),y:mix(start.y,end.y,t)};
   for(const side of [1,-1]){
    const candidate=vertical?{x:p.x+side*(width/2+clearance),y:p.y}:{x:p.x,y:p.y-side*(height/2+clearance)};
    if(fits(candidate))return {...candidate,width,height,fontSize};
   }
  }
 }
 // If a move closes the space around a line, use the nearest free place on the page.
 const xs=new Set([width/2,model.width-width/2,mid.x]),ys=new Set([height/2,model.height-height/2,mid.y]);
 for(const node of boxes){
  xs.add(node.x-width/2-margin);xs.add(node.x+node.w+width/2+margin);
  ys.add(node.y-height/2-margin);ys.add(node.y+node.h+height/2+margin);
 }
 let nearest,closest=Infinity;
 const nearestAxis=(values,origin)=>[...values].sort((a,b)=>Math.abs(a-origin)-Math.abs(b-origin)).slice(0,24);
 for(const x of nearestAxis(xs,mid.x))for(const y of nearestAxis(ys,mid.y)){
  const p={x,y},d=distance(mid,p);
  if(d<closest&&fits(p)){nearest=p;closest=d;}
 }
 return {...(nearest||mid),width,height,fontSize};
}

function selectionBox(objects){
 const x=Math.min(...objects.map(o=>o.x)),y=Math.min(...objects.map(o=>o.y));
 const right=Math.max(...objects.map(o=>o.x+o.w)),bottom=Math.max(...objects.map(o=>o.y+o.h));
 return {x,y,w:right-x,h:bottom-y};
}
function nodesInBox(model,box){
 const inside=p=>p.x>=box.x&&p.x<=box.x+box.w&&p.y>=box.y&&p.y<=box.y+box.h;
 const ids=model.objects.filter(o=>inside(o)&&inside({x:o.x+o.w,y:o.y+o.h})).map(o=>o.id);
 for(const edge of model.edges){
  const points=flowRoute(model,edge);
  if(points.length&&points.every(inside))ids.push(edge.id);
 }
 return ids;
}
function connectionDragGuides(model,origins){
 const moving=new Map(origins.map(node=>[node.id,node]));
 const guides={x:[],y:[]};
 for(const edge of model.edges){
  if(edge.join){
   const source=moving.get(edge.from),main=model.edges.find(line=>line.id===edge.join);
   if(!source||!main||moving.has(main.from)||moving.has(main.to))continue;
   const target=pointOnRoute(flowRoute(model,main),finite(edge.ratio,.5));
   if(target)guides.y.push({source:source.y+source.h/2,target:target.y});
  }else if(edge.route){
   const from=moving.get(edge.from),to=moving.get(edge.to);
   if(!!from===!!to)continue;
   const fixed=model.objects.find(node=>node.id===(from?edge.to:edge.from));
   if(!fixed)continue;
   const axis=edge.route==='across'?'y':'x';
   guides[axis].push({source:center(from||to)[axis],target:center(fixed)[axis]});
  }
 }
 return guides;
}
function snapBend(model,edge,tolerance){
 const points=flowRoute(model,edge),a=points[1],b=points[2];
 const axis=edge.route==='across'?'x':'y',span=axis==='x'?'y':'x';
 const from=Math.min(a[span],b[span]),to=Math.max(a[span],b[span]);
 if(to-from<.001)return null;
 let closest=tolerance,guide=null;
 function consider(p,q){
  if(Math.abs(p[axis]-q[axis])>.001||Math.abs(p[span]-q[span])<.001)return;
  const gap=Math.max(from-Math.max(p[span],q[span]),Math.min(p[span],q[span])-to,0);
  const offset=Math.abs(p[axis]-a[axis]);
  if(gap<=tolerance*5&&offset<closest){closest=offset;guide=p[axis];}
 }
 for(const other of model.edges){
  if(other===edge||other.join===edge.id)continue;
  const route=flowRoute(model,other);
  for(let i=1;i<route.length;i++)consider(route[i-1],route[i]);
 }
 for(const object of model.objects){
  if(!['arrow','line'].includes(object.type))continue;
  const {x1,y1,x2,y2}=lineEndpoints(object);
  consider({x:x1,y:y1},{x:x2,y:y2});
 }
 if(guide==null)return null;
 edge.bend=guide-(points[0][axis]+points.at(-1)[axis])/2;
 return {[axis]:guide};
}
function snapJoin(model,edge,p,tolerance){
 const main=model.edges.find(line=>line.id===edge.join),source=model.objects.find(node=>node.id===edge.from);
 const route=flowRoute(model,main),ratio=projectOnRoute(route,p),projected=pointOnRoute(route,ratio);
 const y=center(source).y;
 let best=tolerance,guide=null;
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i];
  if(a.y===b.y||(y-a.y)*(y-b.y)>0)continue;
  const hit={x:mix(a.x,b.x,(y-a.y)/(b.y-a.y)),y};
  const gap=distance(hit,projected);
  const snapped=projectOnRoute(route,hit);
  if(gap<best&&distance(pointOnRoute(route,snapped),hit)<.001){best=gap;guide=snapped;}
 }
 edge.ratio=guide??ratio;
 return guide==null?null:{y};
}

function alignDrag(model,origins,dx,dy,tolerance){
 const box=selectionBox(origins);
 const left=-box.x,top=-box.y,right=model.width-box.x-box.w,bottom=model.height-box.y-box.h;
 dx=clamp(dx,left,right);dy=clamp(dy,top,bottom);
 const targets=model.objects.filter(o=>!['arrow','line'].includes(o.type)&&!origins.some(source=>source.id===o.id));
 const connected=tolerance?connectionDragGuides(model,origins):{x:[],y:[]};
 function align(axis,size,delta,min,max){
  let best=tolerance,connection=null;
  for(const {source,target} of connected[axis]){
   const candidate=target-source,distance=Math.abs(candidate-delta);
   if(distance<best&&candidate>=min&&candidate<=max){best=distance;connection={delta:candidate,guide:target};}
  }
  // A connected route straightens before unrelated node edges are considered.
  if(connection)return connection;
  const anchors=[0,.5,1].map(r=>box[axis]+r*box[size]+delta);
  let closest=tolerance,guide=null,correction=0;
  for(const target of targets){
   for(const [i,ratio] of [0,.5,1].entries()){
    const match=target[axis]+ratio*target[size],offset=match-anchors[i];
    if(Math.abs(offset)<closest&&delta+offset>=min&&delta+offset<=max){
     closest=Math.abs(offset);correction=offset;guide=match;
    }
   }
  }
  return {delta:delta+correction,guide};
 }
 const x=align('x','w',dx,left,right),y=align('y','h',dy,top,bottom);
 return {dx:x.delta,dy:y.delta,x:x.guide,y:y.guide};
}
function duplicateSelection(model,keys){
 const objects=model.objects.filter(o=>keys.includes(o.id));
 if(!objects.length||model.objects.length+objects.length>300)return [];
 const ids=new Map(objects.map(o=>[o.id,id()]));
 const box=selectionBox(objects),step=(start,size,limit)=>limit-start-size>=22?22:start>=22?-22:0;
 const dx=step(box.x,box.w,model.width),dy=step(box.y,box.h,model.height);
 for(const source of objects){
  const o=clone(source);
  Object.assign(o,{id:ids.get(source.id),x:o.x+dx,y:o.y+dy});
  delete o.processId;delete o.prefix;
  for(const [end,anchor] of Object.entries(o.attachments||{})){
   if(ids.has(anchor.targetId))anchor.targetId=ids.get(anchor.targetId);
   else delete o.attachments[end];
  }
  model.objects.push(o);
 }
 const originals=model.edges.slice(),edgeIds=new Map();
 for(const edge of originals){
  if(edge.join||!ids.has(edge.from)||!ids.has(edge.to))continue;
  const copy={...edge,id:id(),from:ids.get(edge.from),to:ids.get(edge.to)};
  model.edges.push(copy);edgeIds.set(edge.id,copy.id);
 }
 for(const edge of originals){
  if(!edgeIds.has(edge.join)||!ids.has(edge.from))continue;
  model.edges.push({...edge,id:id(),from:ids.get(edge.from),join:edgeIds.get(edge.join)});
 }
 return [...ids.values()];
}
function resolvedFlow(model,pages){
 const names=new Map();
 for(const page of pages)if(!names.has(page.processId))names.set(page.processId,page.name);
 const m=normalize(model);
 for(const o of m.objects)if(o.processId&&names.has(o.processId))o.text=(o.prefix||'')+names.get(o.processId);
 return m;
}
const flowShapes={rect:'矩形',diamond:'菱形',ellipse:'椭圆',triangle:'三角形'};
function flowTextWidth(node){
 if(!node.flowFit)return node.w;
 return node.w*({diamond:.56,ellipse:.72,triangle:.48}[node.type]||.93);
}
function generateFlow(rows,columns){
 const main=rows.filter(row=>row.role==='main'),branches=rows.filter(row=>row.role==='branch');
 if(!main.length)throw Error('请至少保留一道主工序。');
 if(main.length+branches.length>24)throw Error('单张图最多生成 24 个节点。');
 if(branches.some(row=>!main.some(target=>target.key===row.target)))throw Error('请给每道支线选择有效的汇入工序。');
 const count=clamp(columns||Math.ceil(main.length/6),1,main.length);
 const groups=Array.from({length:count},(_,i)=>main.slice(Math.ceil(i*main.length/count),Math.ceil((i+1)*main.length/count)));
 const hasRail=branches.length>0,step=hasRail?420:310,margin=hasRail?154:25;
 const m={width:Math.max(680,count*step+12),height:0,objects:[],edges:[]};
 const node=(row,x,y,w,minimum,prefix)=>{
  const type=Object.hasOwn(flowShapes,row.shape)?row.shape:'rect';
  const o={id:id(),type,text:prefix+row.name,processId:row.processId,prefix,x,y,w,flowFit:true,
   fontSize:type==='diamond'?16:19,fill:'#ffffff',color:'#20262b',strokeWidth:1.6};
  const lines=wrapText(o.text,flowTextWidth(o),o.fontSize).length;
  const fraction={diamond:.40,ellipse:.62}[type]||1;
  // The lower half is the text area of the triangle preset.
  const textHeight=type==='triangle'?(lines*o.fontSize*1.2+6)/.5:(lines*o.fontSize*1.25+14)/fraction;
  o.h=Math.max(minimum,Math.ceil(textHeight));
  return o;
 };
 const edge=(from,to,route,label='')=>({id:id(),from:from.id,to:to?.id,route,label,color:'#20262b',strokeWidth:1.8});
 let previous;
 let sequence=0;
 for(const [col,group] of groups.entries()){
  const x=margin+col*step;
  let y=22;
  for(const [rowIndex,row] of group.entries()){
   const inputs=branches.filter(branch=>branch.target===row.key);
   const sameColumn=rowIndex>0;
   const sides=inputs.map(branch=>node(branch,x-140,0,119,54,branch.star?'★ ':''));
   const railHeight=sides.reduce((total,side)=>total+side.h+10,0);
   if(sameColumn)y+=Math.max(40,railHeight+12);
   else if(!previous)y+=railHeight;
   const box=node(row,x,y,220,58,(row.star?'★ ':'')+(++sequence)+'. ');
   m.objects.push(box);
   const incoming=previous&&edge(previous,box,sameColumn?'down':'across',row.label);
   if(incoming&&!sameColumn&&hasRail)incoming.bend=x-170-(previous.x+previous.w+x)/2;
   if(incoming)m.edges.push(incoming);
   const route=incoming&&flowRoute(m,incoming);
   let branchY=sameColumn?previous.y+previous.h+6:incoming?box.y+box.h+10:22;
   for(const [i,side] of sides.entries()){
    const branch=inputs[i];
    side.y=branchY;
    branchY+=side.h+10;
    m.objects.push(side);
    const connection=edge(side,box,'across',branch.label);
    if(incoming){
     delete connection.to;
     connection.join=incoming.id;
     connection.ratio=projectOnRoute(route,{x:sameColumn?x+110:route[1].x,y:side.y+side.h/2});
    }
    m.edges.push(connection);
    m.height=Math.max(m.height,side.y+side.h+22);
   }
   y+=box.h+(!sameColumn&&incoming?railHeight:0);
   m.height=Math.max(m.height,y+22);
   previous=box;
  }
 }
 if(m.height>4000)throw Error('流程图内容过长。请增加列数或拆分流程。');
 m.height=Math.max(260,m.height);
 return normalize(m);
}

function remove(m,key){syncConnections(m);const label=m.objects.find(o=>o.id===key);m.objects=m.objects.filter(o=>o.id!==key&&!(o.calloutArrow&&o.attachments?.start?.targetId===key&&label?.callout));const removed=new Set(m.edges.filter(e=>e.id===key||e.from===key||e.to===key).map(e=>e.id));m.edges=m.edges.filter(e=>!removed.has(e.id)&&!removed.has(e.join));syncConnections(m);}
function duplicate(m,key){const o=m.objects.find(x=>x.id===key);if(!o)return null;const n={...clone(o),id:id(),x:Math.min(m.width-o.w,o.x+20),y:Math.min(m.height-o.h,o.y+20)};delete n.attachments;delete n.processId;delete n.prefix;m.objects.push(n);return n.id;}
const PHOTO_MAX_EDGE=1800,PHOTO_REENCODE_BYTES=1.5*1024*1024,PHOTO_MAX_BYTES=35*1024*1024;
function photoMime(data){return /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(data)?.[1].toLowerCase();}
function encodePhotoCanvas(canvas,source,format=photoMime(source)||'image/png'){
 const data=canvas.toDataURL(format,.9);
 if(!photoMime(data))throw Error('无法编码图片，请换一张图片。');
 return data;
}
function opaquePhoto(context,width,height){
 const pixels=context.getImageData(0,0,width,height).data;
 const colors=new Set(),stride=Math.max(1,Math.floor(width*height/3000))*4;
 let samples=0,shaded=0;
 // Preserve transparent images and avoid lossy encoding of flat-color diagrams.
 for(let index=0;index<pixels.length;index+=4){
  if(pixels[index+3]!==255)return false;
  if(index%stride===0){
   const red=pixels[index]>>3,green=pixels[index+1]>>3,blue=pixels[index+2]>>3;
   colors.add((red<<10)|(green<<5)|blue);
   if(index+4<pixels.length){
    const delta=Math.max(Math.abs(pixels[index]-pixels[index+4]),Math.abs(pixels[index+1]-pixels[index+5]),Math.abs(pixels[index+2]-pixels[index+6]));
    if(delta>=2&&delta<=48)shaded++;
    samples++;
   }
  }
 }
 return colors.size>=256||(colors.size>=20&&shaded>samples*.22);
}
async function readPhoto(source,{allowOtherFormats=false}={}){
 let data=source;
 if(typeof source!=='string'){
  if(!allowOtherFormats&&!/^image\/(png|jpeg|webp)$/i.test(source.type))throw Error('请选择 PNG、JPEG 或 WebP 图片。');
  if(source.size>PHOTO_MAX_BYTES)throw Error('单张图片请控制在 35MB 以内。');
  data=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(reader.result);
   reader.onerror=reader.onabort=()=>reject(Error('无法读取图片。'));
   reader.readAsDataURL(source);
  });
 }
 const format=photoMime(data);
 if(!format&&!allowOtherFormats)throw Error('请选择 PNG、JPEG 或 WebP 图片。');
 const image=new Image();
 image.src=data;
 try{await image.decode();}catch{throw Error('无法读取这张图片，请重新选择或粘贴。');}
 const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight;
 if(!sourceWidth||!sourceHeight)throw Error('无法读取图片尺寸。');
 const edge=Math.max(sourceWidth,sourceHeight),overEdge=edge>PHOTO_MAX_EDGE;
 const largeFile=(data.length-data.indexOf(',')-1)*.75>PHOTO_REENCODE_BYTES;
 const sourcePhoto={data,width:sourceWidth,height:sourceHeight,sourceWidth,sourceHeight};
 if(format&&!overEdge&&!largeFile)return sourcePhoto;
 const scale=Math.min(1,PHOTO_MAX_EDGE/edge),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(sourceWidth*scale));
 canvas.height=Math.max(1,Math.round(sourceHeight*scale));
 const context=canvas.getContext('2d');
 if(!context)throw Error('无法压缩图片，请换一张图片。');
 context.imageSmoothingQuality='high';
 context.drawImage(image,0,0,canvas.width,canvas.height);
 let best=data;
 if(!format||overEdge||format!=='image/png'){
  const encoded=encodePhotoCanvas(canvas,data);
  if(!format||encoded.length<data.length)best=encoded;
 }
 if(format==='image/png'&&largeFile&&opaquePhoto(context,canvas.width,canvas.height)){
  const jpeg=encodePhotoCanvas(canvas,null,'image/jpeg');
  if(jpeg.length<=best.length*.8)best=jpeg;
 }
 return best===data?sourcePhoto:{data:best,width:canvas.width,height:canvas.height,sourceWidth,sourceHeight};
}
function fromPhotos(photos){
 const m={width:900,height:520,objects:[],edges:[]};
 (photos||[]).forEach((ph,i)=>{const x=40+(i%2)*440,y=40+Math.floor(i/2)*270,ratio=(ph.width&&ph.height)?ph.width/ph.height:1,w=Math.min(370,200*ratio),h=w/ratio;m.height=Math.max(m.height,y+h+70);m.objects.push({id:id(),type:'photo',data:ph.data,caption:ph.caption||'',x,y,w,h});
  for(const mark of ph.marks||[]){const fs=(mark.fontSize||.036)*w,isText=mark.type==='text',x2=mark.x2??mark.x,y2=mark.y2??mark.y;m.objects.push({id:id(),type:mark.type==='circle'?'ellipse':mark.type,x:x+(isText?mark.x:Math.min(mark.x,x2))*w,y:y+(isText?mark.y*h-fs:Math.min(mark.y,y2)*h),w:isText?Math.max(40,Array.from(mark.text||'').reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.58),0)*fs+8):Math.abs(x2-mark.x)*w,h:isText?fs*1.4:Math.abs(y2-mark.y)*h,text:mark.text,fontSize:fs,color:mark.color,fill:isText?(mark.background||'#fff7b7'):'transparent',flipX:x2<mark.x,flipY:y2<mark.y});}
 });return normalize(m);
}
function restorePhotoCaptions(input,photos){
 const model=normalize(input);
 for(const source of photos){
  if(!source.caption||photos.filter(photo=>photo.caption===source.caption).length!==1)continue;
  const pictures=model.objects.filter(o=>o.type==='photo'&&o.data===source.data);
  if(pictures.length!==1||pictures[0].caption!==undefined)continue;
  // Match only a unique label with the old generated caption style.
  const labels=model.objects.filter(o=>o.type==='text'&&o.text===source.caption&&o.w===370&&o.h===34&&o.fontSize===16&&o.color==='#243e46'&&o.fill==='transparent');
  if(labels.length!==1)continue;
  const label=labels[0];
  const attached=model.objects.some(o=>Object.values(o.attachments||{}).some(link=>link.targetId===label.id));
  if(attached||model.edges.some(e=>e.from===label.id||e.to===label.id))continue;
  pictures[0].caption=label.text;
  model.objects=model.objects.filter(o=>o!==label);
 }
 return model;
}
function fromProcesses(pages){const m={width:1000,height:650,objects:[],edges:[]},seen=new Set();pages.filter(p=>{if(seen.has(p.processId))return false;seen.add(p.processId);return true;}).forEach((p,i)=>{m.objects.push({id:id(),type:'rect',text:p.name,x:60+Math.floor(i/6)*240,y:30+(i%6)*95,w:200,h:60,fill:'#ffffff'});if(i)m.edges.push({id:id(),from:m.objects[i-1].id,to:m.objects[i].id,label:''});});if(m.objects.length>24)throw Error('从工序生成最多支持24个节点；请拆分为多个流程或在画布手动添加。');return normalize(m);}
// Occupied bounds detect elements outside the remaining page area without resizing them.
function contentHeight(model){const m=normalize(model);return m.objects.reduce((bottom,o)=>{let edge=o.y+o.h;if(o.type==='photo'&&o.caption)edge+=4+17*wrapText(o.caption,o.w,14).length;if(!['photo','arrow','line'].includes(o.type)&&o.text){const lines=wrapText(o.text,o.w,o.fontSize);edge=Math.max(edge,o.y+o.h/2+(lines.length-1)*o.fontSize*.6+o.fontSize*.7);}return Math.max(bottom,edge+(['arrow','line'].includes(o.type)?Math.max(8,o.strokeWidth*3.5):8));},0);}
function svg(model,selection='',editing=false,{viewHeight,picked=[],imageSource=o=>o.rendered||o.data,live=false,centerContent=false,hideText='',nativeRectText=false}={}){const m=normalize(model,live),height=Number.isFinite(viewHeight)?Math.max(1,viewHeight):m.height,marker='sop-object-arrow-'+(++renderId);let out=`<svg class="object-sheet" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${height}" role="img" aria-label="独立对象画布"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#243e46"/></marker></defs><rect width="${m.width}" height="${height}" fill="white"/>`;
 const canvas=out;
 out='';
 const edgeLabels=[],edgeHandles=[],bounds=[];
 if(centerContent)for(const o of m.objects)bounds.push({x:o.x,y:o.y},{x:o.x+o.w,y:o.y+o.h});
 for(const e of m.edges){
  const points=flowRoute(m,e);
  if(points.length<2)continue;
  const coords=points.filter((point,i)=>!i||distance(point,points[i-1])>.001).map(p=>p.x+','+p.y).join(' ');
  if(!coords.includes(' '))continue;
  if(centerContent)bounds.push(...points);
  const active=selection===e.id||picked.includes(e.id),edgeMarker=marker+'-edge-'+String(e.id).replace(/[^a-z0-9]/gi,'');
  out+=`<defs><marker id="${edgeMarker}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${e.color}"/></marker></defs>
  <g data-object="${esc(e.id)}"><polyline points="${coords}" fill="none" stroke="${active?'#0d9692':e.color}" stroke-width="${e.strokeWidth}" marker-end="url(#${edgeMarker})"/>
  ${editing?`<polyline points="${coords}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>`:''}</g>`;
  if(e.label){
   const label=flowLabel(points,e,m);
   edgeLabels.push(`<text data-object="${esc(e.id)}" data-flow-handle="label" x="${label.x}" y="${label.y+label.fontSize*.34}" text-anchor="middle" font-size="${label.fontSize}" font-family="Microsoft YaHei, sans-serif" fill="${e.color}" style="cursor:${editing?'move':'inherit'}">${esc(e.label)}</text>`);
  }
  if(editing&&selection===e.id&&(e.join||e.route)){
   const p=e.join?points.at(-1):{x:(points[1].x+points[2].x)/2,y:(points[1].y+points[2].y)/2};
   edgeHandles.push(`<circle data-object="${esc(e.id)}" data-flow-handle="${e.join?'join':'bend'}" cx="${p.x}" cy="${p.y}" r="5" fill="white" stroke="#0d9692" stroke-width="2" style="cursor:move"/>`);
  }
 }
 const selectedLine=editing&&m.objects.find(o=>o.id===selection&&['arrow','line'].includes(o.type));
 const orderedObjects=selectedLine?m.objects.filter(o=>o!==selectedLine).concat(selectedLine):m.objects;
 for(const o of orderedObjects){
  const arrowAtStart=o.type==='arrow'&&o.calloutArrow;
  const objectMarker=marker+'-'+String(o.id).replace(/[^a-z0-9]/gi,'');
  out+=`<defs><marker id="${objectMarker}" viewBox="0 0 10 10" refX="${arrowAtStart?10:9}" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${o.color}"/></marker></defs>`;out+=`<g data-object="${esc(o.id)}" transform="translate(${o.x} ${o.y})">`;const style=`fill="${o.fill}" stroke="${o.color}" stroke-width="${o.strokeWidth}"`;
  if(o.type==='photo'){
   out+=`<image href="${esc(imageSource(o))}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`;
   if(o.caption)out+=`<text x="${o.w/2}" y="${o.h+4}" dominant-baseline="hanging" text-anchor="middle" font-size="14" fill="#111" pointer-events="${editing?'visiblePainted':'none'}">${wrapText(o.caption,o.w,14).map((text,i)=>`<tspan x="${o.w/2}" dy="${i?17:0}">${esc(text)}</tspan>`).join('')}</text>`;
  }
  else if(['arrow','line'].includes(o.type))out+=`<line x1="${o.flipX?o.w:0}" y1="${o.flipY?o.h:0}" x2="${o.flipX?0:o.w}" y2="${o.flipY?0:o.h}" stroke="${o.color}" stroke-width="${o.strokeWidth}" ${o.type==='arrow'?`marker-${arrowAtStart?'start':'end'}="url(#${objectMarker})"`:''}/>`;
  else {if(o.type==='ellipse')out+=`<ellipse cx="${o.w/2}" cy="${o.h/2}" rx="${o.w/2}" ry="${o.h/2}" ${style}/>`;else if(o.type==='triangle')out+=`<polygon points="${o.w/2},0 ${o.w},${o.h} 0,${o.h}" ${style}/>`;else if(o.type==='diamond')out+=`<polygon points="${o.w/2},0 ${o.w},${o.h/2} ${o.w/2},${o.h} 0,${o.h/2}" ${style}/>`;else out+=`<rect width="${o.w}" height="${o.h}" ${o.type==='text'?`fill="${o.fill}" stroke="none"`:style}/>`;
   if(o.id!==hideText&&o.type==='rect'&&nativeRectText){
    out+=`<foreignObject width="${o.w}" height="${o.h}" overflow="visible" pointer-events="none"><div xmlns="http://www.w3.org/1999/xhtml" class="object-inline-editor object-inline-centered"><textarea readonly tabindex="-1" rows="1" aria-hidden="true" data-object-text style="font-size:${o.fontSize}px;color:${o.color};text-align:center">\n${esc(o.text)}</textarea></div></foreignObject>`;
   }else if(o.id!==hideText){
    const lines=wrapText(o.text,flowTextWidth(o),o.fontSize),fs=o.fontSize;
    out+=`<text text-anchor="${o.type==='text'?'start':'middle'}" x="${o.type==='text'?4:o.w/2}" y="${o.h*(o.type==='triangle'?.72:.5)-(lines.length-1)*fs*.6}" dominant-baseline="middle" font-size="${fs}" font-family="Microsoft YaHei, sans-serif" fill="${o.color}">${lines.map((s,i)=>`<tspan x="${o.type==='text'?4:o.w/2}" dy="${i?fs*1.2:0}">${esc(s)}</tspan>`).join('')}</text>`;
   }
  }
  if(editing){if(['arrow','line'].includes(o.type))out+=`<line x1="${o.flipX?o.w:0}" y1="${o.flipY?o.h:0}" x2="${o.flipX?0:o.w}" y2="${o.flipY?0:o.h}" stroke="transparent" stroke-width="${Math.max(8,o.strokeWidth)}" pointer-events="stroke"/>`;out+=`<rect width="${o.w}" height="${o.h}" fill="transparent" stroke="${o.id===selection||picked.includes(o.id)?'#0d9692':'transparent'}" stroke-dasharray="5 3" ${['arrow','line'].includes(o.type)?'pointer-events="none"':''}/>`;}
  if(editing&&o.id===selection&&['arrow','line'].includes(o.type)){
   const p=lineEndpoints(o);
   const tipStyle='fill="#0d9692" stroke="white" stroke-width="1.2"',otherStyle='fill="white" stroke="#0d9692" stroke-width="1.5"';
   out+=`<circle data-endpoint="start" cx="${p.x1-o.x}" cy="${p.y1-o.y}" r="4" ${arrowAtStart?tipStyle:otherStyle}/><circle data-endpoint="end" cx="${p.x2-o.x}" cy="${p.y2-o.y}" r="4" ${arrowAtStart?otherStyle:tipStyle}/>`;
  }else if(editing&&o.id===selection)for(const [corner,x,y]of [["nw",0,0],["ne",o.w,0],["sw",0,o.h],["se",o.w,o.h]])out+=`<rect data-resize="${corner}" x="${x-3.5}" y="${y-3.5}" width="7" height="7" fill="#0d9692" stroke="white" stroke-width="1.2"/>`;out+='</g>';
 }
 const content=out+edgeLabels.join('')+edgeHandles.join('');
 if(!bounds.length)return canvas+content+'</svg>';
 const xs=bounds.map(point=>point.x),ys=bounds.map(point=>point.y);
 const dx=(m.width-Math.min(...xs)-Math.max(...xs))/2;
 const dy=(height-Math.min(...ys)-Math.max(...ys))/2;
 return canvas+'<g transform="translate('+dx+' '+dy+')">'+content+'</g></svg>';
}
function open(input,{title='图文画布',flow=false,photos=[],availableHeight,preview=false,startCallout=false,onSave}={}){
 const d=document.createElement('dialog');d.className='object-dialog';let m=normalize(input),selected='',history=[],drag=null,snap=null,linkFrom='',inlineEdit=null,lastTap=null,tool='',creating=null,calloutPoint=null,propertyTextPreview=null;
 let picked=[],marquee=null,boxMode=false,guides=null;
 const drawingHeight=Number.isFinite(availableHeight)?Math.max(1,availableHeight):null;if(drawingHeight)m.height=Math.max(m.height,drawingHeight);const bounds=()=>({width:m.width,height:drawingHeight??m.height});
 const calloutHeight=(text,width,fontSize)=>Math.ceil(rectTextWrapped(text,width,fontSize).split('\n').length*fontSize*1.2+16);
 function fitCalloutText(o){
  if(o.callout&&o.type==='rect'){
   const height=calloutHeight(o.text,o.w,o.fontSize);
   if(height>o.h){
    o.h=Math.min(4000,height);
    o.y=Math.max(0,Math.min(o.y,bounds().height-o.h-8));
   }
  }
  return o;
 }
 d.innerHTML=`<div class="dialog-head"><div><h2>${esc(title)}</h2><small>选择形状后在画布按下并拖动绘制，松开完成，Esc 取消。拖动对象移动，四角均可缩放；箭头端点吸附后跟随目标移动、缩放；拖离可解除连接。双击形状可直接编辑文字。${flow?' 拖空白处框选。靠近对齐位置会吸附，按 Alt 自由移动。':' 复制图片后，可按 Ctrl+V 粘贴到画布。'}</small></div><button data-action="close">取消</button></div><div class="object-tools"><button data-add="rect">＋ 矩形</button><button data-add="ellipse">＋ 椭圆</button><button data-add="diamond">＋ 菱形</button><button data-add="arrow">＋ 箭头</button>${flow?'<button data-add="triangle">＋ 三角形</button><button data-action="box" aria-pressed="false">框选</button><button data-action="connect">连接节点 / 汇入主线</button>':'<button data-add="callout">点照片加标注</button><button data-action="upload">＋ 照片</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="objectPhoto">'}<button data-action="editText">编辑文字</button><button data-action="copy">复制对象</button><button data-action="delete">删除对象</button><button data-action="undo">撤销</button><span class="object-message" aria-live="polite"></span></div><div class="object-layout"><div class="object-stage"></div><aside class="object-properties"></aside></div><div class="dialog-foot"><span>保存后写入项目；取消放弃本次画布修改。</span><button data-action="save" class="primary">${preview?'应用流程图':'保存画布'}</button></div>`;document.body.append(d);
 const q=s=>d.querySelector(s),push=(model=m)=>{history.push(clone(model));if(history.length>60)history.shift();},message=t=>q('.object-message').textContent=t;
 const imageUrls=new Map();
 function imageSource(o){
  const source=o.rendered||o.data;
  if(!imageUrls.has(source)){
   const comma=source.indexOf(',');
   try{
    const base64=source.slice(comma+1);
    const bytes=Uint8Array.fromBase64?Uint8Array.fromBase64(base64):Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
    const type=source.slice(5,source.indexOf(';'));
    imageUrls.set(source,URL.createObjectURL(new Blob([bytes],{type})));
   }catch{imageUrls.set(source,source);}
  }
  return imageUrls.get(source);
 }
 let frame=0;
 function cancelStageFrame(){if(frame)cancelAnimationFrame(frame);frame=0;}
 function queueStageDraw(){
  if(frame)return;
  frame=requestAnimationFrame(()=>{
   frame=0;
   if(d.isConnected)drawStage(true);
  });
 }
 function dispose(){
  cancelStageFrame();
  for(const [source,url] of imageUrls)if(url!==source)URL.revokeObjectURL(url);
  imageUrls.clear();
  d.remove();
 }
 function drawStage(live=false){
  cancelStageFrame();syncConnections(m);
  const stage=q('.object-stage');
  stage.style.cursor=tool||boxMode?'crosshair':'';
  stage.classList.toggle('object-callout-mode',tool==='callout');
  q('[data-action=box]')?.setAttribute('aria-pressed',String(boxMode));
  d.querySelectorAll('[data-add]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.add===tool)));
  const edited=inlineEdit?.preview||propertyTextPreview;
  const model=edited?{...m,height:Math.max(m.height,edited.h),objects:m.objects.map(o=>o.id===edited.id?edited:o)}:m;
  const markup=svg(model,selected,true,{picked,imageSource,live,hideText:inlineEdit?.object.id,nativeRectText:!flow});
  const editor=inlineEdit?.host,sheet=q('svg');
  if(sheet&&editor?.parentNode===sheet){
   // Keep the focused input in the DOM across height changes and IME composition.
   const template=document.createElement('template');
   template.innerHTML=markup;
   const replacement=template.content.firstElementChild;
   sheet.setAttribute('viewBox',replacement.getAttribute('viewBox'));
   for(const child of [...sheet.children])if(child!==editor)child.remove();
   const content=document.createDocumentFragment();
   content.append(...replacement.children);
   sheet.insertBefore(content,editor);
  }else stage.innerHTML=markup;
  if(marquee||guides){
   const box=marquee?.box;
   const selection=box?`<rect data-marquee x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#0d9692" fill-opacity=".1" stroke="#0d9692" vector-effect="non-scaling-stroke"/>`:'';
   const vertical=guides?.x!=null?`<line data-alignment="x" x1="${guides.x}" x2="${guides.x}" y1="0" y2="${m.height}" vector-effect="non-scaling-stroke"/>`:'';
   const horizontal=guides?.y!=null?`<line data-alignment="y" x1="0" x2="${m.width}" y1="${guides.y}" y2="${guides.y}" vector-effect="non-scaling-stroke"/>`:'';
   q('svg').insertAdjacentHTML('beforeend',`<g pointer-events="none" stroke="#0d9692" stroke-dasharray="5 3">${selection+vertical+horizontal}</g>`);
  }
  if(drawingHeight){const sheet=q('svg'),background=[...sheet.children].find(n=>n.tagName==='rect');sheet.style.minHeight='0';background.setAttribute('fill','#dfe7ea');background.insertAdjacentHTML('afterend',`<rect data-drawing-area width="${m.width}" height="${drawingHeight}" fill="white" stroke="#9cbfc0" stroke-dasharray="5 3" pointer-events="none"/>`);}if(snap){const sheet=q('svg'),target=m.objects.find(o=>o.id===snap.targetId),unit=m.width/sheet.getBoundingClientRect().width;sheet.insertAdjacentHTML('beforeend',`<g class="snap-guide" data-snap-kind="${snap.kind}" pointer-events="none" aria-hidden="true">${anchorPoints(target).map(a=>`<circle cx="${a.x}" cy="${a.y}" r="${2.5*unit}" fill="white" stroke="#0d9692" stroke-width="${unit}"/>`).join('')}<circle data-snap-active cx="${snap.x}" cy="${snap.y}" r="${6*unit}" fill="#e1f7f4" stroke="#0d9692" stroke-width="${2*unit}"/></g>`);}}
 function draw(){drawStage();const o=m.objects.find(o=>o.id===selected),e=m.edges.find(e=>e.id===selected);q('[data-action="undo"]').disabled=!history.length;q('[data-action="copy"]').disabled=!(o||picked.some(key=>m.objects.some(node=>node.id===key)));
  q('[data-action="delete"]').disabled=!(selected||picked.length);
  q('[data-add="callout"]')?.toggleAttribute('disabled',!m.objects.some(item=>item.type==='photo'));
  if(calloutPoint){drawCalloutControls();return;}
  q('.object-properties').innerHTML=picked.length?`<strong>已选中 ${picked.length} 个元素</strong><p>拖动选中的节点可一起移动，也可复制、删除或撤销。</p>`:o?`<strong>对象属性</strong><label>文字<textarea data-prop="text">${esc(o.text)}</textarea></label>${o.processId?'<small>文字关联 SOP 工序。修改文字后转为自定义。</small>':''}<label>形状<select data-prop="type">${(o.type==='photo'?[o.type]:(o.type==='text'?['text','rect','ellipse','diamond','triangle','arrow','line']:['rect','ellipse','diamond','triangle','arrow','line'])).map(t=>`<option value="${t}" ${t===o.type?'selected':''}>${({photo:'照片',text:'文字框',rect:'矩形',ellipse:'椭圆',diamond:'菱形',triangle:'三角形',arrow:'箭头',line:'直线'})[t]}</option>`).join('')}</select></label>${(['arrow','line','photo'].includes(o.type)?[]:['fontSize']).map(k=>`<label>字号<input data-prop="${k}" type="number" value="${o[k]}"></label>`).join('')}${['arrow','line'].includes(o.type)?`<div class="line-endpoints"><label>角度（°）<input data-line-angle type="number" step="0.1" value="${Number(lineAngle(o).toFixed(1))}"></label><label>长度<input data-line-length type="number" min="1" step="0.1" value="${Number(Math.hypot(o.w,o.h).toFixed(1))}"></label><small>拖动两端圆点调整方向。靠近角点或中点约 10px 时连接并跟随。${!flow&&o.type==='arrow'&&!o.calloutArrow?'也可固定在照片内部。':''}拖离解除，按住 Alt 自由定位。</small></div>`:''}${o.type!=='photo'?`<label>线条粗细<input data-prop="strokeWidth" type="number" min="0.5" max="20" step="0.5" value="${o.strokeWidth}"></label>`:''}${o.type==='photo'?'<label>旋转角度（°）<input data-photo-angle type="number" min="-180" max="180" step="0.1" value="0"></label><input data-photo-slider type="range" aria-label="旋转角度" min="-180" max="180" value="0"><button type="button" data-rotate-photo>应用旋转</button><small>正数向右旋转。距直角 4° 以内自动吸附。</small>':''}<div data-object-color></div><div data-object-fill></div>${['arrow','line'].includes(o.type)?'<button data-flip="flipX">左右翻转箭头</button><button data-flip="flipY">上下翻转箭头</button>':''}`:e?`<strong>连接线</strong><label>分支标签<input data-edge-label value="${esc(e.label)}"></label><label>线条粗细<input data-edge-width type="number" min="0.5" max="20" step="0.5" value="${e.strokeWidth}"></label>${e.join?'<small>拖动线末端圆点可沿主线移动汇入位置。</small>':`<label>走线<select data-edge-route><option value="" ${!e.route?'selected':''}>直线</option><option value="down" ${e.route==='down'?'selected':''}>直角折线（上下接入）</option><option value="across" ${e.route==='across'?'selected':''}>直角折线（左右接入）</option></select></label><small>拖动连线上的圆点调整走线。</small>`}<div data-edge-color></div><small>可拖动标签。移动关联节点时连线自动跟随。</small>`:'<strong>页面对象</strong><p>点击文字、照片、形状或连线进行编辑。</p>';
  if(o){SOP_COLORS.mount(q('[data-object-color]'),{label:'文字 / 线条',value:o.color,onChange:color=>{push();o.color=color;
   if(o.callout)for(const arrow of m.objects)if(arrow.calloutArrow&&arrow.attachments?.start?.targetId===o.id)arrow.color=color;
   remember(o);draw();}});SOP_COLORS.mount(q('[data-object-fill]'),{label:'填充',value:o.fill,transparent:true,onChange:color=>{push();o.fill=color;remember(o);draw();}});}if(e)SOP_COLORS.mount(q('[data-edge-color]'),{label:'连线颜色',value:e.color,onChange:color=>{push();e.color=color;remember({...e,type:'edge'});draw();}});if(q('[data-line-angle]'))q('[data-line-angle]').onchange=ev=>{push();delete o.attachments;setLineAngle(o,ev.target.value,bounds());draw();};if(q('[data-line-length]'))q('[data-line-length]').onchange=ev=>{push();delete o.attachments;setLineAngle(o,lineAngle(o),bounds(),ev.target.value);draw();};
  const angleInput=q('[data-photo-angle]'), slider=q('[data-photo-slider]'), rotateButton=q('[data-rotate-photo]');
  if(slider)slider.oninput=()=>{angleInput.value=slider.value;};
  if(angleInput)angleInput.oninput=()=>{slider.value=angleInput.value;};
  if(rotateButton)rotateButton.onclick=async()=>{
   const button=rotateButton, source=o.data, rendered=o.rendered;
   const raw=Number(angleInput.value), rightAngle=Math.round(raw/90)*90;
   if(!angleInput.reportValidity())return;
   const degrees=Math.abs(raw-rightAngle)<=4?rightAngle:raw;
   if(!degrees)return;
   const angle=degrees*Math.PI/180, cos=Math.cos(angle), sin=Math.sin(angle);
   const size=(w,h)=>[Math.abs(cos)*w+Math.abs(sin)*h,Math.abs(sin)*w+Math.abs(cos)*h];
   async function rotate(data){
    const image=new Image();
    image.src=data;
    await image.decode();
    const canvas=document.createElement('canvas');
    const [width,height]=size(image.naturalWidth,image.naturalHeight);
    canvas.width=Math.ceil(width-1e-8);canvas.height=Math.ceil(height-1e-8);
    const ctx=canvas.getContext('2d');
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate(angle);
    ctx.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);
    const result=canvas.toDataURL('image/png');
    if(result==='data:,')throw Error('图片尺寸过大');
    return result;
   }
   try {
    const data=await rotate(source);
    const rotatedPreview=rendered&&rendered!==source?await rotate(rendered):undefined;
    if(!button.isConnected||m.objects.find(item=>item.id===selected)!==o||o.data!==source)return;
    push();
    o.data=data;
    o.rendered=rotatedPreview;
    const [w,h]=size(o.w,o.h);
    const rotatePoint=(x,y)=>[.5+((x-.5)*o.w*cos-(y-.5)*o.h*sin)/w,.5+((x-.5)*o.w*sin+(y-.5)*o.h*cos)/h];
    for(const mark of o.marks||[]){
     const end=rotatePoint(mark.x2??mark.x,mark.y2??mark.y);
     [mark.x,mark.y]=rotatePoint(mark.x,mark.y);
     [mark.x2,mark.y2]=end;
    }
    mapPhotoAttachmentPoints(m,o.id,rotatePoint);
    [o.w,o.h]=[w,h];
    o.aspectRatio=o.w/o.h;
    draw();
   } catch {if(button.isConnected)button.textContent='旋转失败，请重试';}
  };
  q('.object-properties').querySelectorAll('[data-prop]').forEach(el=>{
   const key=el.dataset.prop;
   if(key==='text'){
    el.oninput=()=>{
     const previous=propertyTextPreview||o;
     propertyTextPreview=fitCalloutText({...o,text:el.value,processId:undefined,prefix:undefined});
     const display=q('.object-stage [data-object="'+CSS.escape(o.id)+'"] [data-object-text]');
     if(display&&previous.h===propertyTextPreview.h&&previous.y===propertyTextPreview.y)display.value=el.value;
     else drawStage();
    };
    el.onchange=()=>{
     propertyTextPreview=null;
     if(el.value!==o.text){
      push();delete o.processId;delete o.prefix;o.text=el.value;fitCalloutText(o);m.height=Math.max(m.height,o.h);
     }
     drawStage();q('[data-action="undo"]').disabled=!history.length;
    };
    return;
   }
   el.onchange=()=>{
    push();o[key]=['fontSize','strokeWidth'].includes(key)?Number(el.value):el.value;
    m=normalize(m);const edited=m.objects.find(v=>v.id===selected);
    if(key==='fontSize'){fitCalloutText(edited);m.height=Math.max(m.height,edited.h);}
    remember(edited);draw();
   };
  });if(q('[data-edge-width]'))q('[data-edge-width]').onchange=ev=>{push();e.strokeWidth=Math.max(.5,Math.min(20,finite(ev.target.value,2)));remember({...e,type:'edge'});draw();};if(q('[data-edge-route]'))q('[data-edge-route]').onchange=ev=>{push();e.route=ev.target.value;delete e.bend;draw();};if(q('[data-edge-label]'))q('[data-edge-label]').onchange=ev=>{push();e.label=ev.target.value;draw();};q('.object-properties').querySelectorAll('[data-flip]').forEach(b=>b.onclick=()=>{push();delete o.attachments;o[b.dataset.flip]=!o[b.dataset.flip];draw();});if(q('[data-transparent]'))q('[data-transparent]').onclick=()=>{push();o.fill='transparent';remember(o);draw();};
 }
 function finishInline(commit=true){
  if(!inlineEdit)return;
  const edit=inlineEdit,text=edit.input.value;
  if(calloutPoint&&commit){
   if(!text.trim()){message('请输入标注文字。');edit.input.focus();return;}
   if(calloutHeight(text,edit.object.w,edit.object.fontSize)>bounds().height-8){
    message('标注文字超出画布可用高度，请缩短文字。');edit.input.focus();return;
   }
  }
  inlineEdit=null;
  if(calloutPoint){
   if(commit){
    push(calloutPoint.previous);Object.assign(edit.object,edit.preview);remember(edit.object);
   }else{m=calloutPoint.previous;selected='';}
   calloutPoint=null;tool='';
   message(commit?'已添加标注。拖动文字框可调整位置。':'已取消照片标注。');
  }else if(commit&&text!==edit.object.text){
   push();Object.assign(edit.object,edit.preview);delete edit.object.processId;delete edit.object.prefix;
   m.height=Math.max(m.height,edit.object.h);
  }
  edit.host.remove();draw();q('.object-stage').focus({preventScroll:true});
 }
 function mountInline(o){
  const centered=o.type==='rect';
  const host=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
  const container=document.createElement('div'),input=document.createElement('textarea');
  if(centered)host.setAttribute('overflow','visible');
  input.rows=1;input.value=o.text;input.dataset.inlineText='';
  input.setAttribute('aria-label',calloutPoint?'标注文字':'画布内编辑文字');
  if(calloutPoint){input.dataset.calloutText='';input.placeholder='输入标注文字';}
  container.className='object-inline-editor'+(centered?' object-inline-centered':'');
  input.style.fontSize=o.fontSize+'px';input.style.color=o.color;
  input.style.textAlign=o.type==='text'?'left':'center';
  container.append(input);host.append(container);q('svg').append(host);
  inlineEdit={object:o,input,host,preview:o};
  function resizeEditor(){
   const preview=fitCalloutText({...o,text:input.value}),previous=inlineEdit.preview;
   inlineEdit.preview=preview;
   for(const [key,value]of Object.entries({x:preview.x,y:preview.y,width:preview.w,height:preview.h}))host.setAttribute(key,value);
   if(previous.h!==preview.h||previous.y!==preview.y)drawStage();
  }
  resizeEditor();drawStage();
  input.oninput=resizeEditor;
  input.onpointerdown=event=>event.stopPropagation();input.ondblclick=event=>event.stopPropagation();
  input.onkeydown=event=>{
   event.stopPropagation();
   if(event.isComposing||event.keyCode===229)return;
   if(event.key==='Escape'){event.preventDefault();finishInline(false);}
   else if(event.key==='Enter'&&(calloutPoint?!event.shiftKey:event.ctrlKey||event.metaKey)){
    event.preventDefault();finishInline();
   }
  };
  if(!calloutPoint)input.onblur=()=>finishInline();
  input.focus();input.select();
  message(calloutPoint?'Enter 添加，Shift+Enter 换行，Esc 取消。':'直接输入文字；Enter 换行，Ctrl+Enter 完成，Esc 取消。');
 }
 function beginInline(key=selected){
  if(inlineEdit)return;
  const o=m.objects.find(o=>o.id===key);if(!o||!['text','rect','ellipse','diamond','triangle'].includes(o.type)){message('请先选择矩形、椭圆、菱形或文字框。');return;}
  drag=null;linkFrom='';selected=o.id;draw();mountInline(o);
 }
 function drawCalloutControls(){
  q('.object-properties').innerHTML='<div class="object-callout-form"><strong>照片标注</strong><div class="row"><button class="primary" data-callout-apply type="button">添加标注</button><button data-callout-cancel type="button">取消</button></div></div>';
  q('[data-callout-apply]').onclick=()=>finishInline();
  q('[data-callout-cancel]').onclick=cancelCallout;
 }
 function beginCalloutAt({x,y},photo){
   const area=bounds(),label=newShape('rect',{callout:true});
   const fontSize=Math.max(8,Math.min(80,finite(label.fontSize,20)));
   const w=Math.min(area.width,Math.max(150,Math.min(250,fontSize*8+8)));
   const h=calloutHeight('',w,fontSize),bottom=area.height-8;
   if(h>bottom){message('画布可用高度不足，请先调整正文或字号。');return;}
   const gap=24,nearX=Math.max(0,Math.min(area.width-w,x-w/2)),nearY=Math.max(0,Math.min(bottom-h,y-h/2));
   const spots=[];
   for(const offset of [0,-1,1,-2,2]){
    const sideX=Math.max(0,Math.min(area.width-w,nearX+offset*(w+8)));
    const sideY=Math.max(0,Math.min(bottom-h,nearY+offset*(h+8)));
    spots.push({x:photo.x+photo.w+gap,y:sideY},{x:photo.x-w-gap,y:sideY},
     {x:sideX,y:photo.y+photo.h+gap},{x:sideX,y:photo.y-h-gap});
   }
   spots.push({x:x+gap,y:nearY},{x:x-w-gap,y:nearY},{x:nearX,y:y+gap},{x:nearX,y:y-h-gap});
   const fits=p=>p.x>=0&&p.x+w<=area.width&&p.y>=0&&p.y+h<=bottom;
   const blockers=m.objects.filter(o=>o.type==='photo'||o.callout);
   const clear=p=>blockers.every(o=>p.x+w<=o.x||p.x>=o.x+o.w||p.y+h<=o.y||p.y>=o.y+o.h);
   const location=spots.find(p=>fits(p)&&clear(p))||spots.find(fits)||{x:nearX,y:nearY};
   Object.assign(label,{...location,w,h,fontSize});
   const anchorIndex=facingEdgeAnchor(label,{x,y}),start=anchorPoints(label)[anchorIndex];
   const arrow=newShape('arrow',{calloutArrow:true,color:remembered.arrow?.color??label.color,attachments:{
    start:{targetId:label.id,anchorIndex,auto:true},
    end:photoAttachment(photo,{x,y})
   }});
   setLineEndpoints(arrow,{x1:start.x,y1:start.y,x2:x,y2:y});
   calloutPoint={previous:m};
   m=normalize({...m,objects:[...m.objects,label,arrow]});selected=label.id;
   draw();mountInline(m.objects.find(o=>o.id===selected));
 }
 function cancelCallout(){
  if(calloutPoint){finishInline(false);return;}
  tool='';draw();q('.object-stage').focus({preventScroll:true});
  message('已取消照片标注。');
 }
 const xy=(ev,svgCoordinates=false)=>{
  const sheet=q('svg');
  if(flow||svgCoordinates)return new DOMPoint(ev.clientX,ev.clientY).matrixTransform(sheet.getScreenCTM().inverse());
  const rect=sheet.getBoundingClientRect();
  return {x:(ev.clientX-rect.left)*m.width/rect.width,y:(ev.clientY-rect.top)*m.height/rect.height};
 };
 const insideCanvas=p=>({x:Math.max(0,Math.min(m.width,p.x)),y:Math.max(0,Math.min(bounds().height,p.y))});
 function endpointAnchor(o,key,point,altKey){
  if(altKey)return null;
  const sheet=q('svg'),rect=sheet.getBoundingClientRect();
  const matrix=!flow&&o.type==='arrow'?sheet.getScreenCTM():null;
  const scale=matrix?{x:Math.hypot(matrix.a,matrix.b),y:Math.hypot(matrix.c,matrix.d)}:{x:rect.width/m.width,y:rect.height/m.height};
  const photoAllowed=o.calloutArrow?key==='end':!flow&&o.type==='arrow';
  const visible=photoAllowed?(target,anchor)=>target.type!=='photo'||photoAt(m,anchor)===target:undefined;
  const anchor=nearestAnchor(m,point,o.id,scale,10,visible);
  if(anchor||!photoAllowed)return anchor;
  const photo=photoAt(m,point);
  return photo?{...photoAttachment(photo,point),...point,kind:'photo-point'}:null;
 }
 function updateEndpoint(o,key,point,ends,altKey){
  snap=endpointAnchor(o,key,point,altKey);
  const n=key==='start'?'1':'2',position=snap||point;
  ends['x'+n]=position.x;ends['y'+n]=position.y;
  attachEndpoint(m,o,key,snap);setLineEndpoints(o,ends);
 }
 q('.object-stage').tabIndex=0;
 q('.object-stage').onpointerdown=ev=>{if(inlineEdit||ev.button!==0)return;ev.preventDefault();if(calloutPoint)return;q('.object-stage').focus({preventScroll:true});snap=null;
  if(tool==='callout'){
   if(!ev.target.closest('svg'))return;
   const {x,y}=new DOMPoint(ev.clientX,ev.clientY).matrixTransform(q('svg').getScreenCTM().inverse());
   const photo=photoAt(m,{x,y});
   if(!photo||y>bounds().height){message('请点击白色画布区域内的照片。');return;}
   if(m.objects.length>298){message('添加标注需要两个对象位置，请先删除不需要的对象。');return;}
   beginCalloutAt({x,y},photo);return;
  }
  if(tool){
   if(!ev.target.closest('svg'))return;
   const p=insideCanvas(xy(ev,tool==='arrow'));push();
   const o=newShape(tool,{x:p.x,y:p.y,w:0,h:0});
   if(['arrow','line'].includes(o.type)){
    const anchor=endpointAnchor(o,'start',p,ev.altKey);
    if(anchor){
     p.x=o.x=anchor.x;p.y=o.y=anchor.y;attachEndpoint(m,o,'start',anchor);
    }
   }
   m.objects.push(o);selected=o.id;creating={id:o.id,p,clientX:ev.clientX,clientY:ev.clientY,moved:false};
   q('.object-stage').setPointerCapture(ev.pointerId);draw();return;
  }
  const g=ev.target.closest('[data-object]'),key=g?.dataset.object||'';
 if(flow&&(boxMode||(!key&&!linkFrom&&ev.target.closest('svg')))){
  picked=[];selected='';lastTap=null;boxMode=false;linkFrom='';
  marquee={start:xy(ev),box:null};q('.object-stage').setPointerCapture(ev.pointerId);draw();return;
 }
 if(picked.includes(key)&&m.objects.some(o=>o.id===key)){
  push();drag={id:key,group:true,origins:m.objects.filter(o=>picked.includes(o.id)).map(o=>({...o})),
   p:xy(ev),clientX:ev.clientX,clientY:ev.clientY};
  q('.object-stage').setPointerCapture(ev.pointerId);return;
 }
 picked=[];selected=key;const edge=m.edges.find(e=>e.id===selected);
 if(linkFrom&&edge&&!edge.join&&edge.from!==linkFrom&&edge.to!==linkFrom){
  push();
  m.edges.push({id:id(),from:linkFrom,join:edge.id,ratio:projectOnRoute(flowRoute(m,edge),xy(ev)),label:'',color:'#243e46',strokeWidth:2,...remembered.edge});
  selected=m.edges.at(-1).id;linkFrom='';draw();message('支线已汇入，可拖动末端调整。');return;
 }
 if(edge&&ev.target.dataset.flowHandle){
  push();drag={id:edge.id,flowHandle:ev.target.dataset.flowHandle,p:xy(ev),clientX:ev.clientX,clientY:ev.clientY,bend:finite(edge.bend,0)};
  if(drag.flowHandle==='label'){
   const points=flowRoute(m,edge),label=flowLabel(points,edge,m),mid=pointOnRoute(points,.5);
   drag.labelX=label.x-mid.x;drag.labelY=label.y-mid.y;
  }
  q('.object-stage').setPointerCapture(ev.pointerId);draw();return;
 }
 if(linkFrom&&selected&&m.objects.some(o=>o.id===selected)){if(linkFrom!==selected){push();m.edges.push({id:id(),from:linkFrom,to:selected,label:'',...remembered.edge});linkFrom='';message('连线已创建，可点击编辑分支标签。');}draw();return;}const o=m.objects.find(o=>o.id===selected);if(o){push();drag={id:o.id,clientX:ev.clientX,clientY:ev.clientY,moved:false,p:xy(ev),x:o.x,y:o.y,w:o.w,h:o.h,resize:ev.target.dataset.resize,endpoint:ev.target.dataset.endpoint,points:lineEndpoints(o)};q('.object-stage').setPointerCapture(ev.pointerId);}draw();};
 q('.object-stage').onpointermove=ev=>{
  if(marquee){
   const p=xy(ev),a=marquee.start;
   marquee.box={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),w:Math.abs(p.x-a.x),h:Math.abs(p.y-a.y)};
   picked=nodesInBox(m,marquee.box);queueStageDraw();return;
  }
  if(creating){
   const o=m.objects.find(o=>o.id===creating.id),p=insideCanvas(xy(ev,o.type==='arrow'));
   creating.moved=Math.hypot(ev.clientX-creating.clientX,ev.clientY-creating.clientY)>=4;
   if(['arrow','line'].includes(o.type))updateEndpoint(o,'end',p,{x1:creating.p.x,y1:creating.p.y},ev.altKey);
   else Object.assign(o,{x:Math.min(p.x,creating.p.x),y:Math.min(p.y,creating.p.y),w:Math.abs(p.x-creating.p.x),h:Math.abs(p.y-creating.p.y)});
   queueStageDraw();return;
  }
  if(!drag)return;
  const distance=Math.hypot(ev.clientX-drag.clientX,ev.clientY-drag.clientY);
  if(!drag.moved&&distance<4)return;
  drag.moved=true;lastTap=null;
  const o=m.objects.find(o=>o.id===drag.id),p=xy(ev,!!drag.endpoint&&o?.type==='arrow'),dx=p.x-drag.p.x,dy=p.y-drag.p.y;
  if(drag.flowHandle){
  const edge=m.edges.find(e=>e.id===drag.id);
  if(drag.flowHandle==='label'){edge.labelX=drag.labelX+dx;edge.labelY=drag.labelY+dy;}
  const tolerance=ev.altKey?0:7/Math.abs(q('svg').getScreenCTM().a);
  if(drag.flowHandle==='bend'){
   edge.bend=drag.bend+(edge.route==='across'?dx:dy);
   guides=tolerance?snapBend(m,edge,tolerance):null;
  }
  if(drag.flowHandle==='join')guides=snapJoin(m,edge,p,tolerance);
  queueStageDraw();return;
 }
 if(drag.endpoint)updateEndpoint(o,drag.endpoint,insideCanvas(p),{...drag.points},ev.altKey);
 else if(drag.resize){resizeCorner(o,drag,drag.resize,dx,dy,bounds());}
 else if(flow&&(drag.group||!['arrow','line'].includes(o.type))){
  const origins=drag.origins||[{id:o.id,x:drag.x,y:drag.y,w:drag.w,h:drag.h}];
  const scale=Math.abs(q('svg').getScreenCTM().a);
  guides=alignDrag(m,origins,dx,dy,ev.altKey?0:7/scale);
  for(const origin of origins){
   const node=m.objects.find(item=>item.id===origin.id);
   for(const [end,anchor] of Object.entries(node.attachments||{}))if(!picked.includes(anchor.targetId))delete node.attachments[end];
   node.x=origin.x+guides.dx;node.y=origin.y+guides.dy;
  }
 }else{if(['arrow','line'].includes(o.type))delete o.attachments;o.x=Math.max(0,Math.min(m.width-o.w,drag.x+dx));o.y=Math.max(0,Math.min(bounds().height-o.h,drag.y+dy));}queueStageDraw();};q('.object-stage').onpointerup=ev=>{
  if(marquee){
   marquee=null;if(picked.length===1){selected=picked[0];picked=[];}
   draw();return;
  }
  guides=null;
  if(creating){
   if(!creating.moved){m=history.pop();selected='';}
   else {
    const o=m.objects.find(o=>o.id===creating.id);
    if(!flow&&o.type==='arrow')updateEndpoint(o,'end',insideCanvas(xy(ev,true)),{x1:creating.p.x,y1:creating.p.y},ev.altKey);
    m=normalize(m);remember(m.objects.find(o=>o.id===selected));tool='';
   }
   creating=null;snap=null;draw();message(tool?'请按下并拖动绘制；Esc 取消。':'已添加，可调整文字、颜色和粗细。');return;
  }
  const ended=drag;drag=null;snap=null;if(inlineEdit)return;
  if(ended?.endpoint&&ended.moved&&!flow){
   const o=m.objects.find(o=>o.id===ended.id);
   if(o?.type==='arrow'){
    updateEndpoint(o,ended.endpoint,insideCanvas(xy(ev,true)),{...ended.points},ev.altKey);snap=null;
   }
  }
  if(calloutPoint)return;
  if(ended&&!ended.group&&!ended.flowHandle&&!ended.moved&&!ended.resize&&!ended.endpoint){
   const now=performance.now(),double=lastTap&&lastTap.id===ended.id&&now-lastTap.time<500&&Math.hypot(ev.clientX-lastTap.x,ev.clientY-lastTap.y)<6;
   lastTap={id:ended.id,time:now,x:ev.clientX,y:ev.clientY};
   if(double){lastTap=null;beginInline(ended.id);return;}
  }else lastTap=null;
  draw();
 };q('.object-stage').onpointercancel=()=>{guides=null;if(marquee){marquee=null;picked=[];}if(creating){m=history.pop();creating=null;selected='';}else if(drag)m=history.pop()||m;drag=null;snap=null;if(!inlineEdit&&!calloutPoint)draw();};
 d.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
  if(tool==='callout'&&b.dataset.add==='callout'){cancelCallout();return;}
  if(calloutPoint)cancelCallout();
  else if(inlineEdit)finishInline();
  tool=b.dataset.add;linkFrom='';selected='';picked=[];boxMode=false;lastTap=null;draw();
  message(tool==='callout'?'点击照片上需要标注的位置，Esc 取消。':'请在画布按下并拖动绘制；Esc 取消。');
 });
 function action(name){
  if(calloutPoint&&name==='save'){message('请先添加或取消当前标注。');q('[data-callout-text]').focus();return;}
  if(tool==='callout'&&name!=='close'&&name!=='save')cancelCallout();
  tool='';
  if(creating){m=history.pop();creating=null;selected='';}
  if(name==='editText'){beginInline();return;}
  if(inlineEdit)finishInline(name!=='close');
  if(name==='box'){
   boxMode=!boxMode;linkFrom='';picked=[];selected='';draw();
   message(boxMode?'按住并拖出选择框。':'已退出框选。');return;
  }
  boxMode=false;
  if(name==='close'){d.close();dispose();}
  else if(name==='save'){onSave?.(normalize(m));d.close();dispose();}
  else if(name==='undo'&&history.length){m=history.pop();picked=[];selected='';draw();}
  else if(name==='delete'&&(picked.length||selected)){
   push();for(const key of picked.length?picked:[selected])remove(m,key);
   picked=[];selected='';draw();
  }else if(name==='copy'){
   if(picked.length){
    push();const copies=duplicateSelection(m,picked);
    if(copies.length)picked=copies;else history.pop();
   }else if(m.objects.some(o=>o.id===selected)){push();selected=duplicate(m,selected);}
   draw();
  }else if(name==='connect'){
   if(m.objects.some(o=>o.id===selected)){linkFrom=selected;message('现在点击目标节点或要汇入的连接线');}
   else message('请先选择起点节点');
  }else if(name==='upload')q('#objectPhoto').click();
 }
 d.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
 if(!flow){
  const input=q('#objectPhoto');
  let addingPhoto=false;
  async function addPhoto(file,{pasted=false}={}){
   if(!file||addingPhoto)return;
   if(m.objects.length>=300){message('画布对象已满，请先删除不需要的对象。');return;}
   addingPhoto=true;
   try{
    const {data,sourceWidth,sourceHeight}=await readPhoto(file);
    if(!d.open||!d.isConnected)return;
    if(creating||drag||inlineEdit||calloutPoint){message('请先完成当前编辑，再添加图片。');return;}
    const area=bounds();
    if(area.height<10){message('图文区剩余空间不足，请先调整正文。');return;}
    const scale=Math.min(360/sourceWidth,240/sourceHeight,area.width/sourceWidth,area.height/sourceHeight);
    const w=sourceWidth*scale,h=sourceHeight*scale;
    const x=pasted?(area.width-w)/2:Math.min(80,area.width-w);
    const y=pasted?(area.height-h)/2:Math.min(80,area.height-h);
    if(m.objects.length>=300){message('画布对象已满，请先删除不需要的对象。');return;}
    const photo={id:id(),type:'photo',data,x,y,w,h,aspectRatio:w/h};
    push();m=normalize({...m,objects:[...m.objects,photo]});
    selected=photo.id;picked=[];tool='';snap=null;boxMode=false;
    draw();message(pasted?'已粘贴图片，可拖动或缩放。':'已添加图片，可拖动或缩放。');
   }catch(error){if(d.open)message(error.message||'无法读取这张图片，请重新复制或从文件添加。');}
   finally{addingPhoto=false;}
  }
  input.onchange=()=>{const file=input.files[0];input.value='';void addPhoto(file);};
  d.onpaste=event=>{
   if(event.target.closest('input,textarea,select,[contenteditable]'))return;
   const file=[...(event.clipboardData?.files||[])].find(item=>item.type.startsWith('image/'));
   if(!file)return;
   event.preventDefault();event.stopPropagation();
   void addPhoto(file,{pasted:true});
  };
 }

 d.onkeydown=ev=>{
 if(ev.key==='Escape'&&tool==='callout'){
  if(ev.isComposing||ev.keyCode===229)return;
  ev.preventDefault();cancelCallout();return;
 }
 if(ev.key==='Escape'&&(marquee||boxMode||picked.length)){
  ev.preventDefault();if(drag?.group){m=history.pop()||m;drag=null;guides=null;}marquee=null;boxMode=false;picked=[];draw();return;
 }
 if(ev.key==='Escape'&&(tool||creating)){ev.preventDefault();if(creating){m=history.pop();creating=null;selected='';}tool='';snap=null;draw();message('已取消绘制');return;}if(/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName))return;if(ev.key==='F2'){ev.preventDefault();beginInline();return;}if(ev.key==='Delete'){ev.preventDefault();action('delete');}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();action('undo');}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='d'){ev.preventDefault();action('copy');}};d.oncancel=dispose;draw();if(drawingHeight)message(contentHeight(m)>drawingHeight?'白色区域为文字之外的可用画布；灰色区域有超出元素，请手动移回或缩小。':'白色区域为文字之外的可用画布；文字和图片不自动缩放。');d.showModal();if(!flow){q('.object-stage').focus({preventScroll:true});if(startCallout)q('[data-add="callout"]').click();}
}
const api={photoMaxEdge:PHOTO_MAX_EDGE,readPhoto,encodePhotoCanvas,contentHeight,attachEndpoint,syncConnections,mapPhotoAttachmentPoints,anchorPoints,nearestAnchor,resizeCorner,lineEndpoints,setLineEndpoints,lineAngle,setLineAngle,wrapText,rectTextWrapped,flowTextWidth,normalize,edgePoints,flowRoute,flowLabel,flowShapes,generateFlow,resolvedFlow,remove,duplicate,fromPhotos,restorePhotoCaptions,fromProcesses,svg,open};if(typeof module!=='undefined')module.exports=api;root.SOP_OBJECTS=api;
})(typeof window==='undefined'?globalThis:window);
