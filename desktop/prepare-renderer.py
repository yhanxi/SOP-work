from pathlib import Path
root=Path(__file__).resolve().parent
source=root.parent/'outputs'/'SOP工作台';target=root/'renderer'
for name in ['index.html','style.css','workspace-controls.css','app.js','desktop-updates.js','project-storage.js','native-import.js','template-v2.js','color-picker.js','object-workspace.js','native-shapes.js','word.js','vendor/jszip.min.js','vendor/JSZip-LICENSE.md']:
    file=target/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes((source/name).read_bytes())
(target/'assets.js').write_bytes((root/'blank-assets.js').read_bytes())
print('Staged generic offline renderer; no reference SOP or private project included.')
