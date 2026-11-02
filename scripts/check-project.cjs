'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=path.join(root,'outputs/SOP工作台');
const files=['desktop-updates.js','project-storage.js','app.js','word.js','native-import.js','template-v2.js','color-picker.js','object-workspace.js','native-shapes.js','assets.js','vendor/jszip.min.js'];
for(const file of [...files.map(f=>path.join(source,f)),...['desktop/updater.cjs','desktop/update-core.cjs','desktop/update-helper.cjs','desktop/make-update.cjs','desktop/project-files.cjs','desktop/main.cjs','desktop/preload.cjs','desktop/prepare.cjs','scripts/serve.cjs','scripts/check-project.cjs','tests/canvas-snapping.cjs','tests/canvas-snapping-browser.cjs','tests/project-files.cjs','tests/project-storage-browser.cjs','tests/browser-smoke.cjs','tests/object-model.cjs'].map(f=>path.join(root,f))]){
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
}
require('../tests/object-model.cjs');
require('../tests/canvas-controls.cjs');
require('../tests/canvas-snapping.cjs');
require('../tests/canvas-connections.cjs');
const data=fs.readFileSync(path.join(source,'assets.js'),'utf8'),assets=JSON.parse(data.slice(data.indexOf('=')+1).replace(/;\s*$/,''));
assert.equal(assets.seed.schema,'sop-studio/v1');assert.equal(assets.seed.settings.company,'');assert.equal(assets.seed.settings.logo,'');assert.equal(assets.seed.pages.length,1);assert.equal(assets.seed.pages[0].photos.length,0);
assert.equal(fs.readFileSync(path.join(root,'desktop/blank-assets.js'),'utf8'),data,'Web and desktop generic assets must match');
const JSZip=require(path.join(source,'vendor/jszip.min.js'));
(async()=>{
 await require('../tests/project-files.cjs');
 await require('../tests/updater.cjs');
 const zip=await JSZip.loadAsync(assets.template,{base64:true});
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.xml'))){
  const text=await zip.file(name).async('string');assert(!/蓝方|深圳|LENFOR|LF-MEGF|LF-MERG/i.test(text),'Private reference data in '+name);
 }
 assert(!Object.keys(zip.files).some(n=>n.startsWith('customXml/')),'Reference custom XML must not be shipped');
 const html=fs.readFileSync(path.join(source,'index.html'),'utf8');
 assert(html.indexOf('src="native-import.js"')<html.indexOf('src="app.js"'),'Native import must load before restoring saved projects');
 const packager=fs.readFileSync(path.join(root,'desktop/package-app.py'),'utf8');for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){const reference=match[1];if(!reference.startsWith('data:'))assert((packager.includes("'"+reference+"'")||packager.includes("'renderer/"+reference+"'")),'Desktop packager omits '+reference);}
 for(const name of files)assert(html.includes(`src="${name}"`),'Missing renderer script '+name);
 assert(!fs.existsSync(path.join(source,'原稿整理项目.sop.json')),'Private sample must remain outside the repository');
 console.log('PASS: source syntax, generic assets, template privacy and renderer wiring');
})().catch(error=>{console.error(error);process.exitCode=1;});
