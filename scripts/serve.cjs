'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../outputs/SOP工作台');
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const open=args.includes('--open'),host=open?'127.0.0.1':option('--host',process.env.HOST||'127.0.0.1');
const port=Number(option('--port',open?4173:process.env.PORT||4173));
const localHosts=new Set(['127.0.0.1','localhost','::1']),loopback=localHosts.has(host);
const identityPath='/__sop_workbench',identity=createHash('sha256').update(root).digest('hex');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(loopback&&pathname===identityPath){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end(req.method==='HEAD'?undefined:identity);}
  if(!file.startsWith(root+path.sep)||!types[path.extname(file)]){res.writeHead(403);return res.end('Forbidden');}
  const privateBranding=path.relative(root,file).toLowerCase()==='reference-local.js',emptyBranding=Buffer.from('// Generic template.\n');
  const content=privateBranding?loopback?await fs.readFile(file).catch(error=>{if(error.code!=='ENOENT')throw error;return emptyBranding;}):emptyBranding:await fs.readFile(file);
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"});
  res.end(req.method==='HEAD'?undefined:content);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:400);res.end('Not found');}
});
const urlAt=number=>`http://${host.includes(':')?'['+host+']':host}:${number}`;
function openBrowser(url){
 const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';
 const browser=spawn(command,[url],{stdio:'ignore',windowsHide:true});
 browser.on('error',error=>console.error('请在浏览器打开 '+url+'。'+error.message));
 browser.unref();
}
let nextPort=port;
server.on('listening',()=>{
 const url=urlAt(server.address().port);
 console.log(JSON.stringify({url}));
 if(open)openBrowser(url);
});
server.on('error',async error=>{
 if(open&&error.code==='EADDRINUSE'){
  const existing=urlAt(nextPort);
  try{
   const response=await fetch(existing+identityPath,{signal:AbortSignal.timeout(800),redirect:'error'});
   if(response.ok&&await response.text()===identity){openBrowser(existing);return;}
  }catch{}
  if(nextPort<Math.min(port+10,65535)){server.listen(++nextPort,host);return;}
 }
 console.error(error.message);process.exitCode=1;
});
server.listen(nextPort,host);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
