#!/usr/bin/env python3
"""Ajoute des glyphes SMuFL au sous-ensemble src/glyphs/bravura-subset.json depuis Bravura.otf.
Usage : python3 tools/add-glyphs.py Bravura.otf brace braceSmall ...
Police : https://github.com/steinbergmedia/bravura (redist/otf/Bravura.otf, licence SIL OFL).
Convention du sous-ensemble : unités de police (1 espace = 250), tracé en y vers le bas dont le haut est le
sommet de la boîte englobante ; bbox en espaces ; codes SMuFL : brace E000-E003, flag32nd E244/E245, tuplet0-9 E880-E889, repeatDot E044."""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

CODES = {'wiggleGlissando': 0xEAAF, 'brace': 0xE000, 'braceSmall': 0xE001, 'braceLarge': 0xE002, 'braceLarger': 0xE003,
         'flag32ndUp': 0xE244, 'flag32ndDown': 0xE245, 'repeatDot': 0xE044, '4stringTabClef': 0xE06E, 'augmentationDot': 0xE1E7,
         'guitarVibratoBarScoop': 0xE830, 'guitarVibratoBarDip': 0xE831, 'guitarVibratoStroke': 0xEAB2, 'guitarWideVibratoStroke': 0xEAB3, 'wiggleSawtooth': 0xEABB, 'wiggleSawtoothWide': 0xEABC,
         'windClosedHole': 0xE5F4, 'pluckedLeftHandPizzicato': 0xE633, 'wiggleArpeggiatoUp': 0xEAA9, 'wiggleArpeggiatoUpArrow': 0xEAAD, 'arrowheadBlackDown': 0xEB7C,
         'noteheadDiamondDoubleWhole': 0xE0D7, 'noteheadDiamondWhole': 0xE0D8, 'noteheadDiamondHalf': 0xE0D9,
         'noteheadXDoubleWhole': 0xE0A6, 'noteheadXWhole': 0xE0A7, 'noteheadXHalf': 0xE0A8}
# Têtes de note de percussion (tranche 5, groupes de têtes de MuseScore `note.cpp` noteHeads[]) ; codes lus dans glyphnames.json (SMuFL) et
# vérifiés contre la police (Bravura 1.482). Anchors de hampe copiées de bravura_metadata.json si BRAVURA_METADATA est défini.
CODES.update({
  'ornamentTrill': 0xE566, 'wiggleTrill': 0xEAA4, 'ornamentZigZagLineNoRightEnd': 0xE59D, 'ornamentZigZagLineWithRightEnd': 0xE59E, 'ornamentBottomLeftConcaveStroke': 0xE59A, 'ornamentLeftVerticalStroke': 0xE594,
  'noteheadXBlack': 0xE0A9,
  'noteheadPlusBlack': 0xE0AF, 'noteheadPlusHalf': 0xE0AE, 'noteheadPlusWhole': 0xE0AD, 'noteheadPlusDoubleWhole': 0xE0AC,
  'noteheadCircleX': 0xE0B3, 'noteheadCircleXHalf': 0xE0B2, 'noteheadCircleXWhole': 0xE0B1, 'noteheadCircleXDoubleWhole': 0xE0B0,
  'noteheadTriangleUpBlack': 0xE0BE, 'noteheadTriangleUpHalf': 0xE0BC, 'noteheadTriangleUpWhole': 0xE0BB, 'noteheadTriangleUpDoubleWhole': 0xE0BA,
  'noteheadTriangleDownBlack': 0xE0C7, 'noteheadTriangleDownHalf': 0xE0C5, 'noteheadTriangleDownWhole': 0xE0C4, 'noteheadTriangleDownDoubleWhole': 0xE0C3,
  'noteheadSlashedBlack1': 0xE0CF, 'noteheadSlashedHalf1': 0xE0D1, 'noteheadSlashedWhole1': 0xE0D3, 'noteheadSlashedDoubleWhole1': 0xE0D5,
  'noteheadSlashedBlack2': 0xE0D0, 'noteheadSlashedHalf2': 0xE0D2, 'noteheadSlashedWhole2': 0xE0D4, 'noteheadSlashedDoubleWhole2': 0xE0D6,
  'noteheadSlashHorizontalEnds': 0xE101, 'noteheadSlashWhiteHalf': 0xE103, 'noteheadSlashWhiteWhole': 0xE102,
  'noteShapeSquareBlack': 0xE1B3, 'noteShapeSquareWhite': 0xE1B2,
  'noteShapeTriangleRoundBlack': 0xE1BF, 'noteShapeTriangleRoundWhite': 0xE1BE,
  'noteShapeTriangleUpBlack': 0xE1BB, 'noteShapeTriangleUpWhite': 0xE1BA,
  'noteheadHeavyXHat': 0xE0F9, 'noteheadXOrnate': 0xE0AA, 'noteheadSlashX': 0xE106,
  'unpitchedPercussionClef1': 0xE069, 'unpitchedPercussionClef2': 0xE06A,
  'noteheadDoubleWhole': 0xE0A0,
})
CODES.update({'guitarString%d' % d: (0xE833 + d if d < 10 else 0xE840 + d) for d in range(14)})  # SMuFL : 0-9 = E833-E83C, 10-13 = E84A-E84D (vérifié dans glyphnames.json)  # chiffres cerclés des cordes (texte d'accordage)
CODES.update({'noteheadE0F7': 0xE0F7, 'noteheadE0F3': 0xE0F3, 'noteheadE0E3': 0xE0E3, 'noteheadE0C2': 0xE0C2})  # têtes de percussion supplémentaires demandées par Jean (21/10/2026) : cercle barré, triangle renversé, losange, triangle rectangle ; ancres de hampe posées à la main (voir CLAUDE.md)
CODES.update({'noteheadSlashSmall': 0xE101})  # barre oblique réduite (E101 ramenée à la largeur de la croix : plus courte et plus fine) pour la percussion ; ancres posées à la main
CODES.update({'noteheadSquareWhite': 0xE0B8, 'noteheadRoundBlack': 0xE113})  # sticking en symboles (tranche 5c) ; codes lus dans glyphnames.json
CODES.update({'restHalfLegerLine': 0xE4F5, 'restWholeLegerLine': 0xE4F4})  # silences de blanche / ronde avec ligne supplémentaire (Rest::getSymbol)
CODES.update({'pictBassDrum': 0xE6D4, 'pictSnareDrum': 0xE6D1, 'pictTomTom': 0xE6D7, 'pictHiHat': 0xE722, 'pictCrashCymbals': 0xE720, 'pictSuspendedCymbal': 0xE721, 'pictTimpani': 0xE6D0, 'pictTriangle': 0xE700, 'pictTambourine': 0xE6DB, 'pictCowBell': 0xE711, 'pictClaves': 0xE6F2, 'pictWoodBlock': 0xE6F0, 'pictMaracas': 0xE742, 'pictGlsp': 0xE6A0, 'pictXyl': 0xE6A1, 'pictVib': 0xE6A7, 'pictMar': 0xE6A6, 'pictCrotales': 0xE6AE, 'pictTubularBells': 0xE6C0, 'pictCelesta': 0xE6B0, 'pictConga': 0xE6DE, 'pictBongos': 0xE6DD, 'pictTimbales': 0xE6DC, 'pictGong': 0xE732, 'pictCastanets': 0xE6F8, 'pictSteelDrums': 0xE6AF, 'pictGuiro': 0xE6F3, 'pictSleighBell': 0xE710, 'pictTenorDrum': 0xE6D6, 'pictTamTam': 0xE730, 'gClef': 0xE050, 'fClef': 0xE062, 'cClef': 0xE05C, 'noteQuarterUp': 0xE1D5})  # icônes de piste (pictogrammes de percussion SMuFL E6xx-E7xx, clés, note) : noms lus dans glyphnames.json
CODES.update({'bracketTop': 0xE003, 'bracketBottom': 0xE004})  # extrémités courbes des crochets de groupe (SMuFL : bracketTop E003, bracketBottom E004 ; les entrées « braceLarge »/« braceLarger » du sous-ensemble sont en réalité E002/E003)
CODES.update({'reversedBracketTop': 0xE005, 'reversedBracketBottom': 0xE006})  # ailettes des barres de fin de reprise (SMuFL E005 / E006), option REPEAT_BAR_TIPS
CODES.update({'fermataShortHenzeAbove': 0xE4CC, 'fermataShortHenzeBelow': 0xE4CD, 'fermataLongHenzeAbove': 0xE4CA, 'fermataLongHenzeBelow': 0xE4CB})  # points d'orgue Henze (tranche tempo) ; codes lus dans glyphnames.json
CODES.update({'fingering0': 60688, 'fingering0Italic': 60800, 'fingering1': 60689, 'fingering1Italic': 60801, 'fingering2': 60690, 'fingering2Italic': 60802, 'fingering3': 60691, 'fingering3Italic': 60803, 'fingering4': 60692, 'fingering4Italic': 60804, 'fingering5': 60693, 'fingering5Italic': 60805, 'fingering6': 60708, 'fingering6Italic': 60806, 'fingering7': 60709, 'fingering7Italic': 60807, 'fingering8': 60710, 'fingering8Italic': 60808, 'fingering9': 60711, 'fingering9Italic': 60809, 'fingeringALower': 60699, 'fingeringCLower': 60700, 'fingeringELower': 60702, 'fingeringILower': 60697, 'fingeringLeftBracket': 60714, 'fingeringLeftBracketItalic': 60812, 'fingeringLeftParenthesis': 60712, 'fingeringLeftParenthesisItalic': 60810, 'fingeringMLower': 60698, 'fingeringOLower': 60703, 'fingeringPLower': 60695, 'fingeringQLower': 60814, 'fingeringRightBracket': 60715, 'fingeringRightBracketItalic': 60813, 'fingeringRightParenthesis': 60713, 'fingeringRightParenthesisItalic': 60811, 'fingeringSLower': 60815, 'fingeringSeparatorMiddleDot': 60716, 'fingeringSeparatorMiddleDotWhite': 60717, 'fingeringSeparatorSlash': 60718, 'fingeringSubstitutionAbove': 60704, 'fingeringSubstitutionBelow': 60705, 'fingeringSubstitutionDash': 60706, 'fingeringTLower': 60696, 'fingeringTUpper': 60694, 'fingeringXLower': 60701})  # doigtés en glyphes (tranche 6) ; codes lus dans glyphnames.json
CODES.update({'csymDiminished': 0xE870, 'accidentalDoubleSharp': 0xE263, 'accidentalDoubleFlat': 0xE264})  # accordéon main gauche (tranche 6) : « ° » des accords diminués
CODES.update({'segno': 0xE047, 'coda': 0xE048, 'codaSquare': 0xE049, 'segnoSerpent1': 0xE04A})  # sauts et marqueurs (tranche « sauts ») ; codes vérifiés dans glyphnames.json
CODES.update({'breathMarkComma': 0xE4CE, 'breathMarkTick': 0xE4CF, 'breathMarkUpbow': 0xE4D0, 'breathMarkSalzedo': 0xE4D5,
              'caesura': 0xE4D1, 'caesuraThick': 0xE4D2, 'caesuraShort': 0xE4D3, 'caesuraCurved': 0xE4D4, 'caesuraSingleStroke': 0xE4D7,
              'chantCaesura': 0xE8F8})  # respirations et césures (affichage) ; codes lus dans glyphnames.json de w3c/smufl (les 10 de `Breath::BREATH_LIST`)
CODES.update({'metNoteDoubleWhole': 0xECA0, 'metNoteWhole': 0xECA2, 'metNoteHalfUp': 0xECA3, 'metNoteQuarterUp': 0xECA5, 'metNote8thUp': 0xECA7,
              'metNote16thUp': 0xECA9, 'metNote32ndUp': 0xECAB, 'metNote64thUp': 0xECAD, 'metAugmentationDot': 0xECB7})  # textes de tempo (affichage) ; codes lus dans glyphnames.json
CODES.update({'dynamicPiano': 0xE520, 'dynamicForte': 0xE522, 'dynamicPP': 0xE52B, 'dynamicMP': 0xE52C, 'dynamicMF': 0xE52D, 'dynamicFF': 0xE52F, 'dynamicSforzato': 0xE539})
CODES.update({'dynamicMezzo': 0xE521, 'dynamicRinforzando': 0xE523, 'dynamicSforzando': 0xE524, 'dynamicZ': 0xE525, 'dynamicNiente': 0xE526, 'dynamicPPPPPP': 0xE527, 'dynamicPPPPP': 0xE528, 'dynamicPPPP': 0xE529, 'dynamicPPP': 0xE52A, 'dynamicPF': 0xE52E, 'dynamicFFF': 0xE530, 'dynamicFFFF': 0xE531, 'dynamicFFFFF': 0xE532, 'dynamicFFFFFF': 0xE533, 'dynamicFortePiano': 0xE534, 'dynamicForzando': 0xE535, 'dynamicSforzando1': 0xE536, 'dynamicSforzandoPiano': 0xE537, 'dynamicSforzandoPianissimo': 0xE538, 'dynamicSforzatoFF': 0xE53B, 'dynamicRinforzando1': 0xE53C, 'dynamicRinforzando2': 0xE53D})  # nuances complètes (tranche nuances) ; codes lus dans glyphnames.json (SMuFL)
CODES.update({'gClef15mb': 0xE051, 'gClef8vb': 0xE052, 'gClef8va': 0xE053, 'gClef15ma': 0xE054,
              'fClef15mb': 0xE063, 'fClef8vb': 0xE064, 'fClef8va': 0xE065, 'fClef15ma': 0xE066})  # clés d'octave (hauteur sonnante) ; codes lus dans glyphnames.json de w3c/smufl, SymId de `ClefInfo::clefTable`
CODES.update({'keyboardPedalPed': 0xE650, 'keyboardPedalUp': 0xE655, 'keyboardPedalParensLeft': 0xE676, 'keyboardPedalParensRight': 0xE677})  # pédale (affichage) : texte « Ped. », « * », « (Ped.) » ; codes lus dans glyphnames.json de w3c/smufl
CODES.update({'csymHalfDiminished': 0xE871, 'csymAugmented': 0xE872, 'csymMajorSeventh': 0xE873, 'csymMinor': 0xE874, 'csymAccidentalFlat': 0xED60, 'csymAccidentalSharp': 0xED62, 'repeat1Bar': 0xE500, 'repeat2Bars': 0xE501})  # symboles d'accord (peintre `chord`, étape 5 tranche 3) : qualités, altérations, % et %% ; codes lus dans glyphnames.json de w3c/smufl
CODES.update({'tuplet%d' % d: 0xE880 + d for d in range(10)})
CODES.update({'stringsDownBow': 0xE610, 'stringsUpBow': 0xE612})  # sens du médiator / de l'archet (articulations pickDown / pickUp) ; codes SMuFL glyphnames.json
CODES.update({'timeSigCommon': 0xE08A, 'timeSigCutCommon': 0xE08B})  # chiffrages C et C barré (SMuFL glyphnames.json)
import os
meta = json.load(open(os.environ['BRAVURA_METADATA']))['glyphsWithAnchors'] if os.environ.get('BRAVURA_METADATA') else {}
# Glyphes mis à l'échelle de la largeur d'un autre (écart voulu avec Bravura brut, retour de Jean 05/10/2026) : dans l'export MuseScore (Leland),
# la tête « charleston ouvert » (noteheadCircleX) a la MÊME largeur que la croix (noteheadXBlack : 107,578 unités des deux côtés = 1,30 sp) ;
# en Bravura brut elle est plus petite (0,996 contre 1,160 sp). Uniforme : tracé, boîte, ancres et avance sont multipliés par le même facteur.
SCALE_TO_WIDTH_OF = {'noteheadE0F3': 'noteheadTriangleDownBlack', 'noteheadSlashSmall': 'noteheadXBlack'}  # E0F3 (1,44 x 1,5 sp) ramenée à la largeur du triangle noir renversé ; (noteheadCircleX : remplacé par la vraie tête MuseScore, tools/import-musescore-head.py)
STEM_ANCHORS = ('stemUpSE', 'stemDownNW', 'stemUpNW', 'stemDownSW')
font = TTFont(sys.argv[1]); gs = font.getGlyphSet(); cmap = font.getBestCmap()
path = 'src/glyphs/bravura-subset.json'
data = json.load(open(path))
for name in sys.argv[2:]:
    gn = cmap[CODES[name]]
    bp = BoundsPen(gs); gs[gn].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    k = 1.0
    if name in SCALE_TO_WIDTH_OF:
        rb = BoundsPen(gs); gs[cmap[CODES[SCALE_TO_WIDTH_OF[name]]]].draw(rb)
        k = (rb.bounds[2] - rb.bounds[0]) / (x1 - x0)
    sp = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    gs[gn].draw(TransformPen(sp, (k, 0, 0, -k, 0, k * y1)))  # y' = y1 - y (k = 1 sauf glyphes mis à l'échelle)
    x0, y0, x1, y1 = x0 * k, y0 * k, x1 * k, y1 * k
    data['glyphs'][name] = {
        'path': sp.getCommands(),
        'bbox': {'bBoxNE': [round(x1 / 250, 3), round(y1 / 250, 3)], 'bBoxSW': [round(x0 / 250, 3), round(y0 / 250, 3)]},
        'advance': round(k * font['hmtx'][gn][0] / 250, 3),  # largeur d'avance (espaces) : répétition de glyphes (vibrato)
        'anchors': {a: [round(v[0] * k, 4), round(v[1] * k, 4)] for a, v in meta.get(name, {}).items() if a in STEM_ANCHORS or a == 'opticalCenter'},  # ancres de hampe copiées de bravura_metadata.json (BRAVURA_METADATA) ; flag32ndUp/flag32ndDown (stemUpNW/stemDownSW) complétés à la main depuis bravura_metadata.json
    }
json.dump(data, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
print('ok', sys.argv[2:])
