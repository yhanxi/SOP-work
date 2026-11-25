/* Preserve imported Word content as editable XML; browser HTML is built from an allowlist. */
(() => {
'use strict';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const parse=s=>new DOMParser().parseFromString(s,'application/xml'),serialize=n=>new XMLSerializer().serializeToString(n),kids=(n,name)=>[...(n?.children||[])].filter(c=>c.localName===name),one=(n,name)=>kids(n,name)[0],val=(n,name)=>n?.getAttributeNS(W,name)||'',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signature=p=>JSON.stringify([p.steps,p.requirements,p.photos.map(ph=>[ph.data,ph.caption,ph.marks]),...(p.textStyles?[p.textStyles]:[]),...(p.contentStyle?[p.contentStyle]:[])]);
// Reuse the original Word paragraph/run structure for mapped text-only edits.
const importedBodies=new WeakMap(), importedResources=new WeakMap();
const richBodySupported=page=>page.importedContent&&!page.canvas&&!['steps','requirements'].some(field=>page[field+'Highlights']?.length||page[field+'TextColors']?.length);
function bodyBlocks(page){
 if(!richBodySupported(page))return null;
 const key=signature(page),source=page.importedContent,projection=importedBodies.get(source);
 if(projection?.key===key&&projection.blocks)return projection.blocks;
 return source.signature===key?source.blocks:null;
}
const active=page=>!!bodyBlocks(page);
function operationLine(line,current){
 const heading=line.match(/^\s*(?:[一二三四五六七八九十\d]+[、.．）)]\s*)?(操作步骤|工艺技术要求|验收要点|注意事项)\s*[：:]?\s*(.*)$/);
 const field=heading?(heading[1]==='操作步骤'?'steps':'requirements'):current;
 const text=heading?heading[2]:line;
 return {field,heading:!!heading,text:text.trim()&&!/^[←→\s]+$/.test(text)?text:'',prefix:line.length-text.length};
}
function mapBodyLines(roots){
 const fields={steps:[],requirements:[]},headings={steps:[],requirements:[]};
 let field='steps',text='',parts=[];
 const next=(paragraph,lineBreak)=>{
  const mapped=operationLine(text,field),line={...mapped,parts,paragraph,lineBreak};
  field=mapped.field;
  if(mapped.heading)headings[field].push(line);
  if(mapped.text)fields[field].push(line);
  text='';parts=[];
 };
 const walk=(node,paragraph)=>{
  const chosen=branch(node);
  if(chosen){walk(chosen,paragraph);return;}
  if(node.namespaceURI===W){
   if(['drawing','pict','object','del'].includes(node.localName))return;
   if(node.localName==='p')paragraph=node;
   if(node.localName==='t'||node.localName==='tab'){
    const value=node.localName==='tab'?'\t':node.textContent;
    parts.push({start:text.length,end:text.length+value.length,node:node.localName==='t'?node:null,element:node});
    text+=value;
    return;
   }
   if(['br','cr'].includes(node.localName)){next(paragraph,node);return;}
  }
  for(const child of node.children)walk(child,paragraph);
  if(node.namespaceURI===W&&node.localName==='p'&&text)next(node);
 };
 roots.forEach(root=>walk(root,null));
 if(text)next(null);
 return {...fields,headings};
}
function replaceBodyLine(line,replacement){
 let start=0, common=0;
 while(start<line.text.length&&start<replacement.length&&line.text[start]===replacement[start])start++;
 while(common<line.text.length-start&&common<replacement.length-start&&line.text.at(-1-common)===replacement.at(-1-common))common++;
 const end=line.prefix+line.text.length-common, value=replacement.slice(start,replacement.length-common);
 start+=line.prefix;
 const missing=start===end;
 const touched=line.parts.filter(part=>missing?part.start<=start&&part.end>=start:part.start<end&&part.end>start);
 if(!touched.length||touched.some(part=>!part.node)||value.includes('\t'))return false;
 for(const [index,part]of (missing?[touched[0]]:touched).entries()){
  const node=part.node,original=node.textContent;
  node.textContent=original.slice(0,Math.max(0,start-part.start))+(index===0?value:'')+original.slice(Math.min(original.length,end-part.start));
  node.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
 }
 return true;
}
const nonTextParagraphContent=new Set(['drawing','pict','object','oMath','oMathPara','fldChar','fldSimple','sym','footnoteReference','endnoteReference','commentReference','bookmarkStart','bookmarkEnd','sdt','ins','del']);
const emptyNativeParagraph=root=>root.namespaceURI===W&&root.localName==='p'&&
 ![...root.getElementsByTagName('*')].some(node=>nonTextParagraphContent.has(node.localName)||node.namespaceURI===W&&node.localName==='t'&&node.textContent.trim());
function clearNativeRequirements(roots,mapped){
 const paragraphs=new Set(),section=[...new Set([...mapped.headings.requirements,...mapped.requirements])];
 for(const line of section){
  paragraphs.add(line.paragraph);
  for(const {element}of line.parts)element.remove();
  line.lineBreak?.remove();
 }
 const kept=[];
 let insertion=-1,afterRequirement=false;
 for(const root of roots){
  if(paragraphs.has(root)){
   if(insertion<0)insertion=kept.length;
   afterRequirement=true;
  }else if(!emptyNativeParagraph(root))afterRequirement=false;
  if(!afterRequirement||!emptyNativeParagraph(root))kept.push(root);
 }
 for(const {paragraph,text}of mapped.headings.steps){
  const spacing=one(one(paragraph,'pPr'),'spacing');
  // The previous workbench reserved 6066 twips after the steps heading on fully blank pages.
  if(!text&&paragraphs.size&&val(spacing,'after')==='6066')spacing.setAttributeNS(W,'w:after',window.SOP_TEMPLATE.operationText.headingAfter);
 }
 return {roots:kept,insertion:insertion<0?kept.length:insertion};
}
function updatedBodyRoots(source,key,page){
 let roots=source.blocks.map(b=>parse(b.xml).documentElement);
 const unchanged=source.signature===key;
 if(unchanged&&page.requirements.trim())return roots;
 let original,current;
 try{original=JSON.parse(source.signature);current=JSON.parse(key);}catch{return null;}
 if(JSON.stringify(original.slice(2))!==JSON.stringify(current.slice(2)))return null;
 const mapped=mapBodyLines(roots);
 if(unchanged&&!mapped.headings.requirements.length&&!mapped.requirements.length){
  return source.blocks.every(b=>b.typography===1)?null:roots;
 }
 if(original[0]!==current[0]){
  const lines=current[0]?current[0].split('\n'):[],matches=mapped.steps;
  if(matches.length!==lines.length||matches.map(item=>item.text).join('\n')!==original[0])return null;
  for(const [i,line]of matches.entries())if(line.text!==lines[i]&&!replaceBodyLine(line,lines[i]))return null;
 }
 const requirements=current[1].split('\n').filter(line=>line.trim()),matches=mapped.requirements;
 if(requirements.length&&original[1]===current[1])return roots;
 if(requirements.length===matches.length&&requirements.length&&matches.map(line=>line.text).join('\n')===original[1]){
  for(const [i,line]of matches.entries())if(line.text!==requirements[i]&&!replaceBodyLine(line,requirements[i]))return null;
  return roots;
 }
 const mappedText=matches.map(line=>line.text).join('\n');
 const section=mappedText===original[1]?mapped:{requirements:[],headings:{steps:mapped.headings.steps,requirements:mapped.headings.requirements.filter(heading=>!heading.text)}};
 const {roots:kept,insertion}=clearNativeRequirements(roots,section);
 if(requirements.length){
  const doc=document.implementation.createDocument(W,'w:body');
  const sourceIds=roots.flatMap(root=>[...root.getElementsByTagNameNS(W,'fitText')].map(node=>Number(val(node,'id'))||0));
  let fitId=Math.max(0,...sourceIds);
  kept.splice(insertion,0,...window.SOP_WORD.operationRequirementBlocks(doc,page,()=>++fitId));
 }
 return kept;
}
async function importResourceBundle(source){
 const zip=new JSZip();
 for(const [file,data]of Object.entries(source.files))zip.file(file,data,{base64:true});
 const documentRels=parse(await zip.file('word/_rels/document.xml.rels').async('string'));
 const rels=new Map([...documentRels.documentElement.children].map(e=>[e.getAttribute('Id'),e.getAttribute('Target')]));
 return {zip,rels,...await typographyParts(zip)};
}
async function refreshBody(project){
 const source=project.nativeWord;
 if(!source?.files)return false;
 const results=await Promise.all(project.pages.filter(richBodySupported).map(async page=>{
  const reference=page.importedContent,key=signature(page),recent=importedBodies.get(reference);
  if(recent?.key===key){await recent.pending;return false;}
  if(reference.signature===key&&page.requirements.trim()&&reference.blocks.every(b=>b.typography===1))return false;
  const projection={key};
  importedBodies.set(reference,projection);
  const roots=updatedBodyRoots(reference,key,page);
  if(!roots)return false;
  if(!importedResources.has(source))importedResources.set(source,importResourceBundle(source));
  projection.pending=(async()=>{
   const {zip,rels,styles,theme}=await importedResources.get(source);
   const wrapper=document.implementation.createDocument(null,'sop-body').documentElement;
   wrapper.append(...roots.map(root=>wrapper.ownerDocument.importNode(root,true)));
   projection.blocks=await capture(wrapper,zip,rels,styles,theme);
  })().catch(()=>{});
  await projection.pending;
  return importedBodies.get(reference)===projection&&!!projection.blocks;
 }));
 return results.some(Boolean);
}

function resolve(target,owner='word/document.xml'){const parts=target.startsWith('/')?[]:owner.split('/').slice(0,-1);for(const s of target.split('/')){if(s==='..')parts.pop();else if(s!=='.'&&s)parts.push(s);}return parts.join('/');}
function branch(n){if(n.namespaceURI==='http://schemas.openxmlformats.org/markup-compatibility/2006'&&n.localName==='AlternateContent')return one(n,'Choice')||one(n,'Fallback');return null;}
const wNodes=(node,name)=>[...(node?.getElementsByTagNameNS(W,name)||[])];
const aNode=(node,name)=>node?.getElementsByTagNameNS(A,name)[0];
const isSet=node=>node&&!['0','false','off'].includes(val(node,'val'));
const defaultParagraph=styles=>wNodes(styles,'style').find(s=>val(s,'type')==='paragraph'&&['1','true','on'].includes(val(s,'default')));
const sourceDefaults=styles=>{
 const defaults=one(styles?.documentElement,'docDefaults');
 return {pPr:one(one(defaults,'pPrDefault'),'pPr'),rPr:one(one(defaults,'rPrDefault'),'rPr')};
};
function themeValues(theme){
 const fonts=aNode(theme,'fontScheme'),colors=aNode(theme,'clrScheme');
 const font=(key,language)=>{
  if(!key)return '';
  const group=one(fonts,key.startsWith('major')?'majorFont':'minorFont');
  const east=/eastAsia$/i.test(key),complex=/bidi$/i.test(key);
  let value=one(group,east?'ea':complex?'cs':'latin')?.getAttribute('typeface');
  if(!value&&east){
   const script=/^ja/i.test(language)?'Jpan':/^ko/i.test(language)?'Hang':/(TW|HK|MO|Hant)$/i.test(language)?'Hant':'Hans';
   value=kids(group,'font').find(item=>item.getAttribute('script')===script)?.getAttribute('typeface');
  }
  return value||'';
 };
 const color=(value,shade,tint)=>{
  const aliases={dark1:'dk1',dark2:'dk2',light1:'lt1',light2:'lt2',text1:'dk1',text2:'dk2',background1:'lt1',background2:'lt2',hyperlink:'hlink',followedHyperlink:'folHlink'};
  const node=one(colors,aliases[value]||value)?.firstElementChild;
  const rgb=node?.getAttribute(node.localName==='sysClr'?'lastClr':'val');
  if(!/^[a-f\d]{6}$/i.test(rgb||''))return '';
  if(!/^[a-f\d]{2}$/i.test(shade)&&!/^[a-f\d]{2}$/i.test(tint))return rgb;
  const base=rgb.match(/../g).map(channel=>parseInt(channel,16)/255), [r,g,b]=base, min=Math.min(...base),max=Math.max(...base),span=max-min;
  let light=(max+min)/2;
  const saturation=span?span/(1-Math.abs(2*light-1)):0;
  const hue=span?(max===r?(g-b)/span+6:max===g?(b-r)/span+2:(r-g)/span+4)%6:0;
  if(/^[a-f\d]{2}$/i.test(shade))light*=parseInt(shade,16)/255;
  if(/^[a-f\d]{2}$/i.test(tint))light=1-(1-light)*parseInt(tint,16)/255;
  const a=saturation*Math.min(light,1-light);
  return [0,8,4].map(offset=>{
   const k=(offset+hue*2)%12, channel=light-a*Math.max(-1,Math.min(k-3,9-k,1));
   return Math.round(channel*255).toString(16).padStart(2,'0');
  }).join('');
 };
 return {font,color};
}
const fontsByScript=[['ascii','asciiTheme','asciiFont'],['hAnsi','hAnsiTheme','westernFont'],['eastAsia','eastAsiaTheme','eastFont'],['cs','cstheme','complexFont']];
const colorFrom=(node,theme,kind='color')=>{
 const [literal,themeName,shade,tint]=kind==='fill'?['fill','themeFill','themeFillShade','themeFillTint']:['val','themeColor','themeShade','themeTint'];
 const value=val(node,literal),resolved=theme.color(val(node,themeName),val(node,shade),val(node,tint));
 return resolved||(/^[a-f\d]{6}$/i.test(value)?value:'');
};
const safeFont=font=>String(font||'').replace(/[^\p{L}\p{N} ._-]/gu,'').trim();
const fontLanguage=pr=>val(one(pr,'lang'),'eastAsia')||val(one(pr,'lang'),'val');
const highlights={black:'#000000',blue:'#0000ff',cyan:'#00ffff',green:'#00ff00',magenta:'#ff00ff',red:'#ff0000',yellow:'#ffff00',white:'#ffffff',darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',darkYellow:'#808000',darkGray:'#808080',lightGray:'#c0c0c0',none:'transparent'};
const points=value=>value!==''&&Number.isFinite(Number(value))?Number(value)/20:null;
function textProperties(pr,theme,language){
 const s={};
 for(const c of pr?.children||[]){
  const v=val(c,'val'), pt=points(v);
  if(c.localName==='b')s['font-weight']=isSet(c)?'bold':'normal';
  if(c.localName==='i')s['font-style']=isSet(c)?'italic':'normal';
  if(c.localName==='u')s['text-decoration']=v==='none'?'none':'underline';
  if(c.localName==='sz'&&Number(v)>0&&Number(v)<400)s['font-size']=Number(v)/2+'pt';
  if(c.localName==='color'){
   const color=colorFrom(c,theme);
   if(color)s.color='#'+color;
   else if(v==='auto')s.color='#000000';
  }
  if(c.localName==='shd'){
   const fill=colorFrom(c,theme,'fill');
   if(fill)s['background-color']='#'+fill;
  }
  if(c.localName==='spacing'&&pt!==null)s['letter-spacing']=pt+'pt';
  if(c.localName==='rFonts')for(const [literal,reference,key]of fontsByScript){
   const font=safeFont(theme.font(val(c,reference),language)||val(c,literal));
   if(font)s[key]=font;
  }
 }
 const highlight=highlights[val(one(pr,'highlight'),'val')];
 if(highlight)s['background-color']=highlight;
 return s;
}
function paragraphProperties(pr){
 const s={},spacing=one(pr,'spacing'),line=points(val(spacing,'line')),rule=val(spacing,'lineRule')||'auto',jc=val(one(pr,'jc'),'val');
 if(['left','right','center','justify','both'].includes(jc))s['text-align']=jc==='both'?'justify':jc;
 if(line>0)s['line-height']=rule==='auto'?String(line/12):rule==='atLeast'?'max(1.15em,'+line+'pt)':line+'pt';
 for(const [property,css]of [['before','margin-top'],['after','margin-bottom']]){
  const pt=points(val(spacing,property));
  if(pt!==null&&pt>=0)s[css]=pt+'pt';
 }
 return s;
}
const workbenchTrackingStyles=new WeakMap();
function workbenchTracking(id,styles){
 if(!id)return false;
 const {fullWidthStyleId,fullWidthStyleName}=window.SOP_TEMPLATE.operationText;
 if(id===fullWidthStyleId)return true;
 if(!styles)return false;
 if(!workbenchTrackingStyles.has(styles)){
  const ids=wNodes(styles,'style').filter(style=>val(one(style,'name'),'val')===fullWidthStyleName).map(style=>val(style,'styleId'));
  workbenchTrackingStyles.set(styles,new Set(ids));
 }
 return workbenchTrackingStyles.get(styles).has(id);
}
function formatting(styles,theme){
 const values=themeValues(theme),defaults=sourceDefaults(styles),lookup=new Map(wNodes(styles,'style').map(style=>[val(style,'styleId'),style]));
 const normal=val(defaultParagraph(styles),'styleId'),language=fontLanguage(defaults.rPr)||'zh-CN';
 const chain=id=>{
  const styles=[],seen=new Set();
  while(lookup.has(id)&&!seen.has(id)){
   seen.add(id);
   const style=lookup.get(id);
   styles.unshift(style);
   id=val(one(style,'basedOn'),'val');
  }
  return styles;
 };
 const runs=pr=>textProperties(pr,values,fontLanguage(pr)||language);
 return {
  paragraph(node){
   const direct=one(node,'pPr'),ref=val(one(direct,'pStyle'),'val');
   const inherited=chain(lookup.has(ref)?ref:normal);
   return {
    paragraph:Object.assign({},paragraphProperties(defaults.pPr),...inherited.map(s=>paragraphProperties(one(s,'pPr'))),paragraphProperties(direct)),
    run:Object.assign({},runs(defaults.rPr),...inherited.map(s=>runs(one(s,'rPr')))),
    mark:runs(one(direct,'rPr')),
   };
  },
  run(node,paragraph){
   const direct=one(node,'rPr'),id=val(one(direct,'rStyle'),'val'),inherited=chain(id);
   const formatting=Object.assign({},paragraph,...inherited.map(s=>runs(one(s,'rPr'))),runs(direct));
   if(formatting['letter-spacing']&&workbenchTracking(id,styles))formatting['letter-spacing']=parseFloat(formatting['letter-spacing'])*2+'pt';
   return formatting;
  },
 };
}
const eastAsian=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u30ff\uff01-\uff60\uffe0-\uffe6]/u;
const cssAttributes=style=>' style="'+esc(Object.entries(style).filter(([key])=>!key.endsWith('Font')).map(([key,value])=>key+':'+value).join(';'))+'"';
function runText(value,format){
 const fragments=[];
 let text='',last;
 const emit=()=>{if(text)fragments.push(last?'<span style="font-family:&quot;'+esc(last)+'&quot;">'+esc(text)+'</span>':esc(text));};
 for(const char of value){
  const font=eastAsian.test(char)?format.eastFont||format.westernFont||format.asciiFont:char.codePointAt(0)<=127?format.asciiFont||format.westernFont:format.westernFont||format.asciiFont;
  if(font!==last){emit();text='';last=font;}
  text+=char;
 }
 emit();
 return fragments.join('');
}

async function typographyParts(z){
 const relationships=z.file('word/_rels/document.xml.rels');
 const rels=relationships&&parse(await relationships.async('string'));
 const part=type=>{
  const target=[...(rels?.documentElement.children||[])].find(rel=>rel.getAttribute('Type')?.endsWith('/'+type))?.getAttribute('Target');
  return z.file(target?resolve(target):type==='styles'?'word/styles.xml':'word/theme/theme1.xml');
 };
 const [styles,theme]=await Promise.all(['styles','theme'].map(async type=>{
  const file=part(type);
  return file?parse(await file.async('string')):null;
 }));
 return {styles,theme};
}

async function capture(op,z,rels,styles,theme){
 capture.arrowId=capture.arrowId||0;
 const formats=formatting(styles,theme);
 const V='urn:schemas-microsoft-com:vml';
 const number=(v,fallback=0)=>Number.isFinite(parseFloat(v))?parseFloat(v):fallback;
 const vstyle=n=>Object.fromEntries((n.getAttribute('style')||'').split(';').map(s=>s.split(':').map(t=>t.trim())).filter(x=>x.length===2));
 const vcolor=(c,fallback)=>/^(#[a-f\d]{3,8}|[a-z]+)$/i.test(c||'')?c:fallback;
 async function vml(n,inGroup=false){const st=vstyle(n),x=number(st.left),y=number(st.top),w=number(st.width,100),h=number(st.height,60),origin=(n.getAttribute('coordorigin')||'0,0').split(/[ ,]+/).map(Number),size=(n.getAttribute('coordsize')||`${w},${h}`).split(/[ ,]+/).map(Number);let out='';
  if(n.localName==='group'){for(const child of n.children)if(child.namespaceURI===V)out+=await vml(child,true);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${origin[0]||0} ${origin[1]||0} ${size[0]||w} ${size[1]||h}" width="${w}pt" height="${h}pt" style="max-width:100%;height:auto;overflow:visible"${inGroup?` x="${x}" y="${y}"`:''}>${out}</svg>`;}
  const image=[...n.getElementsByTagNameNS(V,'imagedata')][0];if(image){const target=rels.get(image.getAttributeNS(R,'id')),path=target&&resolve(target),file=path&&z.file(path);if(file&&/\.(png|jpe?g|webp)$/i.test(path)){const ext=path.split('.').pop().toLowerCase(),data='data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+await file.async('base64');out+=`<image x="${x}" y="${y}" width="${w}" height="${h}" href="${data}" preserveAspectRatio="none"/>`;}}
  else{const stroke=vcolor(n.getAttribute('strokecolor'),'#111111'),fill=n.getAttribute('filled')==='f'?'none':vcolor(n.getAttribute('fillcolor'),'none'),sw=number(n.getAttribute('strokeweight'),1),from=(n.getAttribute('from')||`${x},${y}`).split(',').map(number),to=(n.getAttribute('to')||`${x+w},${y+h}`).split(',').map(number),line=n.localName==='line'||n.getAttribute('filled')==='f'&&n.getAttribute('path');
   if(line){const id='importArrow'+(++capture.arrowId),arrow=[...n.children].some(c=>c.localName==='stroke'&&c.getAttribute('endarrow')&&c.getAttribute('endarrow')!=='none');out+=`<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${stroke}"/></marker></defs><line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="${stroke}" stroke-width="${sw}"${arrow?` marker-end="url(#${id})"`:''}/>`;}
   else if(n.localName==='oval')out+=`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${stroke}"/>`;
   else out+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
   const box=n.getElementsByTagNameNS(W,'txbxContent')[0];if(box)out+=`<foreignObject x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:10pt;text-align:center">${await inner(box)}</div></foreignObject>`;
  }
  return inGroup?out:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}pt" height="${h}pt" style="max-width:100%;height:auto;overflow:visible">${out}</svg>`;
 }
 async function drawing(n){
  const WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',box=n.getElementsByTagNameNS(WP,'anchor')[0]||n.getElementsByTagNameNS(WP,'inline')[0];
  if(!box)return '';const extent=one(box,'extent'),w=number(extent?.getAttribute('cx'))/12700,h=number(extent?.getAttribute('cy'))/12700;
  // Word uses zero-sized drawings for hidden objects. They must not become full-size photos.
  if(w<=0&&h<=0)return '';
  const anchored=box.localName==='anchor',ph=one(box,'positionH'),pv=one(box,'positionV'),x=number(ph&&one(ph,'posOffset')?.textContent)/12700,y=number(pv&&one(pv,'posOffset')?.textContent)/12700;
  const sp=n.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordprocessingShape','spPr')[0],shapeColor=(element,fallback)=>{const fill=element&&one(element,'solidFill');if(!fill)return fallback;const c=[...fill.children][0],v=c?.getAttribute('val');if(c?.localName==='srgbClr'&&/^[a-f\d]{6}$/i.test(v))return '#'+v;return ({black:'#000000',white:'#ffffff',red:'#ff0000',yellow:'#ffff00',blue:'#0000ff',green:'#008000'})[v]||fallback;};
  let content='';for(const b of n.getElementsByTagNameNS(A,'blip')){const target=rels.get(b.getAttributeNS(R,'embed')),file=target&&z.file(resolve(target));if(!file||! /\.(png|jpe?g|webp)$/i.test(target))continue;const ext=target.split('.').pop().toLowerCase(),data='data:image/'+(ext==='jpg'?'jpeg':ext)+';base64,'+await file.async('base64');content+=`<image width="${w}" height="${h}" href="${data}" preserveAspectRatio="none"/>`;}
  if(sp){const geometry=one(sp,'prstGeom')?.getAttribute('prst')||'rect',line=one(sp,'ln'),stroke=shapeColor(line,'#111111'),fill=one(sp,'noFill')?'none':shapeColor(sp,'none'),sw=number(line?.getAttribute('w'),9525)/12700,xfrm=one(sp,'xfrm'),fh=['1','true'].includes(xfrm?.getAttribute('flipH')),fv=['1','true'].includes(xfrm?.getAttribute('flipV'));
   if(/line|Connector/i.test(geometry)){const id='importArrow'+(++capture.arrowId),head=one(line||sp,'headEnd')?.getAttribute('type'),tail=one(line||sp,'tailEnd')?.getAttribute('type');content+=`<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${stroke}"/></marker></defs><line x1="${fh?w:0}" y1="${fv?h:0}" x2="${fh?0:w}" y2="${fv?0:h}" stroke="${stroke}" stroke-width="${sw}"${head&&head!=='none'?` marker-start="url(#${id})"`:''}${tail&&tail!=='none'?` marker-end="url(#${id})"`:''}/>`;}
   else if(geometry==='ellipse')content+=`<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"/>`;
   else content+=`<rect width="${w}" height="${h}" stroke="${one(sp,'noFill')&&!line?'none':stroke}" stroke-width="${sw}" fill="${fill}"/>`;
  }
  for(const text of n.getElementsByTagNameNS(W,'txbxContent')){let body=await inner(text);body=body.replace(/(font-size|margin-top|margin-bottom):([\d.]+)pt/g,'$1:$2px');content+=`<foreignObject width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="imported-shape-text">${body}</div></foreignObject>`;}
  const style=anchored?`position:absolute;left:${x}pt;top:${y}pt;z-index:${Math.max(0,Math.min(2000000000,number(box.getAttribute('relativeHeight'))))};overflow:visible;max-width:none`:'overflow:visible;max-width:100%;vertical-align:middle';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="imported-drawing" viewBox="0 0 ${w} ${h}" width="${w}pt" height="${h}pt" style="${style}"${anchored&&pv?.getAttribute('relativeFrom')==='page'?' data-sop-cell-anchor="1"':''}>${content}</svg>`;
 }

 async function html(n,paragraph={},run={}){const alt=branch(n);if(alt)return html(alt,paragraph,run);const name=n.localName;if(n.namespaceURI===W&&['pPr','rPr','tcPr','tblPr','trPr','instrText','del'].includes(name))return '';if(n.namespaceURI===W&&name==='t')return runText(n.textContent,run);if(n.namespaceURI===W&&['br','cr'].includes(name))return '<br>';if(n.namespaceURI===W&&name==='tab')return '&#9;';
  if(n.namespaceURI===W&&name==='drawing')return drawing(n);
  if(n.namespaceURI===W&&name==='pict'){const nodes=[...n.children].filter(c=>c.namespaceURI===V&&['group','shape','rect','roundrect','line','oval'].includes(c.localName));return (await Promise.all(nodes.map(c=>vml(c)))).join('');}
  if(n.namespaceURI===W&&name==='p'){
   const resolved=formats.paragraph(n),style={...resolved.paragraph};
   const plain=kids(n,'r').some(r=>kids(r,'t').some(t=>t.textContent.trim()));
   const size=plain?resolved.run['font-size']:resolved.mark['font-size']||resolved.run['font-size'];
   if(size)style['font-size']=size;
   if(style['line-height']?.endsWith('pt'))style['min-height']=style['line-height'];
   return '<p class="imported-paragraph"'+cssAttributes(style)+'>'+await inner(n,resolved.run)+(plain?'':'&#160;')+'</p>';
  }
  if(n.namespaceURI===W&&name==='r'){
   const style=formats.run(n,paragraph);
   return '<span'+cssAttributes(style)+'>'+await inner(n,paragraph,style)+'</span>';
  }
  if(n.namespaceURI===W&&name==='tbl'){const widths=one(n,'tblGrid')?[...one(n,'tblGrid').children].map(c=>Number(val(c,'w'))):[],total=widths.reduce((a,b)=>a+b,0);return '<table class="imported-table">'+(total?'<colgroup>'+widths.map(w=>'<col style="width:'+(w/total*100)+'%">').join('')+'</colgroup>':'')+await inner(n)+'</table>';}
  if(n.namespaceURI===W&&name==='tr'){const pr=one(n,'trPr'),height=Number(val(pr&&one(pr,'trHeight'),'val'));return '<tr'+(height?' style="height:'+(height/20)+'pt"':'')+'>'+await inner(n)+'</tr>';}
  if(n.namespaceURI===W&&name==='tc'){const pr=one(n,'tcPr'),span=Number(val(pr&&one(pr,'gridSpan'),'val'));return '<td'+(span>1&&span<100?' colspan="'+span+'"':'')+'>'+await inner(n)+'</td>';}
  return inner(n,paragraph,run);
 }
 async function inner(n,paragraph,run){return (await Promise.all([...n.children].map(child=>html(child,paragraph,run)))).join('');}
 const blocks=[];for(const child of op.children)if(child.localName!=='tcPr')blocks.push({xml:serialize(child),html:await html(child),typography:1});return blocks;
}
async function resources(z){const files={};for(const [name,f]of Object.entries(z.files))if(!f.dir&&name!=='customXml/sop-project.xml'&&name!=='word/document.xml'&&name!=='[Content_Types].xml')files[name]=await f.async('base64');return {files,types:await z.file('[Content_Types].xml').async('string'),documentXml:await z.file('word/document.xml').async('string')};}
function explicitTheme(root,theme,language){
 for(const fonts of wNodes(root,'rFonts'))for(const [literal,reference]of fontsByScript){
  const value=theme.font(val(fonts,reference),fontLanguage(fonts.parentElement)||language);
  if(!value)continue;
  fonts.setAttributeNS(W,'w:'+literal,value);
  fonts.removeAttributeNS(W,reference);
 }
 for(const [element,surface,refs]of [['color','val',['themeColor','themeShade','themeTint']],['shd','fill',['themeFill','themeFillShade','themeFillTint']]]){
  for(const node of wNodes(root,element)){
   const value=theme.color(...refs.map(key=>val(node,key)));
   if(!value)continue;
   node.setAttributeNS(W,'w:'+surface,value);
   for(const key of refs)node.removeAttributeNS(W,key);
  }
 }
}
function importedStyles(target,source,prefix){
 const fallback='SopImportDefaults',defaults=sourceDefaults(source),normal=val(defaultParagraph(source),'styleId');
 const node=(name,attrs={})=>{
  const element=target.createElementNS(W,'w:'+name);
  for(const [key,value]of Object.entries(attrs))element.setAttributeNS(W,'w:'+key,value);
  return element;
 };
 const base=node('style',{type:'paragraph',styleId:fallback});
 base.append(node('name',{val:'SOP Imported Defaults'}));
 for(const part of [defaults.pPr,defaults.rPr])if(part)base.append(target.importNode(part,true));
 target.documentElement.append(base);
 for(const st of wNodes(source,'style')){
  const style=target.importNode(st,true);
  style.setAttributeNS(W,'w:styleId',prefix+val(st,'styleId'));
  style.removeAttributeNS(W,'default');
  for(const n of wNodes(style,'*'))if(['basedOn','next','link','pStyle','rStyle','tblStyle'].includes(n.localName))n.setAttributeNS(W,'w:val',prefix+val(n,'val'));
  if(val(st,'type')==='paragraph'&&!one(style,'basedOn')){
   const afterName=one(style,'aliases')||one(style,'name');
   if(afterName)afterName.after(node('basedOn',{val:fallback}));
   else style.prepend(node('basedOn',{val:fallback}));
  }
  target.documentElement.append(style);
 }
 return normal?prefix+normal:fallback;
}

const relationshipAttribute=attr=>attr.namespaceURI===R||attr.namespaceURI==='urn:schemas-microsoft-com:office:office'&&attr.localName==='relid';
const relationshipIds=roots=>new Set(roots.flatMap(root=>[root,...root.getElementsByTagName('*')].flatMap(node=>[...node.attributes].filter(relationshipAttribute).map(attr=>attr.value))));
const decode=data=>new TextDecoder().decode(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
function copyProofPart(files,z,name){
 const path='sop-import/'+name;
 if(!files[name]||z.file(path))return;
 z.file(path,files[name],{base64:true});
 const parts=name.split('/'),basename=parts.pop(),relationshipPath=[...parts,'_rels',basename+'.rels'].join('/');
 if(!files[relationshipPath])return;
 const relationships=parse(decode(files[relationshipPath]));
 const referenced=/\.(xml|vml)$/i.test(name)?relationshipIds([parse(decode(files[name])).documentElement]):null;
 for(const rel of [...relationships.documentElement.children]){
  if(referenced&&!referenced.has(rel.getAttribute('Id'))&&!/\/(chartStyle|chartColorStyle)$/.test(rel.getAttribute('Type'))){rel.remove();continue;}
  if(rel.getAttribute('TargetMode')==='External')continue;
  const dependency=resolve(rel.getAttribute('Target'),name);
  copyProofPart(files,z,dependency);
  rel.setAttribute('Target','/sop-import/'+dependency);
 }
 z.file('sop-import/'+relationshipPath,serialize(relationships));
}
function scopeProofStyles(styles,numbering,roots){
 const styleRefs=new Set(['pStyle','rStyle','tblStyle','basedOn','next','link','styleLink','numStyleLink']);
 const declarations=[
  [styles,'style','styleId',styleRefs],
  [numbering,'num','numId',new Set(['numId'])],
  [numbering,'abstractNum','abstractNumId',new Set(['abstractNumId'])],
  [numbering,'numPicBullet','numPicBulletId',new Set(['lvlPicBulletId'])],
 ];
 const scopes=declarations.map(([file,tag,id,refs])=>({items:new Map(wNodes(file,tag).map(node=>[val(node,id),node])),refs}));
 const used=new Set();
 function visit(node){
  if(!node||used.has(node))return;
  used.add(node);
  for(const ref of wNodes(node,'*'))for(const {items,refs}of scopes)if(refs.has(ref.localName))visit(items.get(val(ref,'val')));
 }
 visit(one(styles?.documentElement,'docDefaults'));
 visit(defaultParagraph(styles));
 for(const root of roots)visit(root);
 for(const {items}of scopes)for(const node of items.values())if(!used.has(node))node.remove();
}
async function exporter(source,z,rels,ct,doc,proofBlocks){
 if(!source)return ()=>[];
 const proofRoots=proofBlocks&&proofBlocks.map(block=>parse(block.xml).documentElement);
 const srcRel=parse(decode(source.files['word/_rels/document.xml.rels']||'')),ids=new Map();
 const sourceRelationships=[...srcRel.documentElement.children];
 const usedIds=proofRoots&&relationshipIds(proofRoots);
 const selectedRelationships=sourceRelationships.filter(rel=>!/\/(styles|numbering|settings|header|footer|customXml)$/.test(rel.getAttribute('Type'))&&(!usedIds||usedIds.has(rel.getAttribute('Id'))));
 // Keep dependencies of the selected native objects and their relationship paths together.
 if(proofRoots){
  for(const rel of selectedRelationships)if(rel.getAttribute('TargetMode')!=='External')copyProofPart(source.files,z,resolve(rel.getAttribute('Target')));
 }else for(const [name,data]of Object.entries(source.files))if(name!=='_rels/.rels')z.file('sop-import/'+name,data,{base64:true});
 const sourceTypes=parse(source.types);for(const type of sourceTypes.documentElement.children){if(type.localName==='Override'){if(!z.file('sop-import'+type.getAttribute('PartName')))continue;const copy=ct.importNode(type,true);copy.setAttribute('PartName','/sop-import'+type.getAttribute('PartName'));ct.documentElement.append(copy);}else if(![...ct.documentElement.children].some(t=>t.getAttribute('Extension')===type.getAttribute('Extension')))ct.documentElement.append(ct.importNode(type,true));}
 for(const [index,rel]of selectedRelationships.entries()){const id='rIdImported'+(index+1),copy=rels.importNode(rel,true);ids.set(rel.getAttribute('Id'),id);copy.setAttribute('Id',id);if(copy.getAttribute('TargetMode')!=='External')copy.setAttribute('Target','../sop-import/'+resolve(copy.getAttribute('Target')));rels.documentElement.append(copy);}
 const stylePrefix='SopImported_';
 const part=type=>{
  const relation=[...srcRel.documentElement.children].find(rel=>rel.getAttribute('Type')?.endsWith('/'+type));
  return relation?source.files[resolve(relation.getAttribute('Target'))]:null;
 };
 const themeFile=part('theme'),theme=themeValues(themeFile?parse(decode(themeFile)):null),stylesFile=part('styles')||source.files['word/styles.xml'];
 const numberingFile=part('numbering')||source.files['word/numbering.xml'];
 const styles=stylesFile?parse(decode(stylesFile)):null,numbering=numberingFile?parse(decode(numberingFile)):null;
 if(proofRoots)scopeProofStyles(styles,numbering,proofRoots);
 let defaultStyle='',language='zh-CN';
 if(styles&&z.file('word/styles.xml')){
  const target=parse(await z.file('word/styles.xml').async('string'));
  language=fontLanguage(sourceDefaults(styles).rPr)||language;
  explicitTheme(styles,theme,language);
  defaultStyle=importedStyles(target,styles,stylePrefix);
  z.file('word/styles.xml',serialize(target));
 }
 let numOffset=0;
 if(numbering?.documentElement.children.length){const src=numbering,target=z.file('word/numbering.xml')?parse(await z.file('word/numbering.xml').async('string')):parse('<w:numbering xmlns:w="'+W+'"/>');numOffset=1000+Math.max(0,...[...target.getElementsByTagNameNS(W,'num')].map(n=>Number(val(n,'numId'))),...[...target.getElementsByTagNameNS(W,'abstractNum')].map(n=>Number(val(n,'abstractNumId'))));for(const n of src.getElementsByTagNameNS(W,'*')){for(const key of ['numId','abstractNumId'])if(n.hasAttributeNS(W,key))n.setAttributeNS(W,'w:'+key,Number(val(n,key))+numOffset);if(['numId','abstractNumId'].includes(n.localName)&&n.hasAttributeNS(W,'val')&&(n.localName!=='numId'||val(n,'val')!=='0'))n.setAttributeNS(W,'w:val',Number(val(n,'val'))+numOffset);if(['pStyle','rStyle','styleLink','numStyleLink'].includes(n.localName))n.setAttributeNS(W,'w:val',stylePrefix+val(n,'val'));}for(const child of src.documentElement.children)target.documentElement.append(target.importNode(child,true));z.file('word/numbering.xml',serialize(target));if(![...rels.documentElement.children].some(r=>r.getAttribute('Type')===R+'/numbering')){const r=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');r.setAttribute('Id','rIdImportedNumbering');r.setAttribute('Type',R+'/numbering');r.setAttribute('Target','numbering.xml');rels.documentElement.append(r);}if(![...ct.documentElement.children].some(t=>t.getAttribute('PartName')==='/word/numbering.xml')){const t=ct.createElementNS(ct.documentElement.namespaceURI,'Override');t.setAttribute('PartName','/word/numbering.xml');t.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml');ct.documentElement.append(t);}}
 if(numOffset&&z.file('word/styles.xml')){const styles=parse(await z.file('word/styles.xml').async('string'));for(const st of styles.getElementsByTagNameNS(W,'style'))if(val(st,'styleId').startsWith(stylePrefix))for(const n of st.getElementsByTagNameNS(W,'numId'))if(val(n,'val')!=='0')n.setAttributeNS(W,'w:val',Number(val(n,'val'))+numOffset);z.file('word/styles.xml',serialize(styles));}
 let drawingId=100000;
 return blocks=>blocks.map(block=>{
  const node=parse(block.xml).documentElement;
  explicitTheme(node,theme,language);
  for(const n of [node,...node.getElementsByTagName('*')]){
   for(const a of [...n.attributes])if(relationshipAttribute(a)&&ids.has(a.value))n.setAttributeNS(a.namespaceURI,a.name,ids.get(a.value));
   if(defaultStyle&&['pStyle','rStyle','tblStyle'].includes(n.localName)&&n.namespaceURI===W&&!(n.localName==='rStyle'&&val(n,'val')===window.SOP_TEMPLATE.operationText.fullWidthStyleId))n.setAttributeNS(W,'w:val',stylePrefix+val(n,'val'));
   if(n.namespaceURI===W&&n.localName==='numId'&&numOffset&&val(n,'val')!=='0')n.setAttributeNS(W,'w:val',Number(val(n,'val'))+numOffset);
   if(n.localName==='docPr'||n.localName==='cNvPr')n.setAttribute('id',++drawingId);
  }
  if(defaultStyle)for(const p of [...(node.localName==='p'&&node.namespaceURI===W?[node]:[]),...wNodes(node,'p')]){
   let pr=one(p,'pPr');
   if(!pr){pr=node.ownerDocument.createElementNS(W,'w:pPr');p.prepend(pr);}
   if(!one(pr,'pStyle')){
    const style=node.ownerDocument.createElementNS(W,'w:pStyle');
    style.setAttributeNS(W,'w:val',defaultStyle);
    pr.prepend(style);
   }
  }
  return doc.importNode(node,true);
 });
}
function preview(p){
 const html=(p.photos?bodyBlocks(p)||p.importedContent.blocks:p.importedContent.blocks).map(b=>b.html).join(''),d=new DOMParser().parseFromString(html,'text/html');
 const tags=new Set(['P','SPAN','DIV','BR','TABLE','TBODY','TR','TD','COLGROUP','COL','IMG','svg','g','image','rect','ellipse','line','defs','marker','path','foreignObject']);
 for(const n of [...d.body.querySelectorAll('*')]){if(!tags.has(n.tagName)){n.remove();continue;}for(const a of [...n.attributes]){const name=a.name.toLowerCase(),value=a.value;
  if((['marker-end','marker-start'].includes(name)&&!/^url\(#importArrow\d+\)$/.test(value))||name.startsWith('on')||!['class','style','colspan','src','alt','xmlns','viewbox','width','height','x','y','x1','x2','y1','y2','cx','cy','rx','ry','href','preserveaspectratio','fill','stroke','stroke-width','id','refx','refy','markerwidth','markerheight','orient','d','marker-end','marker-start','data-sop-cell-anchor'].includes(name)||(['src','href'].includes(name)&&!/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value))||(name==='style'&&/url|expression|@|\\|position\s*:\s*(?!absolute|relative)|behavior/i.test(value)))n.removeAttribute(a.name);
 }}
 const anchors=[...d.body.querySelectorAll('[data-sop-cell-anchor="1"]')];for(const n of anchors){n.remove();d.body.append(n);}
 const scale=Math.max(.05,Math.min(1,Number(p.importedPreviewScale)||1));return '<div class="imported-body"'+(scale<1?' style="zoom:'+scale+'"':'')+'>'+d.body.innerHTML+'</div>';
}
function imageIds(op){const ids=[];const walk=n=>{const chosen=branch(n);if(chosen){walk(chosen);return;}if(n.localName==='drawing'){const extent=n.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0];if(extent&&(Number(extent.getAttribute('cx'))<=0||Number(extent.getAttribute('cy'))<=0))return;}const id=n.localName==='blip'?n.getAttributeNS(R,'embed'):n.localName==='imagedata'?n.getAttributeNS(R,'id'):null;if(id)ids.push(id);for(const c of n.children)walk(c);};walk(op);return ids;}
const projectState=p=>JSON.stringify({meta:p.meta,settings:p.settings,history:p.history,frontContent:p.frontContent,pageOrder:p.pageOrder,pages:p.pages.map(page=>({...page,photos:page.photos.map(({rendered,width,height,...photo})=>photo)}))});
const pageSignoff=(p,m)=>Object.fromEntries(['author','authorDate','reviewer','reviewerDate','approver','approverDate','version'].map(k=>[k,String(p.signoff?(p.signoff[k]??''):(k.endsWith('Date')?m.date||'':m[k]||''))]));

const confidentialityLevels=['绝密','机密','一般'];
function confidentialityLevel(settings){if(confidentialityLevels.includes(settings.confidentialLevel))return settings.confidentialLevel;const text=String(settings.confidential||'').replace(/\s/g,''),checked=text.match(/[☑☒✓✔√](绝密|机密|一般)/),plain=text.match(/^(?:保密等级[：:])?(绝密|机密|一般)$/);return checked?.[1]||plain?.[1]||'';}
function confidentialityText(settings){const level=confidentialityLevel(settings);return level?'保密等级：'+confidentialityLevels.map(label=>(label===level?'☑':'☐')+label).join('  '):String(settings.confidential||'');}
window.SOP_IMPORT={confidentialityLevel,confidentialityText,pageSignoff,projectState,signature,workbenchTracking,active,bodyBlocks,refreshBody,operationLine,capture,typographyParts,resources,exporter,preview,imageIds};
})();
