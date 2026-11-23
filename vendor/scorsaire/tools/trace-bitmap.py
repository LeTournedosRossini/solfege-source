#!/usr/bin/env python3
"""Trace a black-on-white bitmap into 24 x 24 SVG path data (marching squares with sub-pixel interpolation, Douglas-Peucker, Chaikin).

Usage: python3 -I tools/trace-bitmap.py image.png [epsilon] [margin] [dx] [dy] [threshold 0-255]
Prints a JSON string: one path 'd' (even-odd: holes are sub-paths). Needs only Pillow. Meant for icons a person draws or finds as a PNG:
the result is a filled silhouette, so check it by eye against the outline style of the other icons.
"""
import json, sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('L')
eps = float(sys.argv[2]) if len(sys.argv) > 2 else 0.6
margin = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
dx = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0  # shift of the result inside the 24 x 24 box (room for a letter)
dy = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
thr = float(sys.argv[6]) if len(sys.argv) > 6 else 127.5  # grey level below which a pixel is ink (colour pictures: lower it to keep only the dark outlines)
W, H = img.size
px = img.load()
# darkness field in [0, 1] (1 = black), padded with white so every contour closes
def f(x, y):
    return 0.0 if x < 0 or y < 0 or x >= W or y >= H else 1.0 - px[x, y] / 255.0
T = 1.0 - thr / 255.0
def interp(a, b, va, vb):
    return a + (b - a) * ((T - va) / (vb - va)) if vb != va else (a + b) / 2

segs = []
for y in range(-1, H):
    for x in range(-1, W):
        v = [f(x, y), f(x + 1, y), f(x + 1, y + 1), f(x, y + 1)]  # tl tr br bl
        case = sum((1 << i) for i, c in enumerate(v) if c >= T)
        if case in (0, 15): continue
        # edge crossing points: top, right, bottom, left
        pts = {
            't': (interp(x, x + 1, v[0], v[1]), y), 'r': (x + 1, interp(y, y + 1, v[1], v[2])),
            'b': (interp(x, x + 1, v[3], v[2]), y + 1), 'l': (x, interp(y, y + 1, v[0], v[3])),
        }
        table = {1: [('l', 't')], 2: [('t', 'r')], 3: [('l', 'r')], 4: [('r', 'b')], 5: [('l', 't'), ('r', 'b')], 6: [('t', 'b')], 7: [('l', 'b')],
                 8: [('b', 'l')], 9: [('b', 't')], 10: [('t', 'l'), ('b', 'r')], 11: [('b', 'r')], 12: [('r', 'l')], 13: [('r', 't')], 14: [('t', 'l')]}
        for a, b in table[case]:
            segs.append((pts[a], pts[b]))

# link segments into closed loops (undirected: the two ends of a segment are matched through the shared edge points)
key = lambda p: (round(p[0], 4), round(p[1], 4))
ends = {}
for i, (a, b) in enumerate(segs):
    ends.setdefault(key(a), []).append(i); ends.setdefault(key(b), []).append(i)
used = [False] * len(segs); loops = []
for i in range(len(segs)):
    if used[i]: continue
    used[i] = True
    loop = [segs[i][0], segs[i][1]]
    while True:
        nxt = [j for j in ends.get(key(loop[-1]), []) if not used[j]]
        if not nxt: break
        j = nxt[0]; used[j] = True
        a, b = segs[j]
        loop.append(b if key(a) == key(loop[-1]) else a)
    if len(loop) > 8: loops.append(loop)

def dp(pts, e):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; n = (dx * dx + dy * dy) ** 0.5 or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / n
        if d > dmax: dmax, idx = d, i
    if dmax > e: return dp(pts[:idx + 1], e)[:-1] + dp(pts[idx:], e)
    return [pts[0], pts[-1]]

def chaikin(pts, times=1):
    for _ in range(times):
        out = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        pts = out
    return pts

def simplify_closed(l, e):
    pts = l[:-1] if l[0] == l[-1] else l
    h = len(pts) // 2  # a closed loop is cut in two halves (Douglas-Peucker needs an open polyline)
    return dp(pts[:h + 1], e)[:-1] + dp(pts[h:] + [pts[0]], e)[:-1]

loops = [chaikin(simplify_closed(l, eps), 1) for l in loops]
xs = [p[0] for l in loops for p in l]; ys = [p[1] for l in loops for p in l]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
k = (24 - 2 * margin) / max(x1 - x0, y1 - y0)
ox, oy = 12 + dx - (x0 + x1) / 2 * k, 12 + dy - (y0 + y1) / 2 * k
r = lambda v: str(round(v, 2))
d = ''.join('M' + 'L'.join(f'{r(p[0] * k + ox)} {r(p[1] * k + oy)}' for p in l) + 'Z' for l in loops)
print(json.dumps(d))
