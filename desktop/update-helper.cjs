'use strict';
process.noAsar=true;
// Runs outside app.asar with Electron's Node mode, after the editing window closes.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function apply(config){
 const {exe,staged,manifest,key,oldHash,log,restart=true}=config;
 if(path.basename(exe).toLowerCase()!=='sopstudio.exe')throw Error('软件路径无效');
 const target=path.join(path.dirname(exe),'resources','app.asar'),backup=target+'.previous',temp=target+'.'+crypto.randomUUID()+'.update-tmp';
 if(!crypto.verify(null,Buffer.from(manifest.payload),key,Buffer.from(manifest.signature,'base64')))throw Error('更新签名无效');
 const p=JSON.parse(manifest.payload),data=await fs.readFile(staged);if(data.length!==p.bytes||digest(data)!==p.sha256)throw Error('更新包校验失败');
 let copied=false;
 try{
  for(let attempt=0;attempt<120;attempt++){
   if(digest(await fs.readFile(target))!==oldHash)throw Error('原程序已变化，停止更新');
   try{
    if(!copied){await fs.writeFile(temp,data,{flag:'wx'});copied=true;}
    await fs.copyFile(target,backup);await fs.rename(temp,target);
    if(digest(await fs.readFile(target))!==p.sha256){await fs.copyFile(backup,target);throw Error('写入校验失败，已恢复旧程序');}
    await fs.writeFile(log,JSON.stringify({status:'installed',version:p.version,backup}));
    if(restart){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,[],{detached:true,stdio:'ignore',windowsHide:true,env});child.unref();}
    return;
   }catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await pause(1000);}
  }
  throw Error('程序仍被占用，请关闭其他 SOP 窗口后重新下载更新。');
 }finally{if(copied)await fs.unlink(temp).catch(()=>{});}
}
module.exports={apply};
if(require.main===module)(async()=>{const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));try{await apply(config);}catch(error){await fs.writeFile(config.log,JSON.stringify({status:'failed',error:error.message}));if(config.restart!==false){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(config.exe,[],{env,detached:true,stdio:'ignore',windowsHide:true});child.unref();}process.exitCode=1;}})().catch(()=>{process.exitCode=1;});
