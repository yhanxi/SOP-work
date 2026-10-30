"""Create Electron's standard ASAR from the generic, allowlisted application sources.

This build step needs Python only on the build machine, never on users' PCs.
It does not read or distribute the reference SOP or the owner's sample project.
"""
from pathlib import Path
import hashlib,json,struct,sys

root=Path(__file__).resolve().parent
out=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'outputs'/'软件安装包'/'SOPStudio-Windows-x64'/'resources'/'app.asar'
source=root.parent/'outputs'/'SOP工作台'
files={
 'package.json':json.dumps({k:v for k,v in json.loads((root/'package.json').read_text(encoding='utf-8')).items() if k in ['name','version','description','author','license','main']},ensure_ascii=False).encode(),
 'main.cjs':(root/'main.cjs').read_bytes(),
 'project-files.cjs':(root/'project-files.cjs').read_bytes(),
 'preload.cjs':(root/'preload.cjs').read_bytes(),
 'build/icon.ico':(root/'build/icon.ico').read_bytes(),
 'renderer/assets.js':(root/'blank-assets.js').read_bytes()
}
for name in ['index.html','style.css','app.js','project-storage.js','native-import.js','template-v2.js','object-workspace.js','native-shapes.js','word.js','vendor/jszip.min.js','vendor/JSZip-LICENSE.md']:
    files['renderer/'+name]=(source/name).read_bytes()
header={'files':{}};offset=0
for name,data in sorted(files.items()):
    node=header['files'];bits=name.split('/')
    for part in bits[:-1]:node=node.setdefault(part,{'files':{}})['files']
    node[bits[-1]]={'size':len(data),'offset':str(offset)}
    offset+=len(data)
encoded=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode('utf-8')
payload=struct.pack('<I',len(encoded))+encoded
payload+=b'\0'*((-len(payload))%4)
pickle=struct.pack('<I',len(payload))+payload
archive=struct.pack('<II',4,len(pickle))+pickle+b''.join(v for _,v in sorted(files.items()))
out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(archive)
manifest={n:{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in files.items()}
(root.parent/'work').mkdir(exist_ok=True)
(root.parent/'work'/'desktop-app-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Generic ASAR created:',len(archive),'bytes;',len(files),'allowlisted files')
