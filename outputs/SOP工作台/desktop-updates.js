(() => {
'use strict';
if(!window.sopDesktop?.updateInfo)return;
const api=window.sopDesktop,button=document.querySelector('#updateBtn');button.hidden=false;
let state,notified='';
const dialog=document.createElement('dialog');dialog.id='updateDialog';
dialog.innerHTML=`<div class="update-header"><div class="update-heading"><span class="update-app-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg></span><div><h2>软件更新</h2><p id="updateVersion"></p></div></div><button id="closeUpdate" class="update-close" aria-label="关闭">×</button></div>
<div class="update-body"><section class="update-status-card"><span id="updateStatusIcon" class="update-status-icon" aria-hidden="true">↻</span><div class="update-status-copy"><h3 id="updateStatusTitle">保持工作台为最新版本</h3><p id="updateMessage" role="status"></p><progress id="updateProgress" max="100" value="0" hidden></progress><span id="updateSize"></span></div></section>
<section id="updateNotesSection" class="update-notes" hidden><h3>本次更新</h3><p id="updateNotes"></p></section>
<div class="update-preferences"><label class="update-auto"><span class="update-auto-copy"><strong>自动检查更新</strong><small>启动后检查，每 6 小时复查</small></span><input id="autoUpdateCheck" type="checkbox" role="switch"></label><details id="updateSourceDetails"><summary>下载源设置<span id="updateSourceLabel">GitHub 直连</span></summary><div class="update-source-body"><label for="updateMirror">备用下载地址</label><input id="updateMirror" type="url" placeholder="https://downloads.example.com/sop"><p>留空使用 GitHub。配置后优先使用备用地址，失败时回退直连。</p><button id="saveUpdateSettings">应用下载设置</button></div></details></div></div>
<div class="update-footer"><button id="openUpdateRelease" class="update-text-button">发布记录 ↗</button><div class="update-footer-actions"><button id="checkUpdate">检查更新</button><button id="cancelUpdate" hidden>取消下载</button><button id="downloadUpdate" class="primary" hidden>下载更新</button><button id="installUpdate" class="primary" hidden>重启并安装</button></div></div>`;
document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);
function render(value){
 state=value;button.textContent=['available','ready'].includes(value.phase)?'软件更新 •':'软件更新';
 dialog.dataset.phase=value.phase;$('updateVersion').textContent='当前版本 '+value.current+(value.latest?'  →  '+value.latest:'');
 const titles={checking:'正在检查新版本',current:'已是最新版本',available:'有新版本可用',downloading:'正在下载更新',ready:'更新已准备就绪',error:'暂时无法完成更新',canceled:'下载已取消',manual:'发现运行环境升级'};
 $('updateStatusTitle').textContent=titles[value.phase]||'保持工作台为最新版本';$('updateStatusIcon').textContent=['current','ready'].includes(value.phase)?'✓':value.phase==='error'?'!':'↻';$('updateMessage').textContent=value.message||'可手动检查更新；自动检查不会自行安装。';
 $('updateNotes').textContent=value.notes||'';$('updateNotesSection').hidden=!value.notes;const loading=value.phase==='downloading';$('updateProgress').hidden=!loading;$('updateProgress').value=value.bytes?Math.min(100,(value.received||0)/value.bytes*100):0;
 $('updateSize').textContent=value.bytes?'更新大小 '+Math.ceil(value.bytes/1024)+' KB'+(loading?' · '+Math.round($('updateProgress').value)+'%':''):'';
 $('downloadUpdate').hidden=!['available','canceled'].includes(value.phase)&&!(value.phase==='error'&&value.latest);$('installUpdate').hidden=value.phase!=='ready';$('cancelUpdate').hidden=!loading;
 $('autoUpdateCheck').disabled=loading||value.phase==='checking';$('checkUpdate').disabled=loading||value.phase==='checking';$('saveUpdateSettings').disabled=loading||value.phase==='checking';
 if(value.settings){$('updateSourceLabel').textContent=value.settings.mirror?'使用备用地址':'GitHub 直连';}
 if(value.phase==='available'&&notified!==value.latest){notified=value.latest;window.SOP?.toast('发现软件新版 '+value.latest+'，点击“软件更新”查看。');}
}
async function action(callback){try{await callback();}catch(error){$('updateMessage').textContent=error.message;}}
async function open(){await action(async()=>{const value=await api.updateInfo();render(value);$('autoUpdateCheck').checked=value.settings.autoCheck;$('updateMirror').value=value.settings.mirror;if(!dialog.open)dialog.showModal();});}
button.onclick=open;window.addEventListener('sop:show-updates',open);$('closeUpdate').onclick=()=>dialog.close();
api.onUpdate(render);api.updateInfo().then(render).catch(()=>{});
for(const [id,method]of [['checkUpdate',()=>api.checkUpdate()],['downloadUpdate',()=>api.downloadUpdate()],['cancelUpdate',()=>api.cancelUpdate()],['installUpdate',()=>api.installUpdate()],['openUpdateRelease',()=>api.openUpdateRelease()]])$(id).onclick=()=>action(method);
$('autoUpdateCheck').onchange=()=>action(async()=>render(await api.updateSettings({autoCheck:$('autoUpdateCheck').checked,mirror:state.settings.mirror})));
$('saveUpdateSettings').onclick=()=>action(async()=>render(await api.updateSettings({autoCheck:$('autoUpdateCheck').checked,mirror:$('updateMirror').value.trim()})));
})();
