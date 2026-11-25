'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');

const run=promisify(execFile);
const proofName=/^SOP校样-(?:[\p{L}\p{N} _().（）-]{1,40}-)?[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\.docx$/u;
const managedSuffix='.sop-proof';
const openedSuffix='.sop-opened';
const maxBytes=120*1024*1024;

function makeName(name){
 const label=name.normalize('NFKC').replace(/\.docx$/i,'').replace(/[^\p{L}\p{N} _().（）-]|[\u{10000}-\u{10ffff}]/gu,'-').trim().slice(0,40).replace(/[.\s-]+$/u,'');
 return 'SOP校样-'+(label?label+'-':'')+randomUUID()+'.docx';
}

async function dropWindows(root,candidates){
 const script=await fs.readFile(path.join(__dirname,'proof-cleanup.ps1'),'utf8');
 const command=Buffer.from(script,'utf16le').toString('base64');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const request=Buffer.from(JSON.stringify({root,candidates}),'utf8').toString('base64');
 await run(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',command],{
  windowsHide:true,timeout:15000,maxBuffer:65536,env:{...process.env,SOP_PROOF_CLEANUP_REQUEST:request}
 });
}

function createProofFiles({root,openPath,drop=dropWindows,poll=2000,launchGrace=6000,staleAfter=120000}){
 const inFlight=new Set(),failed=new Set(),free=new Set();
 let timer,working=false,stopped=false,lastStaleCheck=0;
 const normalize=name=>process.platform==='win32'?path.resolve(name).toLowerCase():path.resolve(name);

 async function safeDirectory(create){
  try{
   if(create){
    const parent=path.dirname(root);
    if(normalize(await fs.realpath(parent))!==normalize(parent))throw Error('校样临时目录不可用。');
    await fs.mkdir(root).catch(error=>{if(error.code!=='EEXIST')throw error;});
   }
   const info=await fs.lstat(root);
   const resolved=await fs.realpath(root);
   if(info.isDirectory()&&!info.isSymbolicLink()&&normalize(resolved)===normalize(root))return true;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  if(create)throw Error('校样临时目录不可用。');
  return false;
 }

 function schedule(delay=poll){
  if(stopped||timer||working)return;
  timer=setTimeout(()=>{
   timer=undefined;
   sweep().catch(()=>true).then(remaining=>{if(remaining)schedule();});
  },delay);
  timer.unref();
 }

 async function sweep(){
  if(working||stopped)return false;
  working=true;
  try{
   if(!await safeDirectory(false))return false;
   const entries=new Map((await fs.readdir(root,{withFileTypes:true})).map(entry=>[entry.name,entry]));
   const now=Date.now(),checkStale=now-lastStaleCheck>=Math.max(30000,poll);
   const candidates=[];
   let remaining=inFlight.size>0;
   for(const entry of entries.values()){
    if(!entry.name.endsWith(managedSuffix)||!entry.isFile()||entry.isSymbolicLink())continue;
    const name=entry.name.slice(0,-managedSuffix.length);
    if(!proofName.test(name))continue;
    remaining=true;
    if(inFlight.has(name))continue;
    const managed=await fs.lstat(path.join(root,entry.name)).catch(()=>null);
    if(!managed?.isFile()||managed.nlink!==1)continue;
    const age=now-managed.mtimeMs;
    const owner=entries.has('~$'+name.slice(2))||entries.has('~$'+name);
    const opened=entries.get(name+openedSuffix);
    if(owner){
     free.delete(name);
     if(!opened)await fs.writeFile(path.join(root,name+openedSuffix),'',{flag:'wx'}).catch(()=>{});
    }
    if(!entries.has(name)){
     candidates.push({name,stale:false});
    }else if(!owner&&age>=launchGrace&&(opened?.isFile()||failed.has(name))){
     if(free.has(name))candidates.push({name,stale:false});
     free.add(name);
    }else if(age>=staleAfter&&checkStale){
     candidates.push({name,stale:true});
    }
    if(candidates.length===32)break;
   }
   if(candidates.length){
    if(candidates.some(item=>item.stale))lastStaleCheck=now;
    await drop(root,candidates);
   }
   for(const names of [free,failed]){
    for(const name of names)if(!entries.has(name+managedSuffix))names.delete(name);
   }
   return remaining;
  }finally{working=false;}
 }

 return {
  start:()=>schedule(0),
  stop(){stopped=true;clearTimeout(timer);},
  async open(request){
   const {bytes,name}=request||{};
   if(typeof name!=='string'||name.length>512||!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>maxBytes||
     bytes[0]!==0x50||bytes[1]!==0x4b||bytes[2]!==3||bytes[3]!==4)return {error:'校样 DOCX 数据无效或超过 120MB。'};
   const filename=makeName(name);
   inFlight.add(filename);
   try{
    await safeDirectory(true);
    await fs.writeFile(path.join(root,filename+managedSuffix),'',{flag:'wx'});
    const file=path.join(root,filename);
    await fs.writeFile(file,bytes,{flag:'wx'});
    const error=await openPath(file);
    if(error)throw Error('无法使用默认办公软件打开校样。'+error);
    return {ok:true};
   }catch(error){failed.add(filename);return {error:error.message};}
   finally{inFlight.delete(filename);schedule();}
  }
 };
}

module.exports={createProofFiles};
