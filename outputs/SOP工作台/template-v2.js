(() => {
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const changes = [['number','序号'], ['mark','标　记'], ['count','处　数'], ['document','更改文件号'], ['signature','签字（日期）']];
const historyFields = [['date','日 期'], ['number','文件归档申请单编号'], ['version','版本'], ['summary','内容概述'], ['author','制定'], ['reviewer','审核'], ['approver','批准']];
const coverFields = [['number','文件编号'], ['title','文件名称'], ['bare','裸机成品料号'], ['packed','包装成品料号'], ['version','版　　本'], ['date','生效日期']];
const coverSigners = [['approver','批准'], ['qualitySigner','质量会签'], ['productionSigner','生产会签'], ['reviewer','审核'], ['author','制定']];
const materialRows = 6, checkRows = 2, changeRows = 2, historyRows = 15;
const operationCellWidth=9608, operationWordPadding={left:121,right:117};
const dimensions = {operationWidthTwips:operationCellWidth, operationHeightTwips:8203, operationSidePaddingTwips:108,
 operationBottomGapPx:2, operationWordPadding, operationContentWidthTwips:operationCellWidth-operationWordPadding.left-operationWordPadding.right};
const operationText = Object.freeze({lineHeight:1.4, headingSize:12, headingAfter:113, paragraphAfter:30,
 fullWidthStyleId:'SopWorkbenchFullWidthTracking', fullWidthStyleName:'SOP Workbench Full Width Tracking'});
const rootStyle=document.documentElement.style;
rootStyle.setProperty('--sop-operation-line-height',operationText.lineHeight);
rootStyle.setProperty('--sop-operation-heading-size',operationText.headingSize+'pt');
rootStyle.setProperty('--sop-operation-heading-after',operationText.headingAfter/20+'pt');
rootStyle.setProperty('--sop-operation-paragraph-after',operationText.paragraphAfter/20+'pt');
rootStyle.setProperty('--sop-operation-bottom-gap',dimensions.operationBottomGapPx+'px');
const recordRows = page => page.changeRecords ?? (page.changeRecord ? [page.changeRecord] : []);
const cols = widths => '<colgroup>'+widths.map(width => '<col style="width:'+width/widths.reduce((a,b)=>a+b,0)*100+'%">').join('')+'</colgroup>';
const checkFields=[['feature','控制特性'],['standard','技术要求'],['self','生产自检'],['audit','品质抽检'],['importance','重要度'],['method','管理手段']];
const materialFields=[['name','编码＋名称'],['spec','图号或规格'],['qty','备注']];
const issue = (target,label,message=label+'超出表格范围',area=target) => ({target,label,message,area});
function limits(label,rows,count,group,fields){
 const nonempty=text=>String(text??'').trim();
 return rows.slice(count).flatMap((record,index)=>{
  if(!Object.values(record||{}).some(nonempty))return [];
  const row=index+count,[key,field]=fields.find(([key])=>nonempty(record[key]))||[];
  const name=label+'第 '+(row+1)+' 条'+(field?' '+field:'');
  const target=[group,row,key].filter(part=>part!==undefined).join('.');
  return [issue(target,name,name+'超出表格可容纳的 '+count+' 行',group)];
 });
}
const issueMarkup = finding => '<i data-print-issue="'+esc(finding.message)+'" data-print-target="'+esc(finding.target)+'" data-print-label="'+esc(finding.label)+'" data-print-issue-area="'+esc(finding.area)+'" hidden></i>';
const overflow = (label, inner, target, cls='') => '<div class="reference-field '+cls+'" data-print-box="'+esc(label)+'" data-print-target="'+esc(target)+'">'+inner+'</div>';
const value = (label, text, target, cls) => overflow(label,String(text??'').trim()?esc(text):'',target,cls);
const part = (target,label,text) => '<span data-print-part="'+esc(target)+'" data-print-label="'+esc(label)+'">'+esc(text)+'</span>';
const logo = settings => settings.showLogo!==false && settings.logo ? '<img src="'+esc(settings.logo)+'" alt="公司 Logo">' : '';
const title = meta => [['product','产品型号'],['title','文件名称']].filter(([key])=>meta[key]).map(([key,label])=>part('meta.'+key,label,meta[key])).join(' ');
const processCategories=Object.freeze({Y:'预装',Z:'组装',C:'测试',B:'包装'});
const processCategory=value=>typeof value==='string'&&Object.hasOwn(processCategories,value)?value:'';
const numberText=number=>String(number).padStart(2,'0');
function numberProcesses(pages){
 const categories=new Map(),numbers=new Map(),stations={Y:0,Z:0,C:0,B:0};
 for(const page of pages){
  const category=processCategory(page.processCategory);
  if(category&&!categories.has(page.processId))categories.set(page.processId,category);
 }
 for(const page of pages){
  if(numbers.has(page.processId))continue;
  const category=categories.get(page.processId);
  numbers.set(page.processId,{processNo:numbers.size+1,processCategory:category,stationNo:category?++stations[category]:null});
 }
 return numbers;
}
function operationLabel(page,fallback=numberText(page.processNo??page.pageNo??1)){
 const category=processCategory(page.processCategory);
 return category&&page.processNo?numberText(page.processNo)+processCategories[category]:String(page.processLabel??'').trim()||String(fallback);
}
const processLabelFontSize=page=>page.processNo>=100?8:9;
const stationLabel=page=>processCategory(page.processCategory)&&page.stationNo?page.processCategory+numberText(page.stationNo):page.station;
function inspectionLegend(settings,key){
 const [label,fallback]=key==='importance'
  ? ['重要度','  a、关键；  b、重要；   c、一般']
  : ['管理手段','a、记录表；b、控制图'];
 const setting=String(settings[key]??'').trimStart().replace(/^\d+[、.．]\s*/,'');
 return new RegExp('^'+label+'[:：]').test(setting)?setting:label+'：'+fallback;
}
const article = (kind, settings, inner, pagination='') => '<article class="paper reference-paper reference-'+kind+(kind==='operation'?' wide-paper':'')+'">'+pagination+value('保密等级',window.SOP_IMPORT.confidentialityText(settings),'settings.confidentialLevel','confidential')+inner+value('页脚版权声明',settings.copyright,'settings.copyright','copyright')+'</article>';

function materials(page){
 const rows = Array.from({length:materialRows}, (_,i) => {
  const entry=page.materials[i]||{};
  return '<tr style="height:calc(562 * var(--twip))"><td>'+(i+1)+'</td>'+materialFields.map(([key,label])=>'<td>'+value('物料 '+(i+1)+' '+label,entry[key],'material.'+i+'.'+key,'fixed-cell-content')+'</td>').join('')+'</tr>';
 });
 return '<table class="wide-materials" data-print-area="material">'+cols([419,1914,2358,609])+'<tr style="height:calc(303 * var(--twip))"><td>序号</td><td>编码+名称</td><td>图号或规格</td><td>备注</td></tr>'+rows.join('')+'</table>';
}

function checks(page){
 const rows = Array.from({length:checkRows}, (_,i) => '<tr style="height:calc(655 * var(--twip))"><td>'+(i+1)+'</td>'+checkFields.map(([key,label])=>'<td>'+value('检验 '+(i+1)+' '+label,page.checks[i]?.[key],'check.'+i+'.'+key)+'</td>').join('')+'</tr>');
 return '<table class="wide-frequency" data-print-area="check">'+cols([419,744,1860,652,625,500,500])+'<tr style="height:calc(368 * var(--twip))"><td rowspan="2">序号</td><td rowspan="2">控制<br>特性</td><td rowspan="2">技术<br>要求</td><td colspan="2">检查频次</td><td rowspan="2" class="reference-importance">重要度</td><td rowspan="2">管理<br>手段</td></tr><tr style="height:calc(366 * var(--twip))"><td>生产自检</td><td>品质抽检</td></tr>'+rows.join('')+'</table>';
}

function signoff(page, meta){
 const fields=window.SOP_IMPORT.pageSignoff(page,meta);
 const names=[['author','编制'],['reviewer','审核'],['approver','批准'],['version','版本号']];
 return '<table class="wide-sign">'+cols([1325,1325,1325,1325])+'<tr style="height:calc(644 * var(--twip))">'+names.map(([,label])=>'<th>'+label+'</th>').join('')+'</tr><tr>'+names.map(([key,label])=>'<td>'+overflow(label,[[key,label],[key+'Date',label+'日期']].filter(([field])=>fields[field]).map(([field,name])=>part('signoff.'+field,name,fields[field])).join('\n'),'signoff.'+key)+'</td>').join('')+'</tr></table>';
}

function changeTable(page){
 const records=recordRows(page);
 const rows=Array.from({length:changeRows},(_,i)=>'<tr style="height:calc(230 * var(--twip))">'+changes.map(([key,label])=>'<td>'+value('更改记录 '+(i+1)+' '+label,records[i]?.[key],'change.'+i+'.'+key)+'</td>').join('')+'</tr>');
 return '<table class="reference-changes" data-print-area="change">'+cols([600,2168,2621,2620,2849])+rows.join('')+'<tr style="height:calc(270 * var(--twip))">'+changes.map(([,label])=>'<th>'+label+'</th>').join('')+'</tr></table>';
}

function operationPaper(page, project, content, canvasOverflow=false){
 const meta=project.meta, settings=project.settings;
 const issues=[...limits('物料',page.materials,materialRows,'material',materialFields),...limits('检验',page.checks,checkRows,'check',checkFields),...limits('更改记录',recordRows(page),changeRows,'change',changes)];
 if(canvasOverflow)issues.push(issue('canvas','图文画布','画布对象超出图文区域'));
 const side=(label,text,key,foot,footText,footKey,numberSize)=>'<div class="reference-station"'+(numberSize?' style="--process-number-size:'+numberSize+'pt"':'')+'>'+value(label,text,key)+'<div class="reference-station-foot"><span>'+foot+'</span>'+value(foot,footText,footKey)+'</div></div>';
 const head='<div class="wide-head"><div class="wide-logo">'+logo(settings)+'</div><div class="wide-title">'+overflow('文件名称',title(meta),'meta.title')+'</div><div class="wide-fields"><div><span>工艺文件编号</span>'+value('工艺文件编号',meta.number,'meta.number')+'</div><div><span>工序作业名称</span>'+value('工序作业名称',page.name+(page.isContinuation?'（续）':''),'name')+'</div></div></div>';
 const labels='<div class="wide-labels"><div>工序号</div><div>工位号</div><div>工序作业内容</div><div>工装、工具、设备</div></div>';
 const work='<div class="reference-work">'+side('工序号',operationLabel(page),'processLabel','工时',page.duration,'duration',processCategory(page.processCategory)&&processLabelFontSize(page))+side('工位号',stationLabel(page),'station','人力',page.people,'people')+'<div class="op-cell" data-print-box="工序作业内容" data-print-target="operation"><div class="reference-op-content">'+content+'</div></div>'+changeTable(page)+'</div>';
 const right='<div class="wide-right">'+materials(page)+checks(page)+'<div class="reference-note">'+value('备注','备注：'+(page.notes||''),'notes')+'</div><div class="reference-legend">'+value('重要度图例',inspectionLegend(settings,'importance'),'legend.importance')+value('管理手段图例',inspectionLegend(settings,'management'),'legend.management')+'</div>'+signoff(page,meta)+'</div>';
 return article('operation',settings,issues.map(issueMarkup).join('')+head+labels+'<div class="wide-body">'+work+right+'</div>','<div class="wide-page-number">第 '+page.pageNo+' 页 共 '+page.total+' 页</div>');
}

function coverPaper(project){
 const settings=project.settings, meta=project.meta, front=project.frontContent||{};
 const fields=coverFields.map(([key,label])=>overflow(label,esc(label+'：')+(key==='title'?title(meta):esc(meta[key])),'meta.'+key));
 const signers=coverSigners.map(([key,label])=>'<div class="reference-cover-sign"><span>'+esc(label.length===2?[...label].join('　'):label)+'：</span>'+value(label,meta[key],'meta.'+key,'reference-sign-line')+'<span>签字：</span><div class="reference-sign-line"></div></div>');
 return article('cover',settings,'<div class="cover-box"><div class="cover-top"><div>'+logo(settings)+'</div><div>'+value('封面标题',front.coverHeading??'三阶文件','front.coverHeading')+'</div></div><div class="cover-content">'+value('公司名称',settings.company,'settings.company','cover-company')+fields.join('')+signers.join('')+'</div></div>');
}

function historyPaper(project){
 const rows=Array.from({length:historyRows},(_,i)=>'<tr style="height:calc('+(i===0?574:568)+' * var(--twip))">'+historyFields.map(([key,label])=>'<td>'+value('履历 '+(i+1)+' '+label,project.history[i]?.[key],'history.'+i+'.'+key)+'</td>').join('')+'</tr>');
 const extra=limits('修改履历',project.history,historyRows,'history',historyFields);
 const header='<tr style="height:calc(574 * var(--twip))">'+historyFields.map(([,label])=>'<th>'+label+'</th>').join('')+'</tr>';
 return article('history',project.settings,'<h2 class="history-title">'+value('履历标题',project.frontContent?.historyTitle??'文件修改履历','front.historyTitle')+'</h2><table class="history-table" data-print-area="history">'+cols([1554,3262,1189,4572,1113,1113,1114])+header+rows.join('')+'</table>'+extra.map(issueMarkup).join(''));
}

function flowPaper(project, chart, note, chunk){
 const title=(project.frontContent?.flowTitle??'工艺流程图')+(chunk?'（续）':'');
 const legend=note==='注：□表示一般操作，◇表示检查及测试。★代表关键工序，▲代表特殊工序'?note.replace('。★','。\n★'):note;
 return article('flow',project.settings,'<div class="flow-wrap"><div class="flow-title">'+value('流程图标题',title,'front.flowTitle')+'</div><div class="reference-chart">'+chart+'</div><div class="flow-note">'+value('流程图说明',legend,'front.flowNote')+'</div></div>');
}

function originalPaper(project, kind, content, note){
 if(kind==='flow'){
  const dom=document.createElement('template');
  dom.innerHTML=content;
  const table=dom.content.querySelector('.imported-body>.imported-table');
  if(table?.rows.length===3&&[...table.rows].every(row=>row.cells.length===1)){
   const chart=table.rows[1].cells[0],container=table.parentElement;
   table.replaceWith(...chart.childNodes);
   container.dataset.printBox='原稿流程图';
   container.dataset.printTarget='original';
   return flowPaper(project,container.outerHTML,note,0);
  }
 }
 return article(kind,project.settings,'<div class="original-front" data-print-box="导入原稿" data-print-target="original">'+content+'</div>');
}

function contentBounds(node){
 const range=document.createRange();
 range.selectNodeContents(node);
 return range.getBoundingClientRect();
}
const outside=(rect,bounds)=>rect.width>0&&(rect.top<bounds.top-1||rect.bottom>bounds.bottom+1||rect.left<bounds.left-1||rect.right>bounds.right+1);
function printIssues(paper){
 const issues=new Map();
 for(const node of paper.querySelectorAll('[data-print-issue]')){
  const {printTarget,printLabel,printIssue,printIssueArea}=node.dataset;
  issues.set(printTarget,issue(printTarget,printLabel,printIssue,printIssueArea));
 }
 for(const box of paper.querySelectorAll('[data-print-box]')){
  const bounds=box.getBoundingClientRect();
  if(box.scrollHeight<=box.clientHeight+2&&box.scrollWidth<=box.clientWidth+2&&!outside(contentBounds(box),bounds))continue;
  const {printTarget,printBox}=box.dataset;
  const parts=[...box.querySelectorAll('[data-print-part]')].filter(node=>outside(contentBounds(node),bounds));
  if(parts.length){
   for(const item of parts){
    const {printPart,printLabel}=item.dataset;
    const label=printTarget==='operation'?printBox+' · '+printLabel:printLabel;
    if(!issues.has(printPart))issues.set(printPart,issue(printPart,label,undefined,printTarget));
   }
  }else if(!issues.has(printTarget))issues.set(printTarget,issue(printTarget,printBox));
  box.classList.add('reference-overflow');
 }
 return [...issues.values()];
}

window.SOP_TEMPLATE={operationPaper,operationLabel,processLabelFontSize,stationLabel,processCategory,processCategories,numberProcesses,inspectionLegend,coverPaper,historyPaper,flowPaper,originalPaper,printIssues,dimensions,operationText,changes,historyFields,coverFields,coverSigners,recordRows,materialRows,checkRows,changeRows,historyRows};
})();
