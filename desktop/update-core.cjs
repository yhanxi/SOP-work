'use strict';
const crypto=require('node:crypto');
const repo='yhanxi/SOP-work';
const releaseURL='https://github.com/'+repo+'/releases/latest';
function version(value){if(!/^\d+\.\d+\.\d+$/.test(value))throw Error('版本号无效');return value.split('.').map(Number);}
function newer(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function httpsURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('备用地址必须是不含账号、参数的 HTTPS 目录地址。');return url.href.replace(/\/$/,'');}
function verify(envelope,key){
 if(!envelope||typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.payload.length>20000)throw Error('更新清单无效');
 if(!crypto.verify(null,Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')))throw Error('更新签名校验失败，已拒绝更新。');
 const p=JSON.parse(envelope.payload);version(p.version);
 if(p.schema!=='sop-update/v1'||p.repo!==repo||p.platform!=='win32'||p.arch!=='x64'||p.asset!=='SOPStudio-'+p.version+'-app.asar'||!/^\d+\.\d+\.\d+$/.test(p.electron)||!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isInteger(p.bytes)||p.bytes<1000||p.bytes>20*1024*1024)throw Error('更新清单内容不受支持');
 return p;
}
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
function verifyPackage(bytes,manifest){if(bytes.length!==manifest.bytes||digest(bytes)!==manifest.sha256)throw Error('更新包大小或 SHA256 校验失败，原软件未改动。');
 if(bytes.length<16)throw Error('程序包无效');const headerSize=bytes.readUInt32LE(4),jsonSize=bytes.readUInt32LE(12);if(jsonSize>bytes.length-16)throw Error('程序包结构无效');
 const node=JSON.parse(bytes.subarray(16,16+jsonSize).toString()).files['package.json'];if(!node||!/^\d+$/.test(node.offset))throw Error('程序包缺少版本信息');
 const start=8+headerSize+Number(node.offset),p=JSON.parse(bytes.subarray(start,start+node.size).toString());if(p.version!==manifest.version||p.name!=='sop-studio-desktop')throw Error('程序包版本不匹配');
}
module.exports={repo,releaseURL,newer,httpsURL,verify,digest,verifyPackage};
