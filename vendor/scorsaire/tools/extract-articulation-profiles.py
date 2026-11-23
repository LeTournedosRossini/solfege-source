#!/usr/bin/env python3
"""Extrait des profils d'articulations de MuseScore 4.7.5 (framework/mpe/resources/general_*_articulations_profile.json)
le sous-ensemble utilisé par la lecture Scorsaire → src/audio/articulation-profiles.json.
Usage : python3 tools/extract-articulation-profiles.py /chemin/vers/msrepo/src/framework/mpe/resources
Par type d'articulation et par famille : d = durationFactor, s = timestampOffset (unités de 1/10000), peak = plus grande valeur absolue de
la courbe de dynamique (`ValuesCurve::amplitudeValuePoint`), c = la courbe (11 valeurs, positions 0..10000 par 1000), seulement si le pic
n'est pas « natural » (5000) ; pc = courbe de HAUTEUR (`pitchPattern.pitchOffsets`, offsets en centièmes de la plage totale, 11 valeurs), seulement pour ContinuousGlissando (le seul type à hauteur dont Scorsaire se sert ; DiscreteGlissando : courbe ignorée par FluidSynth, `BEND_SUPPORTED_TYPES`). Premier segment du motif (position la plus basse), seul utilisé pour une note entière
(`ArticulationAppliedData::updateOccupiedRange` : étendue 0-100 % → `cbegin()` ; une étendue qui ne commence pas à 0 prend le 1er segment dont la position ≥ début,
sinon le premier : pour les types portés — notes d'ornement, arpèges, ornements — l'étendue des notes jouées vaut toujours 0-100 %, sauf le sous-motif des
ornements, dont les motifs n'ont qu'un segment ou retombent sur le premier). Un type absent du profil retombe sur « Standard » (ornements : UpperMordent, LowerMordent, Turn…)."""
import json, sys, os

TYPES = ['Standard', 'Accent', 'Marcato', 'SoftAccent', 'Staccato', 'Staccatissimo', 'Tenuto', 'LaissezVibrer', 'GhostNote', 'CrossNote', 'DiamondNote', 'Pedal',
         'Trill', 'TrillBaroque', 'UpPrall', 'PrallDown', 'LinePrall', 'Acciaccatura', 'PreAppoggiatura', 'PostAppoggiatura', 'Arpeggio', 'ArpeggioUp', 'ArpeggioDown', 'ArpeggioStraightUp', 'ArpeggioStraightDown',
         'DiscreteGlissando', 'ContinuousGlissando', 'Multibend', 'Tremolo8th', 'Tremolo16th', 'Tremolo32nd', 'Tremolo64th', 'TremoloBuzz']
FAMILIES = {'keyboard': 'keyboard', 'strings': 'strings', 'winds': 'winds', 'voice': 'voice', 'percussion': 'percussion'}

def peak(values):
    best = None
    for v in values:  # max_element avec « < » : le premier des maximaux
        if best is None or abs(best) < abs(v):
            best = v
    return best

def main(root):
    out = {}
    for fam in FAMILIES:
        data = json.load(open(os.path.join(root, f'general_{fam}_articulations_profile.json')))['patterns']
        out[fam] = {}
        for t in TYPES:
            if t not in data:
                continue
            seg = sorted(data[t], key=lambda p: p['patternPosition'])[0]
            curve = [o['offsetValue'] for o in sorted(seg['expressionPattern']['dynamicOffsets'], key=lambda o: o['offsetPosition'])]
            entry = {'d': seg['arrangementPattern']['durationFactor'], 's': seg['arrangementPattern']['timestampOffset'], 'peak': peak(curve)}
            if entry['peak'] != 5000:
                entry['c'] = curve
            if t == 'ContinuousGlissando':
                entry['pc'] = [o['offsetValue'] for o in sorted(seg['pitchPattern']['pitchOffsets'], key=lambda o: o['offsetPosition'])]
            out[fam][t] = entry
    # ÉCART SCORSAIRE (décision de Jean, 10/10/2026) : chez MuseScore le fantôme en percussion n'a AUCUN effet (motif = Standard). Ici : durée
    # de Standard, pic de dynamique 3000 (niveau natural − 2000), allure de la courbe du fantôme du clavier ramenée à ce pic.
    perc = out['percussion']
    perc['GhostNote'] = {'d': perc['Standard']['d'], 's': perc['Standard']['s'], 'peak': 3000,
                         'c': [0, 1125, 1875, 2625, 2925, 3000, 2925, 2625, 1875, 1125, 0]}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'audio', 'articulation-profiles.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'), sort_keys=True)
    print('écrit', path)

main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ms/msrepo/src/framework/mpe/resources')
