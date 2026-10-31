'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('../desktop/update-core.cjs'),{createUpdater}=require('../desktop/updater.cjs'),{apply}=require('../desktop/update-helper.cjs');
module.exports=(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sop-updater-'));
 const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'});
 function archive(version){const data=Buffer.from(JSON.stringify({name:'sop-studio-desktop',version}));const h=Buffer.from(JSON.stringify({files:{'package.json':{offset:'0',size:data.length}}}));const b=Buffer.alloc(4096);b.writeUInt32LE(h.length+8,4);b.writeUInt32LE(h.length,12);h.copy(b,16);data.copy(b,16+h.length);return b;}
 const good=archive('0.4.1'),payload={schema:'sop-update/v1',repo:core.repo,version:'0.4.1',electron:'45.1.0',platform:'win32',arch:'x64',asset:'SOPStudio-0.4.1-app.asar',bytes:good.length,sha256:core.digest(good)};
 const sign=p=>{const text=JSON.stringify(p);return {payload:text,signature:crypto.sign(null,Buffer.from(text),keys.privateKey).toString('base64')};};
 const envelope=sign(payload);let bad=false,offline=false,slow=false,mirrorFail=false,requests=[];
 const net={async fetch(url,{signal}={}){requests.push(url);if(offline||mirrorFail&&url.includes('mirror.example'))throw Error('offline');if(slow&&url.endsWith('.asar'))return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('canceled'),{name:'AbortError'})),{once:true}));
  let body;if(url.includes('api.github.com'))body=JSON.stringify({assets:[{name:'SOP-update.json',browser_download_url:'https://github.com/'+core.repo+'/releases/download/v0.4.1/SOP-update.json'}]});else if(url.endsWith('.asar'))body=bad?Buffer.alloc(good.length):good;else body=JSON.stringify(envelope);
  return new Response(body,{status:200});}};
 const app={getPath:()=>dir,getVersion:()=> '0.4.0',isPackaged:false};const updater=createUpdater({app,net,publicKey,testMode:true,runtime:'45.1.0',onState:()=>{}});
 try{
  assert(core.newer('0.10.0','0.9.9'));assert(!core.newer('0.4.0','0.4.0'));assert.throws(()=>core.newer('v1','0.4.0'));assert.throws(()=>core.httpsURL('http://bad'));
  assert.throws(()=>core.verify({...envelope,payload:JSON.stringify({...payload,version:'9.9.9'})},publicKey));core.verifyPackage(good,payload);assert.throws(()=>core.verifyPackage(Buffer.alloc(good.length),payload));
  assert.equal((await updater.check()).phase,'available');bad=true;assert.equal((await updater.download()).phase,'error');bad=false;assert.equal((await updater.download()).phase,'ready');await assert.rejects(()=>updater.prepareInstall());
  await updater.configure({autoCheck:false,mirror:'https://mirror.example/sop/'});assert.equal((await updater.info()).settings.autoCheck,false);mirrorFail=true;assert.equal((await updater.check()).phase,'available');assert(requests.some(url=>url.includes('api.github.com')),'Mirror failure must fall back to GitHub');
  slow=true;const pending=updater.download();await new Promise(resolve=>setTimeout(resolve,10));updater.cancel();await pending;assert.equal((await updater.info()).phase,'canceled');slow=false;assert.equal((await updater.download()).phase,'ready','Canceled downloads must support retry');offline=true;assert.equal((await updater.check()).phase,'error');offline=false;
  const again=createUpdater({app,net,publicKey,testMode:true,runtime:'45.1.0',onState:()=>{}});assert.equal((await again.info()).settings.mirror,'https://mirror.example/sop');
  let noticed;const notification=new Promise(resolve=>noticed=resolve);
  const automatic=createUpdater({app,net,publicKey,testMode:false,runtime:'45.1.0',onState:value=>{if(value.phase==='available')noticed();}});await automatic.configure({autoCheck:true,mirror:''});await automatic.start();
  let timeout;try{await Promise.race([notification,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Automatic startup check did not run')),12000))]);}finally{clearTimeout(timeout);}await automatic.configure({autoCheck:false,mirror:''});
  // Atomic installer touches only the test resources directory; rollback backup is retained.
  const exe=path.join(dir,'runtime','SOPStudio.exe'),target=path.join(dir,'runtime/resources/app.asar'),staged=path.join(dir,'staged.asar'),log=path.join(dir,'result.json'),old=archive('0.4.0');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,old);await fs.writeFile(staged,good);
  const config={exe,staged,manifest:envelope,key:publicKey,oldHash:core.digest(old),log,restart:false};await apply(config);assert.deepEqual(await fs.readFile(target),good);assert.deepEqual(await fs.readFile(target+'.previous'),old);
  await fs.writeFile(target,old);await fs.writeFile(staged,Buffer.alloc(good.length));await assert.rejects(()=>apply(config));assert.deepEqual(await fs.readFile(target),old,'Corrupt payload must preserve installed app');
  console.log('PASS: signed updates, tamper refusal, package integrity, version ordering, mirror fallback, settings persistence, automatic startup check, cancellation, offline editing and atomic replacement backup');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
})();
if(require.main===module)module.exports.catch(error=>{console.error(error);process.exitCode=1;});
