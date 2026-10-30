/* Project-file saving is separate from the local crash-recovery cache. */
(() => {
'use strict';
window.SOP_FILES={create({getProject,applyProject,recover,toast,download,filename,stateText}){
 const desktop=window.sopDesktop;
 let binding=null,handle=null,savedHash='',diskHash='',revision=0,savedRevision=0,initialDirty=false,busy=false,ready=false;
 const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
 const contentHash=()=>hash(stateText(getProject()));
 const dirty=()=>initialDirty||revision!==savedRevision;
 const state=()=>({binding,handle,savedHash,diskHash,dirty:dirty()});
 function status(){
  const el=document.querySelector('#saveState');if(!ready)return;
  const file=binding?.name||handle?.name;
  el.textContent=file?file+' · '+(dirty()?'未保存修改':'项目文件已保存'):(dirty()?'未保存为项目文件':'尚未选择项目文件');
  el.textContent+=' · '+({failed:'恢复缓存不可用',pending:'正在保存恢复缓存…',saved:'本机恢复缓存已保存'}[document.body.dataset.recovery]||'');
  el.title=(binding?.path||file||'首次保存请选择 .sop.json 文件')+'\n'+(document.body.dataset.recovery==='failed'?'本机恢复缓存不可用，请及时保存文件。':'编辑后自动保留本机恢复缓存；项目文件请点击“保存”。');
  document.title=(dirty()?'* ':'')+(getProject().meta.product||'SOP 工作台');
 }
 function setBusy(value){busy=value;for(const id of ['saveBtn','saveAsBtn','newBtn','importBtn'])document.getElementById(id).disabled=value||!ready;}
 function pendingDialog(){
  if(document.querySelector('.object-dialog[open]'))return '请先点击“保存画布”，或取消画布编辑，再保存项目或关闭软件。';
  if(document.querySelector('#photoDialog[open]'))return '请先保存图片标注，或关闭标注窗口，再保存项目或关闭软件。';
  if(document.querySelector('#formDialog[open] #dialogApply:not([hidden])'))return '请先保存或取消当前设置窗口，再保存项目或关闭软件。';
  return '';
 }
 async function cache(){try{await recover();document.body.dataset.recovery='saved';return true;}catch{document.body.dataset.recovery='failed';return false;}finally{status();}}
 function browserChoice(reason){return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='file-save-prompt';
  dialog.innerHTML='<h2>项目有未保存的更改</h2><p>是否先保存到项目文件？本机恢复缓存会单独保留。</p><div class="dialog-foot"><button data-choice="cancel">取消</button><button data-choice="discard">不保存，继续</button><button data-choice="save" class="primary">保存</button></div>';
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});
  dialog.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>finish(button.dataset.choice));document.body.append(dialog);dialog.showModal();
 });}
 async function save(saveAs=false){
  if(!ready||busy)return false;
  const pending=pendingDialog();if(pending){toast(pending,true);return false;}
  setBusy(true);
  try{
   const capturedRevision=revision,text=JSON.stringify(getProject(),null,2),fingerprint=await contentHash();
   let result;
   if(desktop){
    result=await desktop.saveProjectFile({text,name:filename()+'.sop.json',token:binding?.token,saveAs});
    if(result.canceled)return false;binding=result.binding;handle=null;
   }else if(window.showSaveFilePicker){
    let target=handle;
    if(saveAs||!target)target=await window.showSaveFilePicker({suggestedName:filename()+'.sop.json',types:[{description:'SOP 项目',accept:{'application/json':['.sop.json']}}]});
    if(target===handle&&diskHash&&await hash(await (await target.getFile()).text())!==diskHash&&!confirm('项目文件已在外部修改，是否用当前内容覆盖？'))return false;
    const writer=await target.createWritable();try{await writer.write(text);await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
    handle=target;binding=null;diskHash=await hash(text);
   }else{
    download(new Blob([text],{type:'application/json'}),filename()+'.sop.json');
    toast('已发起项目副本下载。此浏览器不能直接更新原文件，请确认下载完成；桌面版支持保存到当前文件。',true);
    return false;
   }
   savedHash=fingerprint;savedRevision=capturedRevision;initialDirty=false;
   const cached=await cache();
   toast(result?.binding?.warning||(!cached?'项目文件已保存；本机恢复缓存不可用。':'项目文件已保存：'+(binding?.name||handle.name)),!cached||!!result?.binding?.warning);
   return true;
  }catch(error){if(error.name!=='AbortError')toast('保存失败，原项目文件保留：'+error.message,true);return false;}
  finally{setBusy(false);status();}
 }
 async function guard(reason){
  if(!ready||busy){toast('文件操作正在进行，请稍候。',true);return false;}
  const pending=pendingDialog();if(pending){toast(pending,true);return false;}
  if(!dirty())return true;
  const choice=desktop?await desktop.confirmUnsaved(reason):await browserChoice(reason);
  if(choice==='cancel')return false;
  if(choice==='save'){const saved=await save(false);if(saved&&dirty()){toast('保存期间又有新修改，请再次保存。',true);return false;}return saved;}return choice==='discard';
 }
 async function imported({text,bytes,isWord,ticket,newHandle}){
  let p=isWord?await window.SOP_WORD.importDocx(bytes):JSON.parse(text.replace(/^\uFEFF/,''));
  // applyProject validates and prepares all images before changing the visible project.
  await applyProject(p,async()=>{
   binding=desktop?await desktop.commitProjectOpen(ticket):null;
   handle=isWord?null:newHandle||null;diskHash=handle?await hash(text):'';
  });
  revision++;savedRevision=revision;initialDirty=isWord||(!binding&&!handle);savedHash=initialDirty?'':await contentHash();
  await cache();toast(isWord?'Word 已导入，请核对预览；保存时另存为 SOP 项目，不覆盖 Word。':'项目已打开。');
 }
 async function open(){
  if(!await guard('open'))return;
  if(!desktop&&!window.showOpenFilePicker){document.querySelector('#importFile').click();return;}
  setBusy(true);
  try{
   if(desktop){const file=await desktop.openProjectFile();if(file.canceled)return;await imported({text:file.text,bytes:file.base64?Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0)).buffer:null,isWord:file.kind==='docx',ticket:file.ticket});}
   else{const [picked]=await window.showOpenFilePicker({multiple:false,types:[{description:'SOP 项目或 Word',accept:{'application/json':['.json','.sop'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']}}]});const file=await picked.getFile();if(file.size>120*1024*1024)throw Error('文件超过 120MB。');const isWord=/\.docx$/i.test(file.name);await imported({text:isWord?null:await file.text(),bytes:isWord?await file.arrayBuffer():null,isWord,newHandle:picked});}
  }catch(error){if(error.name!=='AbortError')toast('打开失败，当前项目仍保留：'+error.message,true);}
  finally{setBusy(false);status();}
 }
 return {
  state,status,save,open,guard,
  changed(){revision++;status();},
  async restore(meta,hasSaved){
   try{
    if(desktop){const current=await desktop.getProjectFile();if(meta?.binding?.token&&meta.binding.token===current?.token)binding=current;else await desktop.resetProjectFile();}
    else handle=meta?.handle||null;
    savedHash=meta?.savedHash||'';diskHash=meta?.diskHash||'';
    initialDirty=!!hasSaved&&(!binding&&!handle||!savedHash||savedHash!==await contentHash());
   }catch(error){binding=null;handle=null;initialDirty=!!hasSaved;toast('未恢复文件关联，请用“保存”重新选择文件。',true);}
   ready=true;setBusy(false);status();
  },
  async detach(){if(desktop)await desktop.resetProjectFile();binding=null;handle=null;savedHash='';diskHash='';initialDirty=true;revision++;status();},
  async importFile(file){if(busy||!ready)return;setBusy(true);try{if(file.size>120*1024*1024)throw Error('文件超过 120MB。');const isWord=/\.docx$/i.test(file.name);await imported({text:isWord?null:await file.text(),bytes:isWord?await file.arrayBuffer():null,isWord});}catch(error){toast('打开失败，当前项目仍保留：'+error.message,true);}finally{setBusy(false);status();}},
  async beforeClose(){if(!await guard('close'))return {ok:false,canceled:true};await cache();return {ok:true};},
  beforeUnload(event){if(dirty()||pendingDialog()){event.preventDefault();event.returnValue='';}}
 };
}};
})();
