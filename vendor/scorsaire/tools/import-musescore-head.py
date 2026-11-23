#!/usr/bin/env python3
# Importe la tête « charleston ouvert » (croix cerclée) de MuseScore 4.7.5 (Leland) dans le sous-ensemble de glyphes.
# Source : tools/data/musescore-noteheadCircleX.path = attribut d des <path class="Note"> de l'export SVG de Jean (05/10/2026,
# « HH fermé / ouvert »), transform matrix(1.2,0,0,1.2,x,y) : unités MuseScore de 1/82,675 sp (99,21 px / 1,2), origine = ligne de la note.
# Le sous-ensemble utilise 250 unités par sp et y vers le bas depuis le haut de la boîte. Ancres de hampe : comme les autres têtes
# (haut/bas au milieu, bord gauche / droit), faute de métadonnées MuseScore.
import json, re
U = 82.675
# On garde les têtes Bravura brutes (croix = 1,16 sp) : la tête MuseScore (1,30 sp, même largeur que sa croix) est ramenée à la largeur de la croix Bravura.
X_WIDTH = 1.16
k = 250 / U * X_WIDTH / (107.578 / U)  # = 250 × 1,16 / 107,578 : largeur finale = X_WIDTH
d = open('tools/data/musescore-noteheadCircleX.path').read().strip()
toks = re.findall(r'[MLCZ]|-?\d+\.?\d*', d)
nums = [float(t) for t in toks if not t.isalpha()]
xs, ys = nums[0::2], nums[1::2]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)  # y svg vers le bas : y0 = haut
out, i = [], 0
cmd = None
for t in toks:
    if t.isalpha():
        cmd = t; out.append(t if t != 'Z' else 'Z'); i = 0; continue
    v = float(t)
    out.append(('%.1f' % (((v - x0) if i % 2 == 0 else (v - y0)) * k)).rstrip('0').rstrip('.'))
    i += 1
# reformater : commande suivie de ses nombres séparés par des espaces
s, buf = '', []
for t in out:
    if t.isalpha():
        s += (' '.join(buf) + ' ' if buf else '') ; buf = []; s += t
    else: buf.append(t)
s += ' '.join(buf)
w, h = (x1 - x0) * k / 250, (y1 - y0) * k / 250
p = 'src/glyphs/bravura-subset.json'
data = json.load(open(p))
data['glyphs']['noteheadCircleX'] = {
    'path': re.sub(r'(?<=[MLC])(?=\d|-)', '', s),
    'bbox': {'bBoxNE': [round(w, 3), round(h / 2, 3)], 'bBoxSW': [0.0, round(-h / 2, 3)]},
    'advance': round(w, 3),
    'anchors': {'stemDownNW': [0.0, 0.0], 'stemUpSE': [round(w, 3), 0.0]},
}
json.dump(data, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
print('ok', w, h)
