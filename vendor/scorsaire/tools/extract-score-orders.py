#!/usr/bin/env python3
"""Génère src/model/score-orders.json à partir de share/instruments/orders.xml du dépôt MuseScore cloné (tag v4.7.5).
Usage : python3 -I tools/extract-score-orders.py /chemin/vers/orders.xml
Reprend la lecture de `ScoreOrder::read` / `readSection` (scoreorder.cpp) : l'ordre des groupes est conservé, les attributs par défaut
(barLineSpan, thinBrackets = vrai dans une section ; faux hors section) sont appliqués ici pour que le code JS n'ait qu'à lire."""
import json
import os
import sys
import xml.etree.ElementTree as ET

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'model', 'score-orders.json')


def flag(el, name, default):
    v = el.get(name)
    return default if v is None else v == 'true'


def main():
    root = ET.parse(sys.argv[1]).getroot()
    orders = {}
    for order in root.findall('Order'):
        oid = order.get('id')
        groups = []
        instruments = {}

        def has_group(family, unsorted):
            return any(g['family'] == family and (g['unsorted'] or '') == (unsorted or '') for g in groups)

        def unsorted_group(unsorted, section, bracket=False, span=False, thin=False):
            return {'family': '<unsorted>', 'unsorted': unsorted or '', 'section': section, 'bracket': bracket, 'barLineSpan': span, 'thinBracket': thin}

        for el in order:
            if el.tag == 'name':
                continue
            if el.tag == 'instrument':
                fam = el.find('family')
                if fam is not None:
                    instruments[el.get('id')] = fam.get('id')
            elif el.tag == 'soloists':
                if not has_group('<soloists>', ''):
                    groups.append({'family': '<soloists>', 'unsorted': '', 'section': '', 'bracket': False, 'barLineSpan': False, 'thinBracket': False})
            elif el.tag == 'family':
                groups.append({'family': el.text.strip(), 'unsorted': '', 'section': '', 'bracket': False, 'barLineSpan': False, 'thinBracket': False})
            elif el.tag == 'unsorted':
                g = el.get('group', '')
                if not has_group('<unsorted>', g):
                    groups.append(unsorted_group(g, ''))
            elif el.tag == 'section':
                sid = el.get('id')
                span = flag(el, 'barLineSpan', True)
                thin = flag(el, 'thinBrackets', True)
                for c in el:
                    if c.tag == 'family':
                        groups.append({'family': c.text.strip(), 'unsorted': '', 'section': sid, 'bracket': True, 'barLineSpan': span, 'thinBracket': thin})
                    elif c.tag == 'unsorted':
                        g = c.get('group', '')
                        if has_group('<unsorted>', g):
                            break  # MuseScore stops reading the section here (`return`)
                        groups.append(unsorted_group(g, sid, True, flag(c, 'barLineSpan', True), flag(c, 'thinBrackets', True)))
        if not has_group('<unsorted>', ''):
            groups.append(unsorted_group('', oid))
        orders[oid] = {'name': order.findtext('name'), 'instruments': instruments, 'groups': groups}
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump({'orders': orders}, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print(f"ok : {len(orders)} ordres -> {OUT_PATH}")


if __name__ == '__main__':
    main()
