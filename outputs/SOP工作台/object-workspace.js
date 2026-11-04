/* Local, serializable page objects. The same geometry feeds SVG preview and native Word. */
((root) => {
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x)),id=()=>globalThis.crypto?.randomUUID?.()||'obj-'+Math.random().toString(36).slice(2),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let renderId=0;
const styleKey='sop-object-styles-v1';let remembered={};try{remembered=JSON.parse(root.localStorage?.getItem(styleKey)||'{}')||{};}catch{}
function remember(o){remembered[o.type]={fontSize:o.fontSize,color:o.color,fill:o.fill,strokeWidth:o.strokeWidth};try{root.localStorage?.setItem(styleKey,JSON.stringify(remembered));}catch{}}

const finite=(n,f)=>Number.isFinite(Number(n))?Number(n):f;
function normalize(input){
 const m=clone(input||{width:900,height:520,objects:[],edges:[]});m.width=Math.max(100,Math.min(4000,finite(m.width,900)));m.height=Math.max(100,Math.min(4000,finite(m.height,520)));m.objects=Array.isArray(m.objects)?m.objects:[];m.edges=Array.isArray(m.edges)?m.edges:[];
 const seen=new Set();m.objects=m.objects.filter(o=>['photo','text','rect','ellipse','diamond','triangle','arrow','line'].includes(o.type)).slice(0,300).map(o=>{o.id=o.id&&!seen.has(o.id)?o.id:id();seen.add(o.id);o.w=Math.max(['line','arrow'].includes(o.type)?0:10,Math.min(m.width,finite(o.w,180)));o.h=Math.max(['line','arrow'].includes(o.type)?0:10,Math.min(m.height,finite(o.h,60)));if(['line','arrow'].includes(o.type))o.w=Math.max(0,Math.min(m.width,finite(o.w,180)));o.x=Math.max(0,Math.min(m.width-o.w,finite(o.x,30)));o.y=Math.max(0,Math.min(m.height-o.h,finite(o.y,30)));o.strokeWidth=Math.max(.5,Math.min(20,finite(o.strokeWidth,['arrow','line'].includes(o.type)?3:2)));o.fontSize=Math.max(8,Math.min(80,finite(o.fontSize,20)));o.color=/^#[a-f\d]{6}$/i.test(o.color)?o.color:'#243e46';o.fill=/^#[a-f\d]{6}$/i.test(o.fill)?o.fill:'transparent';o.text=String(o.text||'');if(o.type==='photo'){o.aspectRatio=finite(o.aspectRatio,o.w/Math.max(1,o.h));o.h=o.w/Math.max(.01,o.aspectRatio);if(o.h>m.height-o.y){o.h=m.height-o.y;o.w=o.h*o.aspectRatio;}}if(o.type==='photo'&&!/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(o.data||''))throw Error('画布图片必须是本地 PNG、JPEG 或 WebP 数据');return o;});
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
function nearestAnchor(model,point,excludeId,scale={x:1,y:1},radius=10){
 let closest=null,distance=radius;
 for(const o of model.objects){if(o.id===excludeId)continue;for(const [anchorIndex,anchor] of anchorPoints(o).entries()){const d=Math.hypot((anchor.x-point.x)*scale.x,(anchor.y-point.y)*scale.y);if(d<=distance){distance=d;closest={...anchor,targetId:o.id,anchorIndex};}}}
 return closest;
}
// Persist an anchor index, rather than a pixel position, so resizing keeps the same corner/midpoint.
function attachEndpoint(model,o,key,anchor){
 o.attachments=o.attachments||{};delete o.attachments[key];
 if(anchor){const seen=new Set(),depends=id=>{if(id===o.id)return true;if(seen.has(id))return false;seen.add(id);const target=model.objects.find(v=>v.id===id);return Object.values(target?.attachments||{}).some(a=>a&&depends(a.targetId));};
  if(!depends(anchor.targetId))o.attachments[key]={targetId:anchor.targetId,anchorIndex:anchor.anchorIndex};
 }
 if(!Object.keys(o.attachments).length)delete o.attachments;
}
function syncConnections(model){
 const objects=new Map(model.objects.map(o=>[o.id,o])),state=new Map();
 function visit(o){if(state.get(o.id)===2)return;state.set(o.id,1);
  if(!['arrow','line'].includes(o.type)){delete o.attachments;state.set(o.id,2);return;}
  const ends=lineEndpoints(o),bindings={};
  for(const [key,n]of [['start','1'],['end','2']]){const a=o.attachments?.[key],target=objects.get(a?.targetId);if(!target||target===o||state.get(target.id)===1||!Number.isInteger(a.anchorIndex))continue;visit(target);const point=anchorPoints(target)[a.anchorIndex];if(!point)continue;bindings[key]={targetId:target.id,anchorIndex:a.anchorIndex};ends['x'+n]=point.x;ends['y'+n]=point.y;}
  if(Object.keys(bindings).length)o.attachments=bindings;else delete o.attachments;setLineEndpoints(o,ends);state.set(o.id,2);
 }
 for(const o of model.objects)visit(o);return model;
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
 return node.w*({diamond:.56,ellipse:.72,triangle:.40}[node.type]||.93);
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
  const fraction={diamond:.40,ellipse:.62,triangle:.32}[type]||1;
  o.h=Math.max(minimum,Math.ceil((lines*o.fontSize*1.25+14)/fraction));
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

function remove(m,key){syncConnections(m);m.objects=m.objects.filter(o=>o.id!==key);const removed=new Set(m.edges.filter(e=>e.id===key||e.from===key||e.to===key).map(e=>e.id));m.edges=m.edges.filter(e=>!removed.has(e.id)&&!removed.has(e.join));syncConnections(m);}
function duplicate(m,key){const o=m.objects.find(x=>x.id===key);if(!o)return null;const n={...clone(o),id:id(),x:Math.min(m.width-o.w,o.x+20),y:Math.min(m.height-o.h,o.y+20)};delete n.attachments;delete n.processId;delete n.prefix;m.objects.push(n);return n.id;}
function fromPhotos(photos){
 const m={width:900,height:520,objects:[],edges:[]};
 (photos||[]).forEach((ph,i)=>{const x=40+(i%2)*440,y=40+Math.floor(i/2)*270,ratio=(ph.width&&ph.height)?ph.width/ph.height:1,w=Math.min(370,200*ratio),h=w/ratio;m.height=Math.max(m.height,y+h+70);m.objects.push({id:id(),type:'photo',data:ph.data,x,y,w,h});
  for(const mark of ph.marks||[]){const fs=(mark.fontSize||.036)*w,isText=mark.type==='text',x2=mark.x2??mark.x,y2=mark.y2??mark.y;m.objects.push({id:id(),type:mark.type==='circle'?'ellipse':mark.type,x:x+(isText?mark.x:Math.min(mark.x,x2))*w,y:y+(isText?mark.y*h-fs:Math.min(mark.y,y2)*h),w:isText?Math.max(40,Array.from(mark.text||'').reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.58),0)*fs+8):Math.abs(x2-mark.x)*w,h:isText?fs*1.4:Math.abs(y2-mark.y)*h,text:mark.text,fontSize:fs,color:mark.color,fill:isText?(mark.background||'#fff7b7'):'transparent',flipX:x2<mark.x,flipY:y2<mark.y});}
  if(ph.caption)m.objects.push({id:id(),type:'text',x,y:y+h+8,w:370,h:34,text:ph.caption,fontSize:16,color:'#243e46',fill:'transparent'});
 });return normalize(m);
}
function fromProcesses(pages){const m={width:1000,height:650,objects:[],edges:[]},seen=new Set();pages.filter(p=>{if(seen.has(p.processId))return false;seen.add(p.processId);return true;}).forEach((p,i)=>{m.objects.push({id:id(),type:'rect',text:p.name,x:60+Math.floor(i/6)*240,y:30+(i%6)*95,w:200,h:60,fill:'#ffffff'});if(i)m.edges.push({id:id(),from:m.objects[i-1].id,to:m.objects[i].id,label:''});});if(m.objects.length>24)throw Error('从工序生成最多支持24个节点；请拆分为多个流程或在画布手动添加。');return normalize(m);}
// Occupied bounds detect elements outside the remaining page area without resizing them.
function contentHeight(model){const m=normalize(model);return m.objects.reduce((bottom,o)=>{let edge=o.y+o.h;if(!['photo','arrow','line'].includes(o.type)&&o.text){const lines=wrapText(o.text,o.w,o.fontSize);edge=Math.max(edge,o.y+o.h/2+(lines.length-1)*o.fontSize*.6+o.fontSize*.7);}return Math.max(bottom,edge+(['arrow','line'].includes(o.type)?Math.max(8,o.strokeWidth*3.5):8));},0);}
function svg(model,selection='',editing=false,{viewHeight,picked=[]}={}){const m=normalize(model),height=Number.isFinite(viewHeight)?Math.max(1,viewHeight):m.height,marker='sop-object-arrow-'+(++renderId);let out=`<svg class="object-sheet" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width} ${height}" role="img" aria-label="独立对象画布"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#243e46"/></marker></defs><rect width="${m.width}" height="${height}" fill="white"/>`;
 const edgeLabels=[],edgeHandles=[];
 for(const e of m.edges){
  const points=flowRoute(m,e);
  if(points.length<2)continue;
  const coords=points.filter((point,i)=>!i||distance(point,points[i-1])>.001).map(p=>p.x+','+p.y).join(' ');
  if(!coords.includes(' '))continue;
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
 for(const o of m.objects){const objectMarker=marker+'-'+String(o.id).replace(/[^a-z0-9]/gi,'');out+=`<defs><marker id="${objectMarker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${o.color}"/></marker></defs>`;out+=`<g data-object="${esc(o.id)}" transform="translate(${o.x} ${o.y})">`;const style=`fill="${o.fill}" stroke="${o.color}" stroke-width="${o.strokeWidth}"`;
  if(o.type==='photo')out+=`<image href="${esc(o.data)}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet"/>`;
  else if(['arrow','line'].includes(o.type))out+=`<line x1="${o.flipX?o.w:0}" y1="${o.flipY?o.h:0}" x2="${o.flipX?0:o.w}" y2="${o.flipY?0:o.h}" stroke="${o.color}" stroke-width="${o.strokeWidth}" ${o.type==='arrow'?`marker-end="url(#${objectMarker})"`:''}/>`;
  else {if(o.type==='ellipse')out+=`<ellipse cx="${o.w/2}" cy="${o.h/2}" rx="${o.w/2}" ry="${o.h/2}" ${style}/>`;else if(o.type==='triangle')out+=`<polygon points="${o.w/2},0 ${o.w},${o.h} 0,${o.h}" ${style}/>`;else if(o.type==='diamond')out+=`<polygon points="${o.w/2},0 ${o.w},${o.h/2} ${o.w/2},${o.h} 0,${o.h/2}" ${style}/>`;else out+=`<rect width="${o.w}" height="${o.h}" ${o.type==='text'?`fill="${o.fill}" stroke="none"`:style}/>`;
   const lines=wrapText(o.text,flowTextWidth(o),o.fontSize),fs=o.fontSize;out+=`<text text-anchor="${o.type==='text'?'start':'middle'}" x="${o.type==='text'?4:o.w/2}" y="${o.h*(o.type==='triangle'?.72:.5)-(lines.length-1)*fs*.6}" dominant-baseline="middle" font-size="${fs}" font-family="Microsoft YaHei, sans-serif" fill="${o.color}">${lines.map((s,i)=>`<tspan x="${o.type==='text'?4:o.w/2}" dy="${i?fs*1.2:0}">${esc(s)}</tspan>`).join('')}</text>`;}
  if(editing){if(['arrow','line'].includes(o.type))out+=`<line x1="${o.flipX?o.w:0}" y1="${o.flipY?o.h:0}" x2="${o.flipX?0:o.w}" y2="${o.flipY?0:o.h}" stroke="transparent" stroke-width="${Math.max(8,o.strokeWidth)}" pointer-events="stroke"/>`;out+=`<rect width="${o.w}" height="${o.h}" fill="transparent" stroke="${o.id===selection||picked.includes(o.id)?'#0d9692':'transparent'}" stroke-dasharray="5 3" ${['arrow','line'].includes(o.type)?'pointer-events="none"':''}/>`;}
  if(editing&&o.id===selection&&['arrow','line'].includes(o.type)){const p=lineEndpoints(o);out+=`<circle data-endpoint="start" cx="${p.x1-o.x}" cy="${p.y1-o.y}" r="4" fill="white" stroke="#0d9692" stroke-width="1.5"/><circle data-endpoint="end" cx="${p.x2-o.x}" cy="${p.y2-o.y}" r="4" fill="#0d9692" stroke="white" stroke-width="1.2"/>`;}else if(editing&&o.id===selection)for(const [corner,x,y]of [["nw",0,0],["ne",o.w,0],["sw",0,o.h],["se",o.w,o.h]])out+=`<rect data-resize="${corner}" x="${x-3.5}" y="${y-3.5}" width="7" height="7" fill="#0d9692" stroke="white" stroke-width="1.2"/>`;out+='</g>';
 }return out+edgeLabels.join('')+edgeHandles.join('')+'</svg>';
}
function open(input,{title='图文画布',flow=false,photos=[],availableHeight,preview=false,onSave}={}){
 const d=document.createElement('dialog');d.className='object-dialog';let m=normalize(input),selected='',history=[],drag=null,snap=null,linkFrom='',inlineEdit=null,lastTap=null,tool='',creating=null;
 let picked=[],marquee=null,boxMode=false,guides=null;
 const drawingHeight=Number.isFinite(availableHeight)?Math.max(1,availableHeight):null;if(drawingHeight)m.height=Math.max(m.height,drawingHeight);const bounds=()=>({width:m.width,height:drawingHeight??m.height});
 d.innerHTML=`<div class="dialog-head"><div><h2>${esc(title)}</h2><small>选择形状后在画布按下并拖动绘制，松开完成，Esc 取消。拖动对象移动，四角均可缩放；箭头端点吸附后跟随目标移动、缩放；拖离可解除连接。双击形状可直接编辑文字。${flow?' 拖空白处框选。靠近对齐位置会吸附，按 Alt 自由移动。':''}</small></div><button data-action="close">取消</button></div><div class="object-tools"><button data-add="rect">＋ 矩形</button><button data-add="ellipse">＋ 椭圆</button><button data-add="diamond">＋ 菱形</button><button data-add="arrow">＋ 箭头</button>${flow?'<button data-add="triangle">＋ 三角形</button><button data-action="box" aria-pressed="false">框选</button><button data-action="connect">连接节点 / 汇入主线</button>':'<button data-action="upload">＋ 照片</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden id="objectPhoto">'}<button data-action="editText">编辑文字</button><button data-action="copy">复制对象</button><button data-action="delete">删除对象</button><button data-action="undo">撤销</button><span class="object-message"></span></div><div class="object-layout"><div class="object-stage"></div><aside class="object-properties"></aside></div><div class="dialog-foot"><span>保存后写入项目；取消放弃本次画布修改。</span><button data-action="save" class="primary">${preview?'应用流程图':'保存画布'}</button></div>`;document.body.append(d);
 const q=s=>d.querySelector(s),push=()=>{history.push(clone(m));if(history.length>60)history.shift();},message=t=>q('.object-message').textContent=t;
 function drawStage(){syncConnections(m);q('.object-stage').style.cursor=tool||boxMode?'crosshair':'';q('[data-action=box]')?.setAttribute('aria-pressed',String(boxMode));d.querySelectorAll('[data-add]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.add===tool)));q('.object-stage').innerHTML=svg(m,selected,true,{picked});
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
  q('.object-properties').innerHTML=picked.length?`<strong>已选中 ${picked.length} 个元素</strong><p>拖动选中的节点可一起移动，也可复制、删除或撤销。</p>`:o?`<strong>对象属性</strong><label>文字<textarea data-prop="text">${esc(o.text)}</textarea></label>${o.processId?'<small>文字关联 SOP 工序。修改文字后转为自定义。</small>':''}<label>形状<select data-prop="type">${(o.type==='photo'?['photo']:(o.type==='text'?['text','rect','ellipse','diamond','triangle','arrow','line']:['rect','ellipse','diamond','triangle','arrow','line'])).map(t=>`<option value="${t}" ${t===o.type?'selected':''}>${({photo:'照片',text:'文字框',rect:'矩形',ellipse:'椭圆',diamond:'菱形',triangle:'三角形',arrow:'箭头',line:'直线'})[t]}</option>`).join('')}</select></label>${(['arrow','line','photo'].includes(o.type)?[]:['fontSize']).map(k=>`<label>字号<input data-prop="${k}" type="number" value="${o[k]}"></label>`).join('')}${['arrow','line'].includes(o.type)?`<div class="line-endpoints"><label>角度（°）<input data-line-angle type="number" step="0.1" value="${Number(lineAngle(o).toFixed(1))}"></label><label>长度<input data-line-length type="number" min="1" step="0.1" value="${Number(Math.hypot(o.w,o.h).toFixed(1))}"></label><small>拖动两端圆点调整方向；靠近角点或中点约 10px 时连接并跟随；拖离解除，按住 Alt 自由定位。</small></div>`:''}${o.type!=='photo'?`<label>线条粗细<input data-prop="strokeWidth" type="number" min="0.5" max="20" step="0.5" value="${o.strokeWidth}"></label>`:''}<div data-object-color></div><div data-object-fill></div>${['arrow','line'].includes(o.type)?'<button data-flip="flipX">左右翻转箭头</button><button data-flip="flipY">上下翻转箭头</button>':''}`:e?`<strong>连接线</strong><label>分支标签<input data-edge-label value="${esc(e.label)}"></label><label>线条粗细<input data-edge-width type="number" min="0.5" max="20" step="0.5" value="${e.strokeWidth}"></label>${e.join?'<small>拖动线末端圆点可沿主线移动汇入位置。</small>':`<label>走线<select data-edge-route><option value="" ${!e.route?'selected':''}>直线</option><option value="down" ${e.route==='down'?'selected':''}>直角折线（上下接入）</option><option value="across" ${e.route==='across'?'selected':''}>直角折线（左右接入）</option></select></label><small>拖动连线上的圆点调整走线。</small>`}<div data-edge-color></div><small>可拖动标签。移动关联节点时连线自动跟随。</small>`:'<strong>页面对象</strong><p>点击文字、照片、形状或连线进行编辑。</p>';
  if(o){SOP_COLORS.mount(q('[data-object-color]'),{label:'文字 / 线条',value:o.color,onChange:color=>{push();o.color=color;remember(o);draw();}});SOP_COLORS.mount(q('[data-object-fill]'),{label:'填充',value:o.fill,transparent:true,onChange:color=>{push();o.fill=color;remember(o);draw();}});}if(e)SOP_COLORS.mount(q('[data-edge-color]'),{label:'连线颜色',value:e.color,onChange:color=>{push();e.color=color;remember({...e,type:'edge'});draw();}});if(q('[data-line-angle]'))q('[data-line-angle]').onchange=ev=>{push();delete o.attachments;setLineAngle(o,ev.target.value,bounds());draw();};if(q('[data-line-length]'))q('[data-line-length]').onchange=ev=>{push();delete o.attachments;setLineAngle(o,lineAngle(o),bounds(),ev.target.value);draw();};
  q('.object-properties').querySelectorAll('[data-prop]').forEach(el=>el.onchange=()=>{push();if(el.dataset.prop==='text'){delete o.processId;delete o.prefix;}o[el.dataset.prop]=['fontSize','strokeWidth'].includes(el.dataset.prop)?Number(el.value):el.value;m=normalize(m);remember(m.objects.find(v=>v.id===selected));draw();});if(q('[data-edge-width]'))q('[data-edge-width]').onchange=ev=>{push();e.strokeWidth=Math.max(.5,Math.min(20,finite(ev.target.value,2)));remember({...e,type:'edge'});draw();};if(q('[data-edge-route]'))q('[data-edge-route]').onchange=ev=>{push();e.route=ev.target.value;delete e.bend;draw();};if(q('[data-edge-label]'))q('[data-edge-label]').onchange=ev=>{push();e.label=ev.target.value;draw();};q('.object-properties').querySelectorAll('[data-flip]').forEach(b=>b.onclick=()=>{push();delete o.attachments;o[b.dataset.flip]=!o[b.dataset.flip];draw();});if(q('[data-transparent]'))q('[data-transparent]').onclick=()=>{push();o.fill='transparent';remember(o);draw();};
 }
 function finishInline(commit=true){
  if(!inlineEdit)return;const edit=inlineEdit;inlineEdit=null;
  if(commit&&edit.input.value!==edit.object.text){push();delete edit.object.processId;delete edit.object.prefix;edit.object.text=edit.input.value;}
  edit.host.remove();draw();
 }
 function beginInline(key=selected){
  if(inlineEdit)return;
  const o=m.objects.find(o=>o.id===key);if(!o||!['text','rect','ellipse','diamond','triangle'].includes(o.type)){message('请先选择矩形、椭圆、菱形或文字框。');return;}
  drag=null;linkFrom='';selected=o.id;draw();
  const host=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
  for(const [k,v]of Object.entries({x:o.x,y:o.y,width:o.w,height:o.h}))host.setAttribute(k,v);
  const input=document.createElement('textarea');input.value=o.text;input.setAttribute('aria-label','画布内编辑文字');
  input.style.cssText='box-sizing:border-box;width:100%;height:100%;min-height:0;margin:0;padding:4px;resize:none;border:2px solid #0d9692;border-radius:0;background:white;line-height:1.2;font-family:Microsoft YaHei,sans-serif;font-size:'+o.fontSize+'px;color:'+o.color+';text-align:'+(o.type==='text'?'left':'center');
  host.append(input);q('svg').append(host);inlineEdit={object:o,input,host};
  input.onpointerdown=event=>event.stopPropagation();input.ondblclick=event=>event.stopPropagation();
  input.onkeydown=event=>{event.stopPropagation();if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();finishInline(false);}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finishInline();}};
  input.onblur=()=>finishInline();input.focus();input.select();message('直接输入文字；Enter 换行，Ctrl+Enter 完成，Esc 取消。');
 };
 const xy=ev=>{const sheet=q('svg');if(flow)return new DOMPoint(ev.clientX,ev.clientY).matrixTransform(sheet.getScreenCTM().inverse());const r=sheet.getBoundingClientRect();return {x:(ev.clientX-r.left)*m.width/r.width,y:(ev.clientY-r.top)*m.height/r.height};};
 q('.object-stage').tabIndex=0;
 q('.object-stage').onpointerdown=ev=>{if(inlineEdit||ev.button!==0)return;ev.preventDefault();q('.object-stage').focus({preventScroll:true});snap=null;if(tool){if(!ev.target.closest('svg')||ev.button!==0)return;const p=xy(ev);p.x=Math.max(0,Math.min(m.width,p.x));p.y=Math.max(0,Math.min(bounds().height,p.y));push();const o={id:id(),type:tool,x:p.x,y:p.y,w:0,h:0,text:'',fill:'#ffffff',...remembered[tool]};if(['arrow','line'].includes(o.type)&&!ev.altKey){const r=q('svg').getBoundingClientRect(),a=nearestAnchor(m,p,o.id,{x:r.width/m.width,y:r.height/m.height});if(a){p.x=a.x;p.y=a.y;o.x=p.x;o.y=p.y;attachEndpoint(m,o,'start',a);}}m.objects.push(o);selected=o.id;creating={id:o.id,p,clientX:ev.clientX,clientY:ev.clientY,moved:false};q('.object-stage').setPointerCapture(ev.pointerId);draw();return;}const g=ev.target.closest('[data-object]'),key=g?.dataset.object||'';
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
   picked=nodesInBox(m,marquee.box);drawStage();return;
  }
  if(creating){const o=m.objects.find(o=>o.id===creating.id),p=xy(ev);p.x=Math.max(0,Math.min(m.width,p.x));p.y=Math.max(0,Math.min(bounds().height,p.y));creating.moved=Math.hypot(ev.clientX-creating.clientX,ev.clientY-creating.clientY)>=4;if(['arrow','line'].includes(o.type)){const r=q('svg').getBoundingClientRect();snap=ev.altKey?null:nearestAnchor(m,p,o.id,{x:r.width/m.width,y:r.height/m.height});attachEndpoint(m,o,'end',snap);setLineEndpoints(o,{x1:creating.p.x,y1:creating.p.y,x2:(snap||p).x,y2:(snap||p).y});}else Object.assign(o,{x:Math.min(p.x,creating.p.x),y:Math.min(p.y,creating.p.y),w:Math.abs(p.x-creating.p.x),h:Math.abs(p.y-creating.p.y)});drawStage();return;}if(!drag)return;const distance=Math.hypot(ev.clientX-drag.clientX,ev.clientY-drag.clientY);if(!drag.moved&&distance<4)return;drag.moved=true;lastTap=null;const p=xy(ev),o=m.objects.find(o=>o.id===drag.id),dx=p.x-drag.p.x,dy=p.y-drag.p.y;if(drag.flowHandle){
  const edge=m.edges.find(e=>e.id===drag.id);
  if(drag.flowHandle==='label'){edge.labelX=drag.labelX+dx;edge.labelY=drag.labelY+dy;}
  const tolerance=ev.altKey?0:7/Math.abs(q('svg').getScreenCTM().a);
  if(drag.flowHandle==='bend'){
   edge.bend=drag.bend+(edge.route==='across'?dx:dy);
   guides=tolerance?snapBend(m,edge,tolerance):null;
  }
  if(drag.flowHandle==='join')guides=snapJoin(m,edge,p,tolerance);
  drawStage();return;
 }if(drag.endpoint){const ends={...drag.points},key=drag.endpoint==='start'?'1':'2';const free={x:Math.max(0,Math.min(m.width,p.x)),y:Math.max(0,Math.min(bounds().height,p.y))},rect=q('svg').getBoundingClientRect();snap=ev.altKey?null:nearestAnchor(m,free,o.id,{x:rect.width/m.width,y:rect.height/m.height});ends['x'+key]=(snap||free).x;ends['y'+key]=(snap||free).y;attachEndpoint(m,o,drag.endpoint,snap);setLineEndpoints(o,ends);}else if(drag.resize){resizeCorner(o,drag,drag.resize,dx,dy,bounds());}else if(flow&&(drag.group||!['arrow','line'].includes(o.type))){
  const origins=drag.origins||[{id:o.id,x:drag.x,y:drag.y,w:drag.w,h:drag.h}];
  const scale=Math.abs(q('svg').getScreenCTM().a);
  guides=alignDrag(m,origins,dx,dy,ev.altKey?0:7/scale);
  for(const origin of origins){
   const node=m.objects.find(item=>item.id===origin.id);
   for(const [end,anchor] of Object.entries(node.attachments||{}))if(!picked.includes(anchor.targetId))delete node.attachments[end];
   node.x=origin.x+guides.dx;node.y=origin.y+guides.dy;
  }
 }else{if(['arrow','line'].includes(o.type))delete o.attachments;o.x=Math.max(0,Math.min(m.width-o.w,drag.x+dx));o.y=Math.max(0,Math.min(bounds().height-o.h,drag.y+dy));}drawStage();};q('.object-stage').onpointerup=ev=>{
  if(marquee){
   marquee=null;if(picked.length===1){selected=picked[0];picked=[];}
   draw();return;
  }
  guides=null;
  if(creating){if(!creating.moved){m=history.pop();selected='';}else {m=normalize(m);remember(m.objects.find(o=>o.id===selected));tool='';}creating=null;snap=null;draw();message(tool?'请按下并拖动绘制；Esc 取消。':'已添加，可调整文字、颜色和粗细。');return;}const ended=drag;drag=null;snap=null;if(inlineEdit)return;
  if(ended&&!ended.group&&!ended.flowHandle&&!ended.moved&&!ended.resize&&!ended.endpoint){
   const now=performance.now(),double=lastTap&&lastTap.id===ended.id&&now-lastTap.time<500&&Math.hypot(ev.clientX-lastTap.x,ev.clientY-lastTap.y)<6;
   lastTap={id:ended.id,time:now,x:ev.clientX,y:ev.clientY};
   if(double){lastTap=null;beginInline(ended.id);return;}
  }else lastTap=null;
  draw();
 };q('.object-stage').onpointercancel=()=>{guides=null;if(marquee){marquee=null;picked=[];}if(creating){m=history.pop();creating=null;selected='';}else if(drag)m=history.pop()||m;drag=null;snap=null;if(!inlineEdit)draw();};
 d.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{if(inlineEdit)finishInline();tool=b.dataset.add;linkFrom='';selected='';picked=[];boxMode=false;draw();message('请在画布按下并拖动绘制；Esc 取消。');});
 function action(name){
  tool='';
  if(creating){m=history.pop();creating=null;selected='';}
  if(name==='editText'){beginInline();return;}
  if(inlineEdit)finishInline(name!=='close');
  if(name==='box'){
   boxMode=!boxMode;linkFrom='';picked=[];selected='';draw();
   message(boxMode?'按住并拖出选择框。':'已退出框选。');return;
  }
  boxMode=false;
  if(name==='close'){d.close();d.remove();}
  else if(name==='save'){onSave?.(normalize(m));d.close();d.remove();}
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
 d.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));if(q('#objectPhoto'))q('#objectPhoto').onchange=async ev=>{const f=ev.target.files[0];if(!f)return;if(f.size>15*1024*1024){message('照片请小于 15MB');return;}const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});const im=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=data;});const ratio=im.naturalWidth/im.naturalHeight;push();const o={id:id(),type:'photo',data,x:80,y:80,w:Math.min(360,240*ratio),h:Math.min(240,360/ratio)};m.objects.push(o);m=normalize(m);selected=o.id;draw();};
 d.onkeydown=ev=>{
 if(ev.key==='Escape'&&(marquee||boxMode||picked.length)){
  ev.preventDefault();if(drag?.group){m=history.pop()||m;drag=null;guides=null;}marquee=null;boxMode=false;picked=[];draw();return;
 }
 if(ev.key==='Escape'&&(tool||creating)){ev.preventDefault();if(creating){m=history.pop();creating=null;selected='';}tool='';snap=null;draw();message('已取消绘制');return;}if(/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName))return;if(ev.key==='F2'){ev.preventDefault();beginInline();return;}if(ev.key==='Delete'){ev.preventDefault();action('delete');}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();action('undo');}if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='d'){ev.preventDefault();action('copy');}};d.oncancel=()=>d.remove();draw();if(drawingHeight)message(contentHeight(m)>drawingHeight?'白色区域为文字之外的可用画布；灰色区域有超出元素，请手动移回或缩小。':'白色区域为文字之外的可用画布；文字和图片不自动缩放。');d.showModal();
}
const api={contentHeight,attachEndpoint,syncConnections,anchorPoints,nearestAnchor,resizeCorner,lineEndpoints,setLineEndpoints,lineAngle,setLineAngle,wrapText,flowTextWidth,normalize,edgePoints,flowRoute,flowLabel,flowShapes,generateFlow,resolvedFlow,remove,duplicate,fromPhotos,fromProcesses,svg,open};if(typeof module!=='undefined')module.exports=api;root.SOP_OBJECTS=api;
})(typeof window==='undefined'?globalThis:window);
