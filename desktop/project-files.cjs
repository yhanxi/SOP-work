'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const maxBytes=120*1024*1024;
const projectExtension=file=>/\.(json|sop)$/i.test(file);
function validate(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>maxBytes)throw Error('项目文件超过 120MB 或内容无效。');
 const p=JSON.parse(text.replace(/^\uFEFF/,''));
 if(p?.schema!=='sop-studio/v1'||!p.meta||!p.settings||!Array.isArray(p.pages))throw Error('不是有效的 SOP 项目文件。');
 return p;
}
async function hashFile(file){try{return digest(await fs.readFile(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomicWrite(file,text,expected){
 const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmp');
 try{
  const handle=await fs.open(temp,'wx');
  try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
  if(expected!==undefined&&await hashFile(file)!==expected)throw Error('文件在保存过程中被其他程序修改，请重试或另存为。');
  await fs.rename(temp,file);
 }finally{await fs.unlink(temp).catch(()=>{});}
}
function createProjectFileService({dialog,getWindow,sessionFile,pause=()=>{},resume=()=>{}}){
 let current=null,pending=null,busy=false;
 const ready=(async()=>{try{const saved=JSON.parse(await fs.readFile(sessionFile,'utf8'));if(saved?.path&&projectExtension(saved.path)&&saved.token&&saved.fileHash)current=saved;}catch{}})();
 const info=()=>current?{token:current.token,path:current.path,name:path.basename(current.path)}:null;
 async function persist(){await fs.mkdir(path.dirname(sessionFile),{recursive:true});await atomicWrite(sessionFile,JSON.stringify(current));}
 async function remember(value){current=value;let warning;try{await persist();}catch{warning='文件已保存，但未能记住文件位置；下次启动请重新打开项目。';}return {...info(),...(warning?{warning}:{})};}
 async function nativeDialog(method,options){pause();try{return await dialog[method](getWindow(),options);}finally{resume();}}
 async function exclusive(action){if(busy)throw Error('文件操作正在进行，请稍候。');busy=true;try{return await action();}finally{busy=false;}}
 return {
  async info(){await ready;return info();},
  async reset(){await ready;const old=current;current=null;try{await persist();}catch(error){current=old;throw error;}pending=null;return null;},
  async open(){await ready;return exclusive(async()=>{
   const result=await nativeDialog('showOpenDialog',{title:'打开 SOP 项目或 Word',properties:['openFile'],filters:[{name:'SOP 项目或 Word',extensions:['json','sop','docx']}]});
   if(result.canceled||!result.filePaths?.[0])return {canceled:true};
   const file=result.filePaths[0],isWord=/\.docx$/i.test(file);if(!isWord&&!projectExtension(file))throw Error('仅支持 SOP 项目或 DOCX。');
   const stat=await fs.stat(file);if(stat.size>maxBytes)throw Error('文件超过 120MB。');const bytes=await fs.readFile(file),text=isWord?null:bytes.toString('utf8').replace(/^\uFEFF/,'');if(!isWord)validate(text);
   const ticket=crypto.randomUUID();pending={ticket,value:isWord?null:{path:file,token:crypto.randomUUID(),fileHash:digest(bytes)}};
   return {ticket,kind:isWord?'docx':'project',name:path.basename(file),...(isWord?{base64:bytes.toString('base64')}:{text})};
  });},
  async commit(ticket){await ready;if(!pending||pending.ticket!==ticket)throw Error('打开操作已失效。');const value=pending.value;const old=current;current=value;try{await persist();}catch(error){current=old;throw error;}pending=null;return info();},
  async save(request){await ready;return exclusive(async()=>{
   validate(request?.text);const saveAs=request.saveAs||!current||!request.token;
   if(!saveAs&&request.token!==current.token)throw Error('当前文件关联已改变，请重新打开或另存为。');
   let file=current?.path,expected;
   if(saveAs){
    const name=String(request.name||'未命名项目.sop.json').replace(/[\\/:*?"<>|]/g,'_').slice(0,180);
    const chosen=await nativeDialog('showSaveDialog',{title:request.saveAs?'项目另存为':'保存项目',defaultPath:current?path.join(path.dirname(current.path),name):name,filters:[{name:'SOP 项目',extensions:['json']}]});
    if(chosen.canceled||!chosen.filePath)return {canceled:true};file=chosen.filePath;if(!/\.sop\.json$/i.test(file))file=file.replace(/\.json$/i,'')+'.sop.json';expected=await hashFile(file);if(expected!==null){const choice=await nativeDialog('showMessageBox',{type:'warning',title:'替换已有项目文件',message:'此位置已有项目文件，是否替换？',detail:file,buttons:['替换文件','取消'],defaultId:1,cancelId:1,noLink:true});if(choice.response!==0)return {canceled:true};}
   }else{
    expected=await hashFile(file);
    if(expected!==current.fileHash){const choice=await nativeDialog('showMessageBox',{type:'warning',title:'项目文件已在外部更改',message:'磁盘上的项目文件已被修改或移走。是否用当前内容覆盖？',detail:file,buttons:['覆盖当前文件','取消'],defaultId:1,cancelId:1,noLink:true});if(choice.response!==0)return {canceled:true};}
   }
   await atomicWrite(file,request.text,expected);
   const binding=await remember({path:file,token:saveAs?crypto.randomUUID():current.token,fileHash:digest(Buffer.from(request.text,'utf8'))});return {canceled:false,binding};
  });},
  async confirm(reason){await ready;return nativeDialog('showMessageBox',{type:'question',title:'项目有未保存的更改',message:'是否先保存到项目文件？',detail:current?current.path:'当前项目尚未保存为文件。',buttons:['保存','不保存，继续'+({open:'打开',new:'新建',close:'关闭'}[reason]||'操作'),'取消'],defaultId:0,cancelId:2,noLink:true}).then(r=>['save','discard','cancel'][r.response]||'cancel');}
 };
}
module.exports={createProjectFileService,atomicWrite,validate};
