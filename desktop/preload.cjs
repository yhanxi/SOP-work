'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('sopDesktop',{
 exportPDF:name=>ipcRenderer.invoke('sop:export-pdf',name),
 onBeforeClose:callback=>ipcRenderer.on('sop:before-close',async()=>{
  let result;try{result=await callback();}catch(e){result={ok:false,error:e.message};}
  ipcRenderer.send('sop:close-ready',result);
 })
});
