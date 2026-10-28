'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const bundled=path.join(process.env.USERPROFILE||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python=process.env.SOP_PYTHON||(fs.existsSync(bundled)?bundled:'python');
const result=spawnSync(python,[path.join(__dirname,'prepare-renderer.py')],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status||0;
