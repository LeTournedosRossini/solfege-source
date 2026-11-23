#!/usr/bin/env python3
"""Ajoute au sous-ensemble src/glyphs/bravura-subset.json les glyphes du TEXTE de frette de tablature : chiffres 0-9, « X » (note
étouffée), « < » et « > » (harmoniques), depuis FreeSans.ttf (la police « MuseScore Tab Sans » de MuseScore, style
tabFretNumberFontFace = FreeSans, 9 pt ; dépôt MuseScore `fonts/FreeSans.ttf`, GPLv3 + exception de police : voir LICENSES/).
Usage : python3 tools/add-tabfont.py FreeSans.ttf
Même convention que add-glyphs.py (1 espace = 250 unités, y vers le bas, haut de la boîte en y = 0), plus `advance` (largeur
d'avance en espaces) : le texte est une chaîne de glyphes dont l'origine est la ligne de base.
Corps : 9 pt sur un espace de 5 pt = 1,8 sp en théorie ; MESURÉ sur les exports MuseScore 4.7.5 (chiffre « 0 » : 79,3 × 125,2 px
pour un espace de 94,488 px, soit 171 px) : 1,8097 sp."""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

EM_SP = 1.8097
CHARS = {('tabFret%d' % d): str(d) for d in range(10)}
CHARS.update({'tabFretX': 'X', 'tabFretLess': '<', 'tabFretGreater': '>', 'tabFretPeriod': '.', 'tabFretSpace': ' '})
font = TTFont(sys.argv[1]); gs = font.getGlyphSet(); cmap = font.getBestCmap()
upm = font['head'].unitsPerEm
k = EM_SP * 250 / upm            # unités de police → unités du sous-ensemble
path = 'src/glyphs/bravura-subset.json'
data = json.load(open(path))
for name, ch in CHARS.items():
    gn = cmap[ord(ch)]
    bp = BoundsPen(gs); gs[gn].draw(bp)
    x0, y0, x1, y1 = bp.bounds or (0, 0, 0, 0)  # l'espace n'a pas de contour
    sp = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    gs[gn].draw(TransformPen(sp, (k, 0, 0, -k, 0, y1 * k)))  # y' = (y1 - y)·k
    data['glyphs'][name] = {
        'path': sp.getCommands(),
        'bbox': {'bBoxNE': [round(x1 * k / 250, 4), round(y1 * k / 250, 4)], 'bBoxSW': [round(x0 * k / 250, 4), round(y0 * k / 250, 4)]},
        'advance': round(gs[gn].width * k / 250, 4),
        'anchors': {},
    }
json.dump(data, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
print('ok', list(CHARS))
