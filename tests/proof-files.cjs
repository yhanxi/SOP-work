'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {createProofFiles}=require('../desktop/proof-files.cjs');

const exists=async file=>fs.access(file).then(()=>true,()=>false);
async function until(predicate){
 for(let i=0;i<100;i++){if(await predicate())return;await delay(20);}
 assert.fail('Timed out checking the proof file lifecycle');
}

(async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'sop-proofs-test-'));
 const root=path.join(workspace,'proofs'),opened=[],attempts=[];
 const bytes=Uint8Array.of(0x50,0x4b,3,4,1);
 const request={bytes,name:'../../工序01：检查.docx'};
 const openPath=file=>{opened.push(file);return '';};
 const drop=async(dir,files)=>{
  for(const {name,stale}of files){
   attempts.push({name,stale});
   for(const suffix of ['','.sop-opened','.sop-proof']){
    await fs.unlink(path.join(dir,name+suffix)).catch(error=>{if(error.code!=='ENOENT')throw error;});
   }
  }
 };
 const create=()=>createProofFiles({root,openPath,drop,poll:20,launchGrace:180,staleAfter:30000});
 const first=create();
 let second;
 try{
  assert((await first.open({bytes:'not-typed',name:'文档'})).error);
  assert(!await exists(root));
  assert.deepEqual(await first.open(request),{ok:true});
  assert.deepEqual(await first.open(request),{ok:true});
  const [doc,unseen]=opened,docName=path.basename(doc);
  assert.notEqual(doc,unseen);
  assert.equal(path.dirname(doc),root);
  assert(docName.includes('工序01-检查'));

  const unrelated=path.join(root,'SOP校样-00000000-0000-4000-8000-000000000001.docx');
  const saved=path.join(workspace,'saved.docx');
  await fs.copyFile(doc,unrelated);
  await fs.copyFile(doc,saved);
  await delay(60);
  assert.equal(attempts.length,0,'An asynchronous launch may still open the original proof.');
  const owner=path.join(root,'~$'+docName.slice(2));
  await fs.writeFile(owner,'');
  await until(()=>exists(doc+'.sop-opened'));
  first.stop();

  second=create();
  second.start();
  await delay(200);
  assert(await exists(doc),'An open document must survive a workspace restart.');
  assert.equal(attempts.length,0);
  await fs.unlink(owner);
  await until(async()=>!await exists(doc)&&!await exists(doc+'.sop-proof')&&!await exists(doc+'.sop-opened'));
  assert(await exists(unseen),'A file never observed open is held until a conservative stale check.');
  assert(await exists(unrelated));
  assert.deepEqual(await fs.readFile(saved),Buffer.from(bytes));

  const target=path.join(workspace,'external'),alias=path.join(workspace,'junction');
  await fs.mkdir(target);
  await fs.symlink(target,alias,process.platform==='win32'?'junction':'dir');
  const unsafe=createProofFiles({root:alias,openPath,drop});
  try{
   assert((await unsafe.open(request)).error);
   assert.deepEqual(await fs.readdir(target),[]);
  }finally{unsafe.stop();}
  console.log('PASS: unique safe proof files, asynchronous launch, open-file restart, closed-file cleanup and unrelated file preservation');
 }finally{
  first.stop();second?.stop();
  await fs.rm(workspace,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
