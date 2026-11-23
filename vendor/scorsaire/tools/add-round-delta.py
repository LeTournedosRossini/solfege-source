#!/usr/bin/env python3
"""Adds the glyph `csymMajorSeventhRound` to src/glyphs/bravura-subset.json: the triangle of Bravura's `csymMajorSeventh` (E873) with its corners rounded
(outer corners R_OUT, inner corners R_IN, in font units of the 1000-unit em), same size and same baseline. Derived from the glyph already in the subset,
so it can be run again after `add-glyphs.py` (which does not know it). Do not regenerate it with add-glyphs.py.
Usage: python3 tools/add-round-delta.py"""
import json, math, os

R_OUT, R_IN = 60, 24
HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, '..', 'src', 'glyphs', 'bravura-subset.json')

def rounded(points, r):
    """Closed polygon with each corner replaced by a quadratic curve that cuts it at the distance giving a circle-like radius r."""
    n = len(points); out = []
    for i in range(n):
        p0, p1, p2 = points[i - 1], points[i], points[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1 = math.hypot(*v1); l2 = math.hypot(*v2)
        cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
        ang = math.acos(max(-1, min(1, cos)))
        d = min(r / math.tan(ang / 2), l1 / 2, l2 / 2)
        a = (p1[0] + v1[0] / l1 * d, p1[1] + v1[1] / l1 * d); b = (p1[0] + v2[0] / l2 * d, p1[1] + v2[1] / l2 * d)
        out.append((a, p1, b))
    f = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')
    d = f'M{f(out[0][0][0])} {f(out[0][0][1])}'
    for i, (a, c, b) in enumerate(out):
        if i: d += f'L{f(a[0])} {f(a[1])}'
        d += f'Q{f(c[0])} {f(c[1])} {f(b[0])} {f(b[1])}'
    return d + 'Z', out

data = json.load(open(PATH))
g = data['glyphs']
# vertices of the two contours of the original (outer triangle, inner triangle), y downwards
outer = [(279, 0), (0, 476), (558, 476)]
inner = [(279, 87), (481, 432), (77, 432)]
d_out, o = rounded(outer, R_OUT); d_in, i = rounded(inner, R_IN)
path = d_out + d_in
xs = [p[0] for a, c, b in o for p in (a, b)]; ys = [p[1] for a, c, b in o for p in (a, b)]
scale = g['csymMajorSeventh']['bbox']['bBoxNE'][0] / 558  # sp per font unit (0.004)
src = g['csymMajorSeventh']
apex = min((a[1] + 2 * c[1] + b[1]) / 4 for a, c, b in o)  # top of the rounded apex (the quadratic curve peaks half way to its control point)
g['csymMajorSeventhRound'] = {
    'path': path,
    'bbox': {'bBoxNE': [src['bbox']['bBoxNE'][0], round((476 - apex) * scale + src['bbox']['bBoxSW'][1], 3)], 'bBoxSW': list(src['bbox']['bBoxSW'])},
    'advance': src['advance'], 'anchors': {},
}
json.dump(data, open(PATH, 'w'), ensure_ascii=False, separators=(',', ':'))
print('csymMajorSeventhRound', g['csymMajorSeventhRound']['bbox'])
