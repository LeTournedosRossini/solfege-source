#!/usr/bin/env python3
"""Génère src/model/templates.json (modèles de partition de MuseScore 4.7.5) depuis share/templates (categories.json + fichiers .mscx).
Usage : python3 -I tools/extract-templates.py /chemin/vers/share/templates /chemin/vers/share/locale
Par modèle : id, catégorie, titre (anglais), ordre de partition, parties { instrument, portées { type, clé } } — rien des mesures (un modèle
de Scorsaire ne règle que les pistes). Les titres et catégories traduits viennent de `instruments_<lang>.ts` (contextes project/template et
project/templatecategory). Les `.mscx` ne sont pas copiés dans le dépôt."""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'model', 'templates.json')
LANGS = ['fr']


def staff_type(name):
    if name.startswith('tab'):
        return {'type': 'tab'}
    if name.startswith('perc'):
        lines = {'perc1Line': 1, 'perc2Line': 2, 'perc3Line': 3, 'perc5Line': 5}.get(name)
        return {'type': 'percussion', **({'lineCount': lines} if lines else {})}
    return {'type': 'score'}


def translations(locale, lang):
    root = ET.parse(os.path.join(locale, f'instruments_{lang}.ts')).getroot()
    out = {'templates': {}, 'categories': {}}
    for ctx in root.findall('context'):
        key = {'project/template': 'templates', 'project/templatecategory': 'categories'}.get(ctx.findtext('name'))
        if not key:
            continue
        for msg in ctx.findall('message'):
            tr = msg.find('translation')
            text = (tr.text or '').strip() if tr is not None else ''
            src = msg.findtext('source') or ''
            if text and text != src and tr.get('type') not in ('unfinished', 'obsolete'):
                out[key][src] = text
    return out


def main():
    root_dir, locale = sys.argv[1], sys.argv[2]
    cats = json.load(open(os.path.join(root_dir, 'categories.json'), encoding='utf-8'))
    out_cats, templates = [], []
    for ci, c in enumerate(cats):
        cid = re.sub(r'[^a-z0-9]+', '-', c['title'].lower()).strip('-')
        out_cats.append({'id': cid, 'title': c['title']})
        for f in c['files']:
            r = ET.parse(os.path.join(root_dir, f)).getroot()
            sc = r.find('Score')
            order = sc.find('Order')
            parts = []
            for p in sc.findall('Part'):
                ins = p.find('Instrument')
                staves = []
                for st in p.findall('Staff'):
                    spec = staff_type(st.findtext('StaffType/name') or 'stdNormal')
                    clef = st.findtext('defaultClef')
                    if clef:
                        spec['clef'] = clef
                    staves.append(spec)
                parts.append({'instrument': ins.get('id'), 'name': p.findtext('trackName'), 'staves': staves})
            title = os.path.basename(f)[:-5]
            title = re.sub(r'^\d+-', '', title).replace('_', ' ')
            tid = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
            # the title shown by MuseScore is in the file's own <name> of the first <Order>? no: the file name is the template title
            templates.append({'id': tid, 'category': cid, 'title': title, 'order': order.get('id') if order is not None else None, 'parts': parts})
    data = {'categories': out_cats, 'templates': templates, 'translations': {lang: translations(locale, lang) for lang in LANGS}}
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'ok : {len(templates)} modèles, {len(out_cats)} catégories -> {OUT_PATH}')


if __name__ == '__main__':
    main()
