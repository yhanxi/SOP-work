'use strict';
const {app,BrowserWindow,Menu,protocol,net,ipcMain,dialog}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createProjectFileService}=require('./project-files.cjs');
const {createUpdater}=require('./updater.cjs');
const origin='sop://app';
protocol.registerSchemesAsPrivileged([{scheme:'sop',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const testMode=process.argv.includes('--sop-test');
if(testMode&&process.env.SOP_STUDIO_TEST_USERDATA)app.setPath('userData',path.resolve(process.env.SOP_STUDIO_TEST_USERDATA));
let win,projectFiles,updater,restartRequested=false,allowClose=false,closing=false,closeTimer;
function startCloseTimer(){clearTimeout(closeTimer);if(closing)closeTimer=setTimeout(()=>respondToClose({error:'保存请求超时，请重试保存。'}),30000);}
const trusted=event=>win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url.startsWith(origin+'/');
async function respondToClose(result){clearTimeout(closeTimer);closing=false;if(result?.ok){try{if(restartRequested)await updater.launchInstall();allowClose=true;win.close();}catch(error){restartRequested=false;dialog.showErrorBox('更新未安装',error.message);}}else{restartRequested=false;if(!result?.canceled)dialog.showMessageBox(win,{type:'warning',title:'项目尚未保存',message:'保存未完成，请先保存项目文件，再关闭软件。',detail:String(result?.error||'保存没有及时完成。')});}}
ipcMain.on('sop:close-ready',(event,result)=>{if(trusted(event)&&closing)respondToClose(result);});
for(const [channel,method]of [['info','info'],['reset','reset'],['open','open'],['commit-open','commit'],['save','save'],['confirm','confirm']])ipcMain.handle('sop:project-'+channel,(event,arg)=>{if(!trusted(event))throw Error('请求来源不支持');return projectFiles[method](arg);});
for(const [name,action]of [['info',()=>updater.info()],['check',()=>updater.check(true)],['download',()=>updater.download()],['cancel',()=>updater.cancel()],['settings',value=>updater.configure(value)],['install',async()=>{await updater.prepareInstall();restartRequested=true;win.close();}],['release',()=>require('electron').shell.openExternal(require('./update-core.cjs').releaseURL)]])ipcMain.handle('sop:update-'+name,(event,arg)=>{if(!trusted(event))throw Error('请求来源不支持');return action(arg);});
ipcMain.handle('sop:export-pdf',async(event,name)=>{
 if(!trusted(event))throw Error('请求来源不支持');
 try{const safe=String(name||'SOP.pdf').replace(/[\\/:*?"<>|]/g,'_').slice(0,180);const result=await dialog.showSaveDialog(win,{title:'保存 SOP PDF',defaultPath:path.join(app.getPath('documents'),safe),filters:[{name:'PDF 文档',extensions:['pdf']} ]});if(result.canceled)return {canceled:true};const bytes=await win.webContents.printToPDF({landscape:true,pageSize:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,margins:{top:0,bottom:0,left:0,right:0}});await fs.writeFile(result.filePath,bytes);return {canceled:false};}catch(e){return {error:e.message};}
});
function createWindow(){
 win=new BrowserWindow({width:1540,height:1000,minWidth:1000,minHeight:720,show:false,title:'SOP 工作台',backgroundColor:'#f5f7f8',icon:path.join(__dirname,'build/icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.once('ready-to-show',()=>win.show());
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(url!==origin+'/index.html')event.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win.webContents.session.on('will-download',(_event,item)=>item.setSaveDialogOptions({title:'保存 SOP 文件',defaultPath:path.join(app.getPath('documents'),item.getFilename())}));
 win.on('close',event=>{if(allowClose||win.webContents.isLoadingMainFrame())return;event.preventDefault();if(closing)return;closing=true;startCloseTimer();win.webContents.send('sop:before-close');});
 win.webContents.on('render-process-gone',()=>{allowClose=true;});
 win.loadURL(origin+'/index.html');
 const click=id=>{if(win&&!win.isDestroyed())win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`).catch(()=>{});};
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'文件',submenu:[{label:'新建 SOP',click:()=>click('newBtn')},{label:'打开项目 / 导入 Word',accelerator:'CmdOrCtrl+O',click:()=>click('importBtn')},{label:'保存',accelerator:'CmdOrCtrl+S',click:()=>click('saveBtn')},{label:'另存为',accelerator:'CmdOrCtrl+Shift+S',click:()=>click('saveAsBtn')},{label:'导出 Word',click:()=>click('docxBtn')},{label:'预览 / PDF',click:()=>click('pdfBtn')},{type:'separator'},{label:'退出',click:()=>win.close()}]},
  {label:'编辑',submenu:[{role:'undo',label:'撤销输入'},{role:'redo',label:'重做输入'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
  {label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
  {label:'帮助',submenu:[{label:'检查软件更新',click:()=>{win.webContents.executeJavaScript("window.dispatchEvent(new Event('sop:show-updates'))").catch(()=>{});}},{type:'separator'},{label:'使用说明',click:()=>click('helpBtn')},{label:'关于 SOP 工作台',click:()=>dialog.showMessageBox(win,{type:'info',title:'SOP 工作台',message:'SOP 工作台 '+app.getVersion(),detail:'离线编写 · 自定义公司格式 · 可编辑 Word 导出\n项目仅保存在本机。使用保存或另存为保留 .sop.json 项目文件。'})}]}
 ]));
}
const single=testMode||app.requestSingleInstanceLock();
if(!single)app.quit();else{
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 app.whenReady().then(()=>{
  const root=path.join(__dirname,'renderer');
  protocol.handle('sop',async request=>{try{const url=new URL(request.url);if(url.host!=='app')return new Response('',{status:403});const relative=decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(root,relative||'index.html');if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.png','.ico','.md'].includes(path.extname(file)))return new Response('',{status:403});const response=await net.fetch(pathToFileURL(file).toString());const headers=new Headers(response.headers);headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'");return new Response(response.body,{status:response.status,headers});}catch{return new Response('',{status:404});}});
  projectFiles=createProjectFileService({dialog,getWindow:()=>win,sessionFile:path.join(app.getPath('userData'),'project-file-session.json'),pause:()=>clearTimeout(closeTimer),resume:startCloseTimer});
  updater=createUpdater({app,net,publicKey:require('node:fs').readFileSync(path.join(__dirname,'update-public.pem'),'utf8'),testMode,onState:state=>{if(win&&!win.isDestroyed())win.webContents.send('sop:update-state',state);}});
  createWindow();updater.start();
 });
 app.on('window-all-closed',()=>app.quit());
}
