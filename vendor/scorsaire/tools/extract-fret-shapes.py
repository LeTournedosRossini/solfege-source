#!/usr/bin/env python3
"""Extract the fingering SHAPES of MuseScore's chord-to-diagram table (4.7.5, GPLv3) into src/model/fret-shapes.json.

MuseScore's `harmony_to_diagram.xml` is 2.4 MB because every shape is stored twice (a short pattern AND the full XML of the diagram) and
under every enharmonic name. Scorsaire only needs the DISTINCT shapes: the chord a shape spells is computed from its notes (`model/fretsuggest.js`),
never read from MuseScore's names. Format of a shape: one character per string, lowest string first, 'x' = muted, '0'-'9' then 'a'... = fret.
Usage: python3 -I tools/extract-fret-shapes.py <path to harmony_to_diagram.xml>
"""
import json, re, sys

path = sys.argv[1]
text = open(path, encoding='utf8').read()
shapes = []
seen = set()
for block in text.split('<HarmonyToDiagram>')[1:]:
    main, *rest = re.search(r'<pattern>(.*?)</pattern>', block).group(1).split(';')
    tokens = re.findall(r'\[[^\]]*\]|.', main)
    frets = []
    for t in tokens:
        if t == 'X': frets.append(-1)
        elif t == 'O': frets.append(0)
        elif t == '-': frets.append(None)  # unmarked: muted unless a barre covers it
        else: frets.append(int(t[1:-1].split(',')[0].split('-')[0]))
    for r in rest:
        m = re.match(r'B(\d+)\[(\d+)-(\d+)\]', r)
        if m:
            f, a, b = map(int, m.groups())
            for i in range(a, b + 1):
                if frets[i] is None: frets[i] = f
    frets = [-1 if f is None else f for f in frets]
    if len(frets) != 6 or max(frets) > 24: continue
    code = ''.join('x' if f < 0 else ('0123456789abcdefghijklmnopqrstuvwxyz'[f]) for f in frets)
    if code not in seen:
        seen.add(code); shapes.append(code)
shapes.sort()
out = {'source': 'MuseScore 4.7.5 share harmony_to_diagram.xml (GPLv3)', 'strings': 6, 'tuning': [40, 45, 50, 55, 59, 64], 'shapes': shapes}
json.dump(out, open('src/model/fret-shapes.json', 'w'), separators=(',', ':'))
print(len(shapes), 'shapes')
