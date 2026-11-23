#!/usr/bin/env python3
"""Génère src/model/instrument-catalog.json à partir de share/instruments/instruments.xml du dépôt MuseScore cloné.
Usage : python3 tools/extract-instruments.py /chemin/vers/msrepo/share/instruments/instruments.xml

Ne committe JAMAIS instruments.xml lui-même (règle du projet, CLAUDE.md : pas de source MuseScore GPLv3 dans le
dépôt). Ce script en extrait un sous-ensemble FACTUEL réduit (identifiants, classification, noms d'instrument, clé
par défaut, transposition, tessiture, tags de genre) — pas le fichier XML complet, pas les champs de mise en œuvre
MuseScore qui ne servent à rien ici (patchs MIDI/Channel sauf le NUMÉRO DE PROGRAMME du premier canal, `program`, jeux de percussion/Drum, réglages d'expression/Articulation,
descriptions en prose longue). Voir la question de licence non tranchée pour ce fichier généré, en tête de
`src/model/instruments.js`.

Champ `family` : c'est EXACTEMENT ce que `Instrument::isVocalInstrument()` teste dans le vrai MuseScore
(`family == "voices" || family == "voice-groups"`, vérifié dans instrument.cpp) — donc la classification vocale de
Scorsaire redevient un vrai port, plus une liste inventée.
"""
import json
import sys
import xml.etree.ElementTree as ET

OUT_PATH = 'src/model/instrument-catalog.json'


def text_list(instrument, tag):
    return [el.text for el in instrument.findall(tag) if el.text]


def clefs(instrument):
    """`<clef>` (staff 1 implicite) et `<clef staff="N">` (portées suivantes, ex. piano/orgue) : liste [{staff, clef}]."""
    out = []
    for el in instrument.findall('clef'):
        staff = int(el.get('staff', '1'))
        out.append({'staff': staff, 'clef': el.text})
    return out


def clef_types(instrument, table):
    """Clés par portée, dans l'ORDRE du fichier comme `InstrumentTemplate::read` : `<init>` copie d'abord le modèle déjà chargé (un `<init>` vers un
    modèle défini PLUS LOIN dans le fichier n'est pas trouvé par MuseScore, `searchTemplate` : ignoré), puis `<clef>` (concert ET transposante),
    `<concertClef>` et `<transposingClef>` (optionnel `staff`) les remplacent. Sans balise : sol / sol. Renvoie { staff: [concert, transposante] }."""
    out = {}
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = {k: list(v) for k, v in ref['_clefTypes'].items()}
        elif el.tag in ('clef', 'concertClef', 'transposingClef'):
            staff = int(el.get('staff', '1'))
            pair = out.setdefault(staff, ['G', 'G'])
            if el.tag in ('clef', 'concertClef'):
                pair[0] = el.text
            if el.tag in ('clef', 'transposingClef'):
                pair[1] = el.text
    return out


def frets(instrument, table):
    """Nombre de cases (`<StringData><frets>`), hérité par `<init>` comme `InstrumentTemplate::read` ; None si la source n'en donne pas."""
    out = None
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = ref.get('frets')
        elif el.tag == 'StringData':
            f = el.findtext('frets')
            if f:
                out = int(f)
    return out


def strings(instrument, table):
    """Cordes à vide (`<StringData><string>`, hauteurs MIDI, de la plus grave à la plus aiguë comme la source), héritées par `<init>` ; None si absentes."""
    out = None
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = ref.get('strings')
        elif el.tag == 'StringData':
            found = [int(c.text) for c in el.findall('string') if c.text and c.text.strip().lstrip('-').isdigit()]
            if found:
                out = found
    return out


def staff_type_preset(instrument, table):
    """Préréglage de type de portée (`<stafftype staffTypePreset=…>`, ex. perc1Line, tab6StrCommon), hérité par `<init>` ; None si absent."""
    out = None
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = ref.get('staffTypePreset')
        elif el.tag == 'stafftype' and el.get('staffTypePreset'):
            out = el.get('staffTypePreset')
    return out


def transposition(instrument, table):
    """Intervalle d'instrument (écrit -> sonnant) comme `InstrumentTemplate::read` : `<init>` copie le modèle déjà chargé, puis les balises explicites."""
    out = None
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = dict(ref['transpose']) if 'transpose' in ref else None
        elif el.tag in ('transposeDiatonic', 'transposeChromatic'):
            out = out or {'diatonic': 0, 'chromatic': 0}
            out['diatonic' if el.tag == 'transposeDiatonic' else 'chromatic'] = int(el.text)
    return out


def midi_program(instrument, table):
    """Programme MIDI (0-127, numérotation General MIDI) du PREMIER `<Channel>` de l'instrument qui en donne un (c'est le canal par défaut de MuseScore :
    « arco » pour un violon, « open » pour une trompette, sans nom pour la plupart des autres), sinon celui hérité par `<init>` (`InstrumentTemplate::read`) ;
    None si la source n'en donne pas. Ne sert qu'au choix du timbre d'une piste dans une SoundFont."""
    inherited = None
    own = None
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                inherited = ref.get('program')
        elif el.tag == 'Channel' and own is None:
            prog = el.find('program')
            if prog is not None and prog.get('value') is not None:
                own = int(prog.get('value'))
    return own if own is not None else inherited


def channel_programs(instrument, table):
    """Programmes MIDI des canaux NOMMÉS de l'instrument (`<Channel name="pizzicato">`, « mute », « open », « tremolo »… : les modes de jeu de MuseScore),
    hérités par `<init>` puis surchargés par les canaux propres ; {} si l'instrument n'en a pas. Sert à relier les textes de technique (pizz., con sord.…)
    au programme d'une SoundFont."""
    out = {}
    for el in instrument:
        if el.tag == 'init':
            ref = table.get(el.text)
            if ref is not None:
                out = dict(ref.get('channels', {}))
        elif el.tag == 'Channel' and el.get('name'):
            prog = el.find('program')
            if prog is not None and prog.get('value') is not None:
                out[el.get('name')] = int(prog.get('value'))
    return out


def main():
    if len(sys.argv) != 2:
        print('Usage : python3 tools/extract-instruments.py /chemin/vers/instruments.xml', file=sys.stderr)
        sys.exit(1)

    tree = ET.parse(sys.argv[1])
    root = tree.getroot()

    genres = {el.get('id'): el.findtext('name') for el in root.findall('Genre')}
    families = {el.get('id'): el.findtext('name') for el in root.findall('Family')}

    groups = {}
    instruments = {}
    for grp in root.findall('InstrumentGroup'):
        gid = grp.get('id')
        groups[gid] = grp.findtext('name')
        for inst in grp.findall('Instrument'):
            iid = inst.get('id')
            entry = {
                'group': gid,
                'family': inst.findtext('family'),
                # noms d'affichage : None si absent dans la source (jamais deviné — voir en-tête de instruments.js,
                # MuseScore a une logique de repli non portée ici pour les quelques instruments qui les omettent)
                'trackName': inst.findtext('trackName'),
                'longName': inst.findtext('longName'),
                'shortName': inst.findtext('shortName'),
                'musicXMLid': inst.findtext('musicXMLid'),
                'clefs': clefs(inst),
                'staves': int(inst.findtext('staves', '1')),
                'genres': text_list(inst, 'genre'),
            }
            transp = transposition(inst, instruments)
            if transp is not None:
                entry['transpose'] = transp
            nf = frets(inst, instruments)
            if nf is not None:
                entry['frets'] = nf
            ns = strings(inst, instruments)
            if ns is not None:
                entry['strings'] = ns
            preset = staff_type_preset(inst, instruments)
            if preset is not None:
                entry['staffTypePreset'] = preset
            channels = channel_programs(inst, instruments)
            if channels:
                entry['channels'] = channels
            program = midi_program(inst, instruments)
            if program is not None:
                entry['program'] = program
            types = clef_types(inst, instruments)
            entry['_clefTypes'] = types
            if any(c != ['G', 'G'] for c in types.values()):
                # clé de concert / clé écrite (transposante) de chaque portée, quand elles ne sont pas toutes deux « sol »
                entry['clefTypes'] = [{'staff': k, 'concert': v[0], 'transposing': v[1]} for k, v in sorted(types.items())]
            init = inst.findtext('init')
            if init:
                # référence à un autre id pour hériter ses valeurs par défaut (MuseScore) : PAS résolue ici
                # (limite assumée, documentée dans instruments.js — rare, quelques variantes de cordes pincées)
                entry['initFrom'] = init
            # rang d'apparition dans instruments.xml (`InstrumentTemplate::sequenceOrder`) : sert au tri des instruments d'un ordre de partition
            entry['seq'] = instruments[iid]['seq'] if iid in instruments else len(instruments)
            instruments[iid] = entry

    for entry in instruments.values():
        entry.pop('_clefTypes', None)
    data = {'genres': genres, 'families': families, 'groups': groups, 'instruments': instruments}
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f'ok : {len(instruments)} instruments, {len(groups)} groupes, {len(families)} familles -> {OUT_PATH}')


if __name__ == '__main__':
    main()
