"""Manual Electron + NSIS build with a generic source allowlist and public runtime.

Usage: python desktop/build-windows.py
The official Electron ZIP and SHASUMS256.txt are kept in work/. Build tools are
only needed on the developer's computer. The installer is fully offline.
"""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib,json,subprocess,sys

root=Path(__file__).resolve().parent
base=root.parent
config=json.loads((root/'package.json').read_text(encoding='utf-8'))
version=config['version'];eversion=config['devDependencies']['electron']
archive=base/'work'/f'electron-public-v{eversion}-win32-x64.zip'
checksums=(base/'work'/'electron-public-SHASUMS256.txt').read_text()
expected=next(line.split()[0] for line in checksums.splitlines() if line.split()[-1].lstrip('*')==f'electron-v{eversion}-win32-x64.zip')
actual=hashlib.sha256(archive.read_bytes()).hexdigest()
assert actual==expected,'Official Electron ZIP checksum mismatch'
destination=base/'outputs'/'软件安装包'
stage=destination/'SOPStudio-Windows-x64'
stage.mkdir(parents=True,exist_ok=True)
with ZipFile(archive) as z:
    for member in z.infolist():
        if member.is_dir():continue
        if member.filename=='resources/default_app.asar':continue
        if member.filename.startswith('locales/') and member.filename not in ['locales/zh-CN.pak','locales/en-US.pak']:continue
        name='SOPStudio.exe' if member.filename=='electron.exe' else member.filename
        target=stage/name
        assert target.resolve().is_relative_to(stage.resolve())
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(member))
(stage/'SOPStudio.ico').write_bytes((root/'build/icon.ico').read_bytes())
subprocess.run([sys.executable,str(root/'package-app.py'),str(stage/'resources/app.asar')],check=True)

def nsis(text):return str(text).replace('$','$$').replace('"','$\\"')
files=sorted(f for f in stage.rglob('*') if f.is_file())
dirs=sorted((d for d in stage.rglob('*') if d.is_dir()),key=lambda p:len(p.parts),reverse=True)
compiler=next((base/'work'/'builder-cache').glob('nsis-*/nsis-*/Bin/makensis.exe'))
nsisroot=compiler.parent.parent
installer=destination/f'SOPStudio-Setup-{version}-x64.exe'
script=[
 'Unicode true','RequestExecutionLevel user','SetCompressor /SOLID lzma',
 'Name "SOP 工作台"',f'OutFile "{nsis(installer)}"',
 'InstallDir "$LOCALAPPDATA\\Programs\\SOPStudio"',
 'InstallDirRegKey HKCU "Software\\SOPStudio" "InstallDir"',
 f'Icon "{nsis(root/"build/icon.ico")}"',f'UninstallIcon "{nsis(root/"build/icon.ico")}"',
 f'VIProductVersion "{version}.0"','VIAddVersionKey /LANG=2052 "ProductName" "SOP 工作台"',
 f'VIAddVersionKey /LANG=2052 "FileVersion" "{version}"',
 'VIAddVersionKey /LANG=2052 "FileDescription" "SOP 工作台 安装程序"',
 'VIAddVersionKey /LANG=2052 "LegalCopyright" ""',
 f'LoadLanguageFile "{nsis(nsisroot/"Contrib/Language files/SimpChinese.nlf")}"',
 'Caption "SOP 工作台 安装向导"','BrandingText "SOP 工作台"',
 'Page directory','Page instfiles','UninstPage uninstConfirm','UninstPage instfiles',
 'Section "SOP 工作台"','SetShellVarContext current','SetOutPath "$INSTDIR"',
 f'File /r "{nsis(stage)}\\*"',
 'WriteRegStr HKCU "Software\\SOPStudio" "InstallDir" "$INSTDIR"',
 'WriteUninstaller "$INSTDIR\\Uninstall.exe"',
 'CreateShortcut "$DESKTOP\\SOP工作台.lnk" "$INSTDIR\\SOPStudio.exe" "" "$INSTDIR\\SOPStudio.ico"',
 'CreateDirectory "$SMPROGRAMS\\SOP工作台"',
 'CreateShortcut "$SMPROGRAMS\\SOP工作台\\SOP工作台.lnk" "$INSTDIR\\SOPStudio.exe" "" "$INSTDIR\\SOPStudio.ico"',
 'CreateShortcut "$SMPROGRAMS\\SOP工作台\\卸载.lnk" "$INSTDIR\\Uninstall.exe"',
 'WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "DisplayName" "SOP 工作台"',
 f'WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "DisplayVersion" "{version}"',
 'WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "UninstallString" \'$\\"$INSTDIR\\Uninstall.exe$\\"\'',
 'WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "DisplayIcon" "$INSTDIR\\SOPStudio.ico"',
 'WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "NoModify" 1',
 'WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio" "NoRepair" 1',
 'IfSilent done','Exec \'"$INSTDIR\\SOPStudio.exe"\'','done:','SectionEnd',
 'Section "Uninstall"','SetShellVarContext current',
 'Delete "$DESKTOP\\SOP工作台.lnk"',
 'Delete "$SMPROGRAMS\\SOP工作台\\SOP工作台.lnk"','Delete "$SMPROGRAMS\\SOP工作台\\卸载.lnk"','RMDir "$SMPROGRAMS\\SOP工作台"'
]
script += [f'Delete "$INSTDIR\\{nsis(f.relative_to(stage))}"' for f in files]
script += [f'RMDir "$INSTDIR\\{nsis(d.relative_to(stage))}"' for d in dirs]
script += ['Delete "$INSTDIR\\Uninstall.exe"','RMDir "$INSTDIR"','DeleteRegKey HKCU "Software\\SOPStudio"','DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SOPStudio"','SectionEnd']
scriptfile=base/'work'/'SOPStudio-installer.nsi'
scriptfile.write_text('\n'.join(script),encoding='utf-8-sig')
log=subprocess.run([str(compiler),'/V2',str(scriptfile)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(base/'work'/'desktop-installer-build.log').write_bytes(log.stdout)
if log.returncode:
    print(log.stdout.decode('utf-8',errors='replace'));raise SystemExit(log.returncode)
portable=destination/f'SOPStudio-{version}-x64.zip'
with ZipFile(portable,'w',ZIP_DEFLATED,compresslevel=6) as z:
    for file in files:z.write(file,Path('SOPStudio')/file.relative_to(stage))
manifest={'version':version,'electron':eversion,'electronZipSHA256':actual,'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [installer,portable]}}
(destination/'SHA256.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest,indent=2))
