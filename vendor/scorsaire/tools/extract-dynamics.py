#!/usr/bin/env python3
"""Génère src/model/dynamics-data.js depuis MuseScore 4.7.5 (`dom/dynamic.cpp` DYN_LIST) et Bravura (mise en forme HarfBuzz).
Usage : python3 tools/extract-dynamics.py <msrepo> <Bravura.otf>
Pour chaque type de nuance : la suite de symboles de MuseScore (`<sym>…</sym>`), puis les glyphes que la police produit réellement
avec ses ligatures (`liga`, comme le moteur de texte de MuseScore) — rien n'est deviné : sff, sfff, sfffz n'ont pas de ligature unique."""
import re, sys, json
import uharfbuzz as hb
from fontTools.ttLib import TTFont

repo, otf = sys.argv[1], sys.argv[2]
src = open(repo + '/src/engraving/dom/dynamic.cpp', encoding='utf8').read()
tc = open(repo + '/src/engraving/types/typesconv.cpp', encoding='utf8').read()
glyphnames = json.load(open('/tmp/gn.json'))
byCode = {v['codepoint']: k for k, v in glyphnames.items()}
base = {'dynamicPiano': 0xE520, 'dynamicMezzo': 0xE521, 'dynamicForte': 0xE522, 'dynamicRinforzando': 0xE523,
        'dynamicSforzando': 0xE524, 'dynamicZ': 0xE525, 'dynamicNiente': 0xE526}
font = hb.Font(hb.Face(hb.Blob.from_file_path(otf)))
ttf = TTFont(otf)
order = []
# types et étiquettes (typesconv.cpp, table DYNAMIC_TYPES : { DynamicType::X, "tag", SymId::…)
tags = {m.group(1): m.group(2) for m in re.finditer(r'\{\s*DynamicType::(\w+),\s*"(\w+)",\s*SymId::', tc)}
out = []
for m in re.finditer(r'\{\s*DynamicType::(\w+),\s*(-?\d+),\s*(-?\d+),\s*(true|false),\s*((?:"[^"]*"\s*)+)\}', src):
    t = m.group(1)
    if t == 'OTHER': continue
    text = ''.join(re.findall(r'"([^"]*)"', m.group(5)))
    syms = re.findall(r'<sym>(\w+)</sym>', text)
    buf = hb.Buffer(); buf.add_str(''.join(chr(base[s]) for s in syms)); buf.guess_segment_properties()
    hb.shape(font, buf, {'liga': True})
    glyphs = []
    for i in buf.glyph_infos:
        gn = font.glyph_to_string(i.codepoint)  # uniE52B
        glyphs.append(byCode['U+' + gn[3:]])
    out.append({'id': tags[t], 'type': t, 'symbols': syms, 'glyphs': glyphs})
assert len(out) == 32, len(out)
js = '// GÉNÉRÉ par tools/extract-dynamics.py (MuseScore 4.7.5 dynamic.cpp + Bravura 1.482) — ne pas modifier à la main.\nexport const DYNAMIC_DISPLAY = ' + json.dumps({o['id']: o['glyphs'] for o in out}, indent=1, ensure_ascii=False) + ';\n'
js += 'export const DYNAMIC_SYMBOLS = ' + json.dumps({o['id']: o['symbols'] for o in out}, indent=1) + ';\n'
open('src/model/dynamics-data.js', 'w', encoding='utf8').write(js)
print(len(out)); [print(o['id'], o['glyphs']) for o in out]
