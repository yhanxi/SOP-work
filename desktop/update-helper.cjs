'use strict';
process.noAsar=true;
// Runs outside app.asar with Electron's Node mode, after the editing window closes.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function restartApp(exe,args=[]){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,args,{cwd:path.dirname(exe),detached:true,stdio:'ignore',windowsHide:false,env});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return child.pid;}
async function waitForExit(pid){if(!Number.isInteger(pid)||pid<=0)return;for(let i=0;i<120;i++){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}await pause(500);}throw Error('原软件尚未退出，未替换程序。');}
async function apply(config){
 const {exe,staged,manifest,key,oldHash,log,restart=true}=config;
 if(path.basename(exe).toLowerCase()!=='sopstudio.exe')throw Error('软件路径无效');
 const target=path.join(path.dirname(exe),'resources','app.asar'),backup=target+'.previous',temp=target+'.'+crypto.randomUUID()+'.update-tmp';
 if(!crypto.verify(null,Buffer.from(manifest.payload),key,Buffer.from(manifest.signature,'base64')))throw Error('更新签名无效');
 const p=JSON.parse(manifest.payload),data=await fs.readFile(staged);if(data.length!==p.bytes||digest(data)!==p.sha256)throw Error('更新包校验失败');
 await waitForExit(config.parentPid);
 let copied=false;
 try{
  for(let attempt=0;attempt<120;attempt++){
   if(digest(await fs.readFile(target))!==oldHash)throw Error('原程序已变化，停止更新');
   try{
    if(!copied){await fs.writeFile(temp,data,{flag:'wx'});copied=true;}
    await fs.copyFile(target,backup);await fs.rename(temp,target);
    if(digest(await fs.readFile(target))!==p.sha256){await fs.copyFile(backup,target);throw Error('写入校验失败，已恢复旧程序');}
    await fs.writeFile(log,JSON.stringify({status:'installed',version:p.version,backup}));
    if(restart){const restartPid=await restartApp(exe,config.restartArgs||[]);await fs.writeFile(log,JSON.stringify({status:'installed',version:p.version,backup,restartPid}));}
    return;
   }catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await pause(1000);}
  }
  throw Error('程序仍被占用，请关闭其他 SOP 窗口后重新下载更新。');
 }finally{if(copied)await fs.unlink(temp).catch(()=>{});}
}
module.exports={apply,restartApp,waitForExit};
if(require.main===module)(async()=>{const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));try{await apply(config);}catch(error){await fs.writeFile(config.log,JSON.stringify({status:'failed',error:error.message}));if(config.restart!==false)await restartApp(config.exe,config.restartArgs||[]);process.exitCode=1;}})().catch(()=>{process.exitCode=1;});
