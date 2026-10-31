'use strict';
const packagedFs=require('node:fs/promises');
const fs=(process.versions.electron?require('original-fs').promises:packagedFs),path=require('node:path'),{spawn}=require('node:child_process');
const {repo,releaseURL,newer,httpsURL,verify,digest,verifyPackage}=require('./update-core.cjs');
function createUpdater({app,net,onState,publicKey,testMode=false,runtime=process.versions.electron}){
 const dir=path.join(app.getPath('userData'),'updates'),settingsFile=path.join(dir,'settings.json'),log=path.join(dir,'result.json');
 let settings={autoCheck:true,mirror:''},state={phase:'idle',current:app.getVersion(),releaseURL},candidate=null,envelope=null,downloaded=null,checking=false,downloading=false,controller;
 const emit=extra=>{state={...state,...extra};onState({...state,settings});};
 const ready=(async()=>{await fs.mkdir(dir,{recursive:true});try{const value=JSON.parse(await fs.readFile(settingsFile,'utf8'));settings={autoCheck:value.autoCheck!==false,mirror:value.mirror?httpsURL(value.mirror):''};}catch{}try{const result=JSON.parse(await fs.readFile(log,'utf8'));if(result.status==='failed')emit({phase:'error',message:'上次更新未完成：'+result.error});}catch{}})();
 async function bytes(url,max,timeout,progress){
  controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await net.fetch(url,{signal:controller.signal,headers:{'Accept':'application/vnd.github+json','User-Agent':'SOP-work-updater'}});if(!response.ok)throw Error('下载服务返回 '+response.status);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>max)throw Error('下载内容超出限制');chunks.push(Buffer.from(chunk));progress?.(size);}return Buffer.concat(chunks);}finally{clearTimeout(timer);controller=null;}
 }
 async function check(manual=false){await ready;if(checking||downloading)return state;checking=true;emit({phase:'checking',latest:null,notes:'',bytes:0,message:'正在检查更新…'});
  try{
   let failures=[];candidate=null;envelope=null;downloaded=null;
   for(const source of [...(settings.mirror?[settings.mirror+'/latest.json']:[]), 'github']){
    try{
     let url=source;
     if(source==='github'){const release=JSON.parse((await bytes('https://api.github.com/repos/'+repo+'/releases/latest',1000000,15000)).toString());const asset=release.assets?.find(a=>a.name==='SOP-update.json');if(!asset){if(newer(String(release.tag_name||'').replace(/^v/,''),state.current)){emit({phase:'manual',message:'发现新版，请前往发布页下载安装。'});return state;}emit({phase:'current',message:'当前已是最新版本。'});return state;}url=asset.browser_download_url;if(!url.startsWith('https://github.com/'+repo+'/releases/download/'))throw Error('更新清单地址不受支持');}
     const signed=JSON.parse((await bytes(url,50000,15000)).toString()),p=verify(signed,publicKey);
     if(candidate&&!newer(p.version,candidate.version))continue;candidate=p;envelope=signed;
     if(source==='github'||!manual)break;
    }catch(error){failures.push(error.message);}
   }
   if(!candidate)throw Error(failures.join('；')||'无法连接更新服务');
   if(!newer(candidate.version,state.current)){emit({phase:'current',message:'当前已是最新版本。'});return state;}
   if(candidate.electron!==runtime){emit({phase:'manual',latest:candidate.version,message:'新版包含运行环境升级，请下载安装程序。'});return state;}
   emit({phase:'available',latest:candidate.version,bytes:candidate.bytes,notes:String(candidate.notes||'').slice(0,2000),message:'发现新版本 '+candidate.version});
  }catch(error){emit({phase:'error',message:'检查失败：'+error.message+'。可以继续离线编写，稍后重试或配置备用地址。'});}
  finally{checking=false;}return state;
 }
 async function download(){await ready;if(downloading||checking||!candidate||!['available','error','canceled'].includes(state.phase))return state;downloading=true;emit({phase:'downloading',received:0,bytes:candidate.bytes,message:'正在下载更新…'});
  try{
   const urls=[...(settings.mirror?[settings.mirror+'/'+candidate.asset]:[]),'https://github.com/'+repo+'/releases/download/v'+candidate.version+'/'+candidate.asset];let data,errors=[];
   for(const url of urls)try{data=await bytes(url,candidate.bytes,90000,received=>emit({received}));verifyPackage(data,candidate);break;}catch(error){data=null;errors.push(error.message);if(error.name==='AbortError'&&state.phase==='canceled')throw error;}
   if(!data)throw Error(errors.join('；'));downloaded=path.join(dir,'pending.asar');await fs.writeFile(downloaded+'.tmp',data);await fs.rename(downloaded+'.tmp',downloaded);emit({phase:'ready',message:'更新已校验，保存项目后可重启安装。',received:data.length});
  }catch(error){if(state.phase!=='canceled')emit({phase:'error',message:'下载失败：'+error.message});}
  finally{downloading=false;}return state;
 }
 return {
  async info(){await ready;return {...state,settings};},check,download,
  cancel(){if(downloading){emit({phase:'canceled',message:'下载已取消。'});controller?.abort();}return state;},
  async configure(value){await ready;if(checking||downloading)throw Error('请先等待检查或下载结束。');const next={autoCheck:value.autoCheck!==false,mirror:value.mirror?httpsURL(String(value.mirror).trim()):''};await fs.writeFile(settingsFile,JSON.stringify(next));settings=next;emit({message:'更新设置已保存。'});return {...state,settings};},
  async prepareInstall(){if(!app.isPackaged||process.platform!=='win32')throw Error('此运行方式不能安装更新，请使用已安装的 Windows 软件。');if(!downloaded||state.phase!=='ready')throw Error('请先下载并校验更新');verifyPackage(await fs.readFile(downloaded),candidate);return true;},
  async launchInstall(){
   const helper=path.join(dir,'apply-update.cjs'),config=path.join(dir,'apply-update.json'),target=path.join(process.resourcesPath,'app.asar');
   await fs.writeFile(helper,await packagedFs.readFile(path.join(__dirname,'update-helper.cjs')));
   await fs.writeFile(config,JSON.stringify({exe:process.execPath,staged:downloaded,manifest:envelope,key:publicKey,oldHash:digest(await fs.readFile(target)),log,restart:!testMode}));
   const child=spawn(process.execPath,[helper,config],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},detached:true,stdio:'ignore',windowsHide:true});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  },
  async start(){await ready;if(!testMode){const timer=setTimeout(()=>{if(settings.autoCheck)check();},10000);timer.unref();const repeat=setInterval(()=>{if(settings.autoCheck&&!['ready','available'].includes(state.phase))check();},6*60*60*1000);repeat.unref();}}
 };
}
module.exports={createUpdater};
