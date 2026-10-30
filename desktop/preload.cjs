'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sopDesktop',{
 getProjectFile:()=>ipcRenderer.invoke('sop:project-info'),
 resetProjectFile:()=>ipcRenderer.invoke('sop:project-reset'),
 openProjectFile:()=>ipcRenderer.invoke('sop:project-open'),
 commitProjectOpen:ticket=>ipcRenderer.invoke('sop:project-commit-open',ticket),
 saveProjectFile:request=>ipcRenderer.invoke('sop:project-save',request),
 confirmUnsaved:reason=>ipcRenderer.invoke('sop:project-confirm',reason),
 exportPDF:name=>ipcRenderer.invoke('sop:export-pdf',name),
 onBeforeClose:callback=>ipcRenderer.on('sop:before-close',async()=>{
  let result;try{result=await callback();}catch(e){result={ok:false,error:e.message};}
  ipcRenderer.send('sop:close-ready',result);
 })
});
