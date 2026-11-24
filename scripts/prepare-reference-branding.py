"""Extract local-only branding from the landscape SOP template."""

import argparse
import base64
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


WORD = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parents[1]


def text(node):
    return ''.join(t.text or '' for t in node.iter(WORD + 't'))


def extract_branding(source):
    with ZipFile(source) as archive:
        body = ET.fromstring(archive.read('word/document.xml')).find(WORD + 'body')
        cover, _, flow, _ = body.findall(WORD + 'tbl')
        confidential = text(ET.fromstring(archive.read('word/header1.xml')))
        level = re.search(r'☑(绝密|机密|一般)', confidential)
        return {
            'company': text(list(cover.iter(WORD + 'p'))[2]),
            'logo': 'data:image/png;base64,' + base64.b64encode(archive.read('word/media/image1.png')).decode('ascii'),
            'confidential': confidential,
            'confidentialLevel': level[1] if level else '',
            'copyright': text(ET.fromstring(archive.read('word/footer1.xml'))),
            'flowNote': text(flow.findall(WORD + 'tr')[-1]),
        }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('template', type=Path)
    options = parser.parse_args()
    target = ROOT / 'outputs' / 'SOP工作台' / 'reference-local.js'
    settings = {'defaults': extract_branding(options.template)}
    target.write_text('window.SOP_REFERENCE = ' + json.dumps(settings, ensure_ascii=False) + ';\n', encoding='utf-8')
    print('Created the ignored local branding asset.')
