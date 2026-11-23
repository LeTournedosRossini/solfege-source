#!/usr/bin/env python3
"""Génère src/model/instrument-names.json (noms traduits des instruments, familles, groupes, genres et ordres de partition) depuis le fichier de
traduction de MuseScore `share/locale/instruments_<lang>.ts` (tag v4.7.5, fait par la communauté MuseScore ; GPLv3 comme le catalogue).
Usage : python3 -I tools/extract-instrument-names.py /chemin/vers/share/locale fr [autre langue …]
Format : { "<lang>": { "instruments": { id: { "t": trackName, "l": longName, "s": shortName } }, "families": { anglais: traduit }, "groups": …, "genres": …, "orders": … } }
Seules les traductions qui diffèrent du texte source sont gardées (le reste retombe sur l'anglais)."""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'model', 'instrument-names.json')
CONTEXTS = {'engraving/instruments/family': 'families', 'engraving/instruments/group': 'groups', 'engraving/instruments/genre': 'genres', 'engraving/scoreorder': 'orders'}
KIND = {'trackName': 't', 'longName': 'l', 'shortName': 's'}


def read(path):
    root = ET.parse(path).getroot()
    out = {'instruments': {}, 'families': {}, 'groups': {}, 'genres': {}, 'orders': {}}
    for ctx in root.findall('context'):
        name = ctx.findtext('name')
        for msg in ctx.findall('message'):
            src = msg.findtext('source') or ''
            tr = msg.find('translation')
            text = (tr.text or '').strip() if tr is not None else ''
            if not text or (tr is not None and tr.get('type') in ('unfinished', 'obsolete')):
                continue
            if name == 'engraving/instruments':
                m = re.match(r'^(.+) (trackName|longName|shortName)$', msg.findtext('comment') or '')
                if m and text != src:
                    out['instruments'].setdefault(m.group(1), {})[KIND[m.group(2)]] = text
            elif name in CONTEXTS and text != src:
                out[CONTEXTS[name]][src] = text
    return out


def main():
    locale, langs = sys.argv[1], sys.argv[2:]
    data = {}
    for lang in langs:
        data[lang] = read(os.path.join(locale, f'instruments_{lang}.ts'))
        print(lang, {k: len(v) for k, v in data[lang].items()})
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


if __name__ == '__main__':
    main()
