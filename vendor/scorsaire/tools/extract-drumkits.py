#!/usr/bin/env python3
"""Génère src/model/drumkit-catalog.json (jeux de percussion de MuseScore 4.7.5) à partir de share/instruments/instruments.xml.
Usage : python3 tools/extract-drumkits.py /chemin/vers/instruments.xml

Comme extract-instruments.py : sous-ensemble FACTUEL réduit, jamais le XML brut (règle du projet : pas de source MuseScore GPLv3 committée ;
le dépôt est lui-même en GPLv3+). Un « kit » = un <Instrument> qui a des <Drum> : id MuseScore, nom, clé, préréglage de portée, et pour chaque
son : n° MIDI (`pitch`), nom anglais, groupe de têtes (`head`) ou glyphe SMuFL personnalisé (`noteheads`, identique pour les 4 durées dans
tous les cas rencontrés), ligne (`line`, demi-interlignes depuis la ligne du HAUT : 0 = ligne du haut d'une portée à 5 lignes), voix
(`voice`, 0 = voix 1), sens de hampe (`stem` : 1 = haut, 2 = bas ; absent = auto). Pas de raccourcis clavier ni de positions de panneau.

Identifiant de son (`id`) = nom anglais en camelCase (« Closed Hi-Hat » → closedHiHat), unique dans un kit (suffixe du n° MIDI sinon).
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

OUT_PATH = 'src/model/drumkit-catalog.json'
STEM = {'1': 'up', '2': 'down'}


def camel(name):
    words = re.findall(r"[A-Za-z0-9]+", name)
    if not words:
        return 'sound'
    return words[0].lower() + ''.join(w[:1].upper() + w[1:] for w in words[1:])


def sound_of(drum):
    def text(tag):
        el = drum.find(tag)
        return el.text.strip() if el is not None and el.text else None
    custom = None
    nh = drum.find('noteheads')
    if nh is not None:
        glyphs = {c.tag: c.text.strip() for c in nh if c.text}
        values = set(glyphs.values())
        if len(values) != 1:
            raise SystemExit('têtes personnalisées différentes selon la durée : %r (à traiter)' % glyphs)
        custom = values.pop()
    return {
        'midi': int(drum.get('pitch')),
        'name': text('name'),
        'head': custom if custom else text('head'),
        'line': int(text('line')),
        'voice': int(text('voice')),
        'stem': STEM.get(text('stem') or '', 'auto'),
    }


def main():
    if len(sys.argv) != 2:
        print('Usage : python3 tools/extract-drumkits.py /chemin/vers/instruments.xml', file=sys.stderr)
        sys.exit(1)
    root = ET.parse(sys.argv[1]).getroot()
    kits = []
    for ins in root.iter('Instrument'):
        drums = ins.findall('Drum')
        if not drums:
            continue
        st = ins.find('stafftype')
        preset = st.get('staffTypePreset') if st is not None else None
        lines = int(re.match(r'perc(\d)Line', preset).group(1)) if preset else 5
        clef = ins.find('clef')
        sounds = [sound_of(d) for d in drums]
        seen = {}
        for s in sounds:
            base = camel(s['name'])
            s['id'] = base if base not in seen else '%s%d' % (base, s['midi'])
            seen[s['id']] = True
        kits.append({
            'id': ins.get('id'),
            'name': ins.find('trackName').text,
            'family': ins.find('family').text,
            'lines': lines,
            'clef': clef.text if clef is not None else 'PERC',
            'sounds': sounds,
        })
    json.dump({'source': 'MuseScore 4.7.5 share/instruments/instruments.xml', 'kits': kits}, open(OUT_PATH, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('ok', len(kits), 'kits', sum(len(k['sounds']) for k in kits), 'sons')


main()
