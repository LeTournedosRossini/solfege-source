#!/usr/bin/env python3
"""Extrait de MuseScore 4.7.5 la carte de percussion de l'import Guitar Pro (n° MIDI → tête, ligne) et les noms General MIDI.

Usage : python3 tools/extract-gp-drumset.py <dépôt MuseScore cloné> > src/model/drummap-standards.json
Sources lues : src/importexport/guitarpro/internal/guitarprodrumset.cpp (initGuitarProDrumset),
               src/engraving/types/typesconv.cpp (noms DrumNum). Données FACTUELLES seulement (aucun code recopié).
"""
import json, re, sys

root = sys.argv[1]
gp = open(f'{root}/src/importexport/guitarpro/internal/guitarprodrumset.cpp', encoding='utf8').read()
tc = open(f'{root}/src/engraving/types/typesconv.cpp', encoding='utf8').read()

names = {int(n): s for n, s in re.findall(r'DrumNum\((\d+)\),\s*QT_TRANSLATE_NOOP_U16\("engraving/drumset", "([^"]*)"\)', tc)}
HEADS = {'HEAD_NORMAL': 'normal', 'HEAD_CROSS': 'cross', 'HEAD_XCIRCLE': 'xcircle', 'HEAD_DIAMOND': 'diamond',
         'HEAD_TRIANGLE_UP': 'triangle-up', 'HEAD_HEAVY_CROSS_HAT': 'noteheadHeavyXHat'}
body = gp.split('void initGuitarProDrumset()')[1].split('void initGuitarProPercussionSet')[0]

def camel(name):
    words = re.sub(r"[^A-Za-z0-9 ]", ' ', name.replace('ü', 'u')).split()
    return words[0].lower() + ''.join(w.capitalize() for w in words[1:])

sounds = []
for m in re.finditer(r'gpDrumset->drum\((\d+)\)\s*=\s*DrumInstrument\(TConv::userName\(DrumNum\((\d+)\)\),\s*NoteHeadGroup::(\w+),\s*(-?\d+),\s*DirectionV::(\w+)\)', body):
    midi, nameNum, head, line, stem = int(m[1]), int(m[2]), m[3], int(m[4]), m[5].lower()
    name = names[nameNum]
    sid = camel(name)
    if any(x['id'] == sid for x in sounds): sid += str(midi)  # MuseScore donne à la note 92 le nom de la note 46 : on garde son nom, l'identifiant reçoit le numéro
    sounds.append({'midi': midi, 'id': sid, 'name': name, 'head': HEADS[head], 'line': line, 'voice': 0, 'stem': stem})
json.dump({'source': 'MuseScore 4.7.5 : import Guitar Pro (guitarprodrumset.cpp) et noms General MIDI (typesconv.cpp)', 'gpDrumset': sounds}, sys.stdout, ensure_ascii=False, indent=1)
