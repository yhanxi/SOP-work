'use strict';
// Usage: node desktop/make-update.cjs APP_ASAR PRIVATE_PEM OUTPUT_DIRECTORY [NOTES_FILE]
// Keep PRIVATE_PEM outside the repository. Back it up privately for future releases.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyPackage}=require('./update-core.cjs'),config=require('./package.json');
const [archive,key,output,notesFile]=process.argv.slice(2);if(!archive||!key||!output)throw Error('需要指定 ASAR、私钥和输出目录');
const bytes=fs.readFileSync(archive),version=config.version;
const payload={schema:'sop-update/v1',repo:'yhanxi/SOP-work',version,electron:config.devDependencies.electron,platform:'win32',arch:'x64',asset:'SOPStudio-'+version+'-app.asar',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),notes:notesFile?fs.readFileSync(notesFile,'utf8').slice(0,2000):'SOP 工作台 '+version+' 版本更新。'};
verifyPackage(bytes,payload);
const privateKey=fs.readFileSync(key);if(!crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}).equals(crypto.createPublicKey(fs.readFileSync(path.join(__dirname,'update-public.pem'))).export({type:'spki',format:'der'})))throw Error('签名私钥与软件内置公钥不匹配');
const text=JSON.stringify(payload),signature=crypto.sign(null,Buffer.from(text),privateKey).toString('base64');
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,payload.asset),bytes);fs.writeFileSync(path.join(output,'SOP-update.json'),JSON.stringify({payload:text,signature},null,2));fs.copyFileSync(path.join(output,'SOP-update.json'),path.join(output,'latest.json'));
console.log('Signed update assets generated for '+version+' ('+bytes.length+' bytes). Private key was not copied.');
