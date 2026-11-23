#!/usr/bin/env python3
"""Extrait de l'application actuelle (zip) : la feuille de style (reprise telle quelle), l'icône, le manifeste et le catalogue
(leçons, jeux, outils : titres, durées, résumés). Usage : python3 tools/extraire-ancienne-app.py <zip>"""
import re, sys, json, zipfile, pathlib
zf = zipfile.ZipFile(sys.argv[1])
base = next(n.split('/')[0] for n in zf.namelist())
html = zf.read(f'{base}/index.html').decode('utf-8')
out = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'app'
css = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
(out / 'app.css').write_text("/* Feuille de style reprise telle quelle de l'application actuelle (Solfège, PWAsolfegeInitiation). Seules les polices sont ajoutées, embarquées au lieu d'être chargées depuis Google. */" + css, encoding='utf-8')
(out / 'assets' / 'icon.svg').write_bytes(zf.read(f'{base}/icon.svg'))
(out / 'assets' / 'manifest.json').write_bytes(zf.read(f'{base}/manifest.json'))
q = r"""(['"])(.*?)\%d"""
def pick(block, key):
    m = re.search(key + r""":(['"])(.*?)\1""", block, re.S); return m.group(2) if m else None
lessons = []
for m in re.finditer(r"\{\s*id:'([\w-]+)',\s*title:(['\"])(.*?)\2,\s*duration:'([^']*)',\s*summary:(['\"])(.*?)\5,", html, re.S):
    lessons.append({'id': m.group(1), 'title': m.group(3), 'duration': m.group(4), 'summary': m.group(6)})
def listing(name):
    blk = re.search(r'const %s = \[(.*?)\n\];' % name, html, re.S).group(1)
    res = []
    for m in re.finditer(r"\{id:'([\w-]+)',\s*title:(['\"])(.*?)\2,\s*summary:(['\"])(.*?)\4\}", blk, re.S):
        res.append({'id': m.group(1), 'title': m.group(3), 'summary': m.group(5)})
    return res
data = {'lessons': lessons, 'games': listing('GAMES'), 'tools': listing('TOOLS')}
(out / 'data' / 'catalogue.js').write_text('// Catalogue extrait de l\'application actuelle par tools/extraire-ancienne-app.py (titres, durées, résumés ; le contenu des leçons et des jeux est porté lot par lot).\nexport const CATALOGUE = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n', encoding='utf-8')
body = re.search(r'<body>(.*?)<script>', html, re.S).group(1).strip()
(out / 'squelette.html').write_text(body + '\n', encoding='utf-8')
print({k: len(v) for k, v in data.items()}, 'css', len(css), 'octets')
