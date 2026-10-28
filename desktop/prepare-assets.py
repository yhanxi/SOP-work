"""Prepare the generic distribution assets; retain the owner's browser sample separately."""
from pathlib import Path
from lxml import etree as E
from PIL import Image,ImageDraw,ImageFont
from zipfile import ZipFile,ZIP_DEFLATED
import base64,io,json

root=Path(__file__).resolve().parent
source=root.parent/'outputs'/'SOP工作台'
build=root/'build';build.mkdir(exist_ok=True)
icon=Image.new('RGBA',(512,512),(0,0,0,0));g=ImageDraw.Draw(icon)
g.rounded_rectangle((14,14,498,498),radius=105,fill='#126771')
g.rounded_rectangle((126,83,386,430),radius=22,fill='white')
g.line((174,165,333,165),fill='#126771',width=15)
for y in (230,290,350):
    g.rounded_rectangle((170,y-10,190,y+10),radius=5,fill='#e9a841')
    g.line((219,y,337,y),fill='#58767b',width=12)
icon.save(build/'icon.png');icon.save(build/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
buf=io.BytesIO();icon.save(buf,format='PNG');neutral=buf.getvalue()
assets=json.loads((source/'assets.js').read_text(encoding='utf-8').split('=',1)[1].rstrip(';\n'))
with ZipFile(io.BytesIO(base64.b64decode(assets['template']))) as z:parts={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
N={'w':W,'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
doc=E.fromstring(parts['word/document.xml']);tables=doc.findall('w:body/w:tbl',N)
def clear_cell(c):
    for child in list(c):
        if child.tag!='{'+W+'}tcPr':c.remove(child)
    E.SubElement(c,'{'+W+'}p')
company=tables[0].findall('.//w:p',N)[2]
for child in list(company):
    if child.tag!='{'+W+'}pPr':company.remove(child)
# Remove the reference's process flow shapes and their original process names.
for row in tables[2].findall('w:tr',N)[1:]:
    for c in row.findall('w:tc',N):clear_cell(c)
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
parts['word/media/image1.png']=neutral
for name in list(parts):
    if name.startswith('word/media/') and name!='word/media/image1.png':parts[name]=neutral
    if name.startswith('customXml/') or name.startswith('docProps/'):parts.pop(name)
parts['docProps/core.xml']=b'<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>SOP</dc:title></cp:coreProperties>'
parts['docProps/app.xml']=b'<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SOP Studio</Application><Pages>1</Pages><Company/></Properties>'
for name in ['_rels/.rels','word/_rels/document.xml.rels','[Content_Types].xml']:
    d=E.fromstring(parts[name])
    for child in list(d):
        target=child.get('Target','');part=child.get('PartName','');kind=child.get('Type','')
        if 'customXml' in target or 'customXml' in part or kind.endswith('/customXml') or 'docProps/custom' in target or 'docProps/custom' in part:d.remove(child)
    parts[name]=E.tostring(d,encoding='UTF-8',xml_declaration=True,standalone=True)
for name in ['word/header1.xml','word/footer1.xml']:
    d=E.fromstring(parts[name])
    for t in d.findall('.//w:t',N):t.text=''
    parts[name]=E.tostring(d,encoding='UTF-8',xml_declaration=True,standalone=True)
for name,data in parts.items():
    if name.endswith('.xml'):
        text=data.decode('utf-8')
        for private in ['蓝方','深圳','LENFOR','LF-MEGF','LF-MERG']:
            assert private not in text,(name,private)
out=io.BytesIO()
with ZipFile(out,'w',ZIP_DEFLATED) as z:
    for name,data in parts.items():z.writestr(name,data)
seed={
 'schema':'sop-studio/v1',
 'meta':{'product':'','title':'制造作业指导书','number':'','bare':'','packed':'','version':'A0','date':'','author':'','reviewer':'','approver':'','qualitySigner':'','productionSigner':''},
 'settings':{'company':'','logo':'','showLogo':True,'confidential':'','copyright':'','importance':'1、重要度：a、关键；b、重要；c、一般','management':'2、管理手段：a、记录表；b、控制图','standardText':'','cover':True,'history':True,'flow':True,'numbering':'body'},
 'history':[],
 'pages':[{'id':'first-page','processId':'first-process','name':'新工序','station':'','duration':'','people':'','steps':'','requirements':'','notes':'','materials':[],'checks':[],'photos':[],'fixed':[]}]
}
generic={'template':base64.b64encode(out.getvalue()).decode(),'logo':'','appLogo':'data:image/png;base64,'+base64.b64encode(neutral).decode(),'seed':seed}
(root/'blank-assets.js').write_text('window.SOP_ASSETS='+json.dumps(generic,ensure_ascii=False)+';',encoding='utf-8')
print('Generic assets prepared; original company data and photos excluded.')
