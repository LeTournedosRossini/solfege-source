#!/usr/bin/env python3
# Génère scales.json (niveaux 1 à 4). Source de vérité = la chaîne de degrés ;
# les intervalles (demi-tons) en sont dérivés puis vérifiés.
import json, re, gzip, datetime, unicodedata

BASE = {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11}


def parse(deg):
    out = []
    for t in deg.split():
        m = re.fullmatch(r'([b#]*)(\d)', t)
        assert m, f'degré invalide: {t}'
        alt = m.group(1).count('#') - m.group(1).count('b')
        out.append(BASE[int(m.group(2))] + alt)
    return out


# (id, niveau, catégorie, famille de rotation, n° de mode, nom FR, nom EN, alias FR, alias EN, degrés)
E = [
    # ---------- NIVEAU 1 : essentielles ----------
    ("major", 1, "diatonic", "diatonic", 1, "Majeure", "Major", ["Ionien", "Mode ionien"], ["Ionian"], "1 2 3 4 5 6 7"),
    ("natural_minor", 1, "diatonic", "diatonic", 6, "Mineure naturelle", "Natural minor", ["Éolien", "Mode éolien", "Mineur naturel"], ["Aeolian", "Minor"], "1 2 b3 4 5 b6 b7"),
    ("major_pentatonic", 1, "pentatonic", "pentatonic", 1, "Pentatonique majeure", "Major pentatonic", [], [], "1 2 3 5 6"),
    ("minor_pentatonic", 1, "pentatonic", "pentatonic", 5, "Pentatonique mineure", "Minor pentatonic", [], [], "1 b3 4 5 b7"),
    ("blues_minor", 1, "blues", None, None, "Blues (mineure)", "Blues scale", ["Gamme blues", "Blues mineur"], ["Minor blues"], "1 b3 4 b5 5 b7"),

    # ---------- NIVEAU 2 : modes de l'Église ----------
    ("dorian", 2, "diatonic", "diatonic", 2, "Dorien", "Dorian", ["Mode dorien"], [], "1 2 b3 4 5 6 b7"),
    ("mixolydian", 2, "diatonic", "diatonic", 5, "Mixolydien", "Mixolydian", ["Mode mixolydien", "Gamme de dominante"], ["Dominant scale"], "1 2 3 4 5 6 b7"),
    ("lydian", 2, "diatonic", "diatonic", 4, "Lydien", "Lydian", ["Mode lydien"], [], "1 2 3 #4 5 6 7"),
    ("phrygian", 2, "diatonic", "diatonic", 3, "Phrygien", "Phrygian", ["Mode phrygien"], ["Kurd (maqam)"], "1 b2 b3 4 5 b6 b7"),
    ("locrian", 2, "diatonic", "diatonic", 7, "Locrien", "Locrian", ["Mode locrien"], [], "1 b2 b3 4 b5 b6 b7"),

    # ---------- NIVEAU 3 : jazz / classique ----------
    ("melodic_minor", 3, "melodic_minor", "melodic_minor", 1, "Mineure mélodique", "Melodic minor", ["Mineure mélodique ascendante", "Mineure jazz"], ["Jazz minor", "Ascending melodic minor"], "1 2 b3 4 5 6 7"),
    ("harmonic_minor", 3, "harmonic_minor", "harmonic_minor", 1, "Mineure harmonique", "Harmonic minor", [], ["Nahawand (maqam)"], "1 2 b3 4 5 b6 7"),
    ("lydian_dominant", 3, "melodic_minor", "melodic_minor", 4, "Lydien dominant", "Lydian dominant", ["Lydien ♭7", "Mixolydien ♯11", "Gamme acoustique"], ["Lydian ♭7", "Overtone scale", "Acoustic scale", "Mixolydian ♯4"], "1 2 3 #4 5 6 b7"),
    ("altered", 3, "melodic_minor", "melodic_minor", 7, "Altérée", "Altered", ["Gamme altérée", "Super locrien", "Diminuée tons entiers"], ["Super Locrian", "Diminished whole tone"], "1 b2 b3 b4 b5 b6 b7"),
    ("phrygian_dominant", 3, "harmonic_minor", "harmonic_minor", 5, "Phrygien dominant", "Phrygian dominant", ["Mixolydien ♭9 ♭13", "Gamme espagnole", "Hijaz"], ["Spanish Phrygian", "Freygish", "Hijaz"], "1 b2 3 4 5 b6 b7"),
    ("locrian_n2", 3, "melodic_minor", "melodic_minor", 6, "Locrien ♮2", "Locrian ♮2", ["Demi-diminué", "Éolien ♭5"], ["Half-diminished", "Aeolian ♭5"], "1 2 b3 4 b5 b6 b7"),
    ("mixolydian_b6", 3, "melodic_minor", "melodic_minor", 5, "Mixolydien ♭6", "Mixolydian ♭6", ["Éolien majeur", "Gamme hindoue", "Majeure mélodique"], ["Aeolian dominant", "Hindu scale", "Melodic major"], "1 2 3 4 5 b6 b7"),
    ("lydian_augmented", 3, "melodic_minor", "melodic_minor", 3, "Lydien augmenté", "Lydian augmented", ["Lydien ♯5"], ["Lydian ♯5"], "1 2 3 #4 #5 6 7"),
    ("whole_tone", 3, "symmetric", "whole_tone", 1, "Gamme par tons", "Whole tone", ["Gamme par tons entiers"], ["Whole-tone scale"], "1 2 3 #4 #5 b7"),
    ("diminished_hw", 3, "symmetric", "diminished", 2, "Diminuée (demi-ton–ton)", "Diminished (half-whole)", ["Dominante diminuée", "Octatonique demi-ton–ton"], ["Dominant diminished", "Octatonic half-whole"], "1 b2 b3 3 #4 5 6 b7"),
    ("diminished_wh", 3, "symmetric", "diminished", 1, "Diminuée (ton–demi-ton)", "Diminished (whole-half)", ["Octatonique ton–demi-ton"], ["Octatonic whole-half"], "1 2 b3 4 b5 b6 6 7"),
    ("augmented", 3, "symmetric", "augmented", 1, "Gamme augmentée", "Augmented scale", ["Hexatonique augmentée"], ["Hexatonic augmented"], "1 b3 3 5 #5 7"),
    ("bebop_dominant", 3, "bebop", None, None, "Bebop dominante", "Bebop dominant", ["Gamme bebop de dominante"], ["Bebop scale"], "1 2 3 4 5 6 b7 7"),
    ("bebop_major", 3, "bebop", None, None, "Bebop majeure", "Bebop major", [], [], "1 2 3 4 5 b6 6 7"),
    ("bebop_dorian", 3, "bebop", None, None, "Bebop dorienne", "Bebop dorian", ["Bebop mineure"], ["Bebop minor"], "1 2 b3 3 4 5 6 b7"),
    ("blues_major", 3, "blues", None, None, "Blues majeur", "Major blues", ["Gamme blues majeure"], ["Major blues scale"], "1 2 b3 3 5 6"),

    # ---------- NIVEAU 4 : autres modes et gammes du monde ----------
    ("dorian_b2", 4, "melodic_minor", "melodic_minor", 2, "Dorien ♭2", "Dorian ♭2", ["Phrygien ♮6"], ["Phrygian ♮6", "Javanese"], "1 b2 b3 4 5 6 b7"),
    ("locrian_n6", 4, "harmonic_minor", "harmonic_minor", 2, "Locrien ♮6", "Locrian ♮6", [], [], "1 b2 b3 4 b5 6 b7"),
    ("ionian_s5", 4, "harmonic_minor", "harmonic_minor", 3, "Ionien ♯5", "Ionian ♯5", ["Majeure augmentée"], ["Ionian augmented"], "1 2 3 4 #5 6 7"),
    ("dorian_s4", 4, "harmonic_minor", "harmonic_minor", 4, "Dorien ♯4", "Dorian ♯4", ["Mineur roumain", "Dorien ukrainien"], ["Romanian minor", "Ukrainian Dorian", "Nikriz (maqam)"], "1 2 b3 #4 5 6 b7"),
    ("lydian_s2", 4, "harmonic_minor", "harmonic_minor", 6, "Lydien ♯2", "Lydian ♯2", [], [], "1 #2 3 #4 5 6 7"),
    ("ultralocrian", 4, "harmonic_minor", "harmonic_minor", 7, "Ultralocrien", "Ultralocrian", ["Super locrien ♭♭7"], ["Superlocrian ♭♭7"], "1 b2 b3 b4 b5 b6 bb7"),

    ("harmonic_major", 4, "harmonic_major", "harmonic_major", 1, "Majeure harmonique", "Harmonic major", [], [], "1 2 3 4 5 b6 7"),
    ("dorian_b5", 4, "harmonic_major", "harmonic_major", 2, "Dorien ♭5", "Dorian ♭5", [], [], "1 2 b3 4 b5 6 b7"),
    ("phrygian_b4", 4, "harmonic_major", "harmonic_major", 3, "Phrygien ♭4", "Phrygian ♭4", [], [], "1 b2 b3 b4 5 b6 b7"),
    ("lydian_b3", 4, "harmonic_major", "harmonic_major", 4, "Lydien ♭3", "Lydian ♭3", [], [], "1 2 b3 #4 5 6 7"),
    ("mixolydian_b2", 4, "harmonic_major", "harmonic_major", 5, "Mixolydien ♭2", "Mixolydian ♭2", [], [], "1 b2 3 4 5 6 b7"),
    ("lydian_augmented_s2", 4, "harmonic_major", "harmonic_major", 6, "Lydien augmenté ♯2", "Lydian augmented ♯2", [], [], "1 #2 3 #4 #5 6 7"),
    ("locrian_bb7", 4, "harmonic_major", "harmonic_major", 7, "Locrien ♭♭7", "Locrian ♭♭7", ["Locrien diminué"], [], "1 b2 b3 4 b5 b6 bb7"),

    ("double_harmonic_major", 4, "double_harmonic", "double_harmonic", 1, "Double harmonique majeure", "Double harmonic major", ["Gamme byzantine", "Gamme arabe", "Majeure tzigane"], ["Byzantine scale", "Arabic scale", "Gypsy major", "Bhairav", "Hijaz Kar"], "1 b2 3 4 5 b6 7"),
    ("lydian_s2_s6", 4, "double_harmonic", "double_harmonic", 2, "Lydien ♯2 ♯6", "Lydian ♯2 ♯6", [], [], "1 #2 3 #4 5 #6 7"),
    ("ultraphrygian", 4, "double_harmonic", "double_harmonic", 3, "Ultraphrygien", "Ultraphrygian", [], [], "1 b2 b3 b4 5 b6 bb7"),
    ("hungarian_minor", 4, "double_harmonic", "double_harmonic", 4, "Mineure hongroise", "Hungarian minor", ["Double harmonique mineure", "Mineure tzigane"], ["Double harmonic minor", "Gypsy minor"], "1 2 b3 #4 5 b6 7"),
    ("oriental", 4, "double_harmonic", "double_harmonic", 5, "Orientale", "Oriental", [], [], "1 b2 3 4 b5 6 b7"),
    ("ionian_s2_s5", 4, "double_harmonic", "double_harmonic", 6, "Ionien ♯2 ♯5", "Ionian ♯2 ♯5", [], [], "1 #2 3 4 #5 6 7"),
    ("locrian_bb3_bb7", 4, "double_harmonic", "double_harmonic", 7, "Locrien ♭♭3 ♭♭7", "Locrian ♭♭3 ♭♭7", [], [], "1 b2 bb3 4 b5 b6 bb7"),

    ("suspended_pentatonic", 4, "pentatonic", "pentatonic", 2, "Pentatonique suspendue", "Suspended pentatonic", ["Pentatonique égyptienne"], ["Egyptian pentatonic"], "1 2 4 5 b7"),
    ("man_gong", 4, "pentatonic", "pentatonic", 3, "Pentatonique Man Gong", "Man Gong pentatonic", [], ["Man Gong", "Pentatonic mode 3"], "1 b3 4 b6 b7"),
    ("ritusen", 4, "pentatonic", "pentatonic", 4, "Pentatonique Ritusen", "Ritusen pentatonic", ["Yo (japonaise)", "Ryo"], ["Ritusen", "Yo scale"], "1 2 4 5 6"),

    ("hungarian_major", 4, "world", None, None, "Majeure hongroise", "Hungarian major", [], [], "1 #2 3 #4 5 6 b7"),
    ("neapolitan_minor", 4, "other", None, None, "Mineure napolitaine", "Neapolitan minor", [], [], "1 b2 b3 4 5 b6 7"),
    ("neapolitan_major", 4, "other", None, None, "Majeure napolitaine", "Neapolitan major", [], [], "1 b2 b3 4 5 6 7"),
    ("persian", 4, "world", None, None, "Persane", "Persian", ["Gamme persane"], ["Persian scale"], "1 b2 3 4 b5 b6 7"),
    ("enigmatic", 4, "other", None, None, "Énigmatique", "Enigmatic", ["Gamme énigmatique"], ["Enigmatic scale"], "1 b2 3 #4 #5 #6 7"),
    ("prometheus", 4, "other", None, None, "Prométhée", "Prometheus", ["Gamme prométhéenne"], ["Prometheus scale", "Mystic chord scale"], "1 2 3 #4 6 b7"),
    ("prometheus_neapolitan", 4, "other", None, None, "Prométhée napolitaine", "Prometheus Neapolitan", [], [], "1 b2 3 #4 6 b7"),
    ("tritone_scale", 4, "other", None, None, "Gamme du triton", "Tritone scale", [], [], "1 b2 3 b5 5 b7"),
    ("leading_whole_tone", 4, "other", None, None, "Tons entiers de sensible", "Leading whole tone", [], [], "1 2 3 #4 #5 #6 7"),
    ("lydian_minor", 4, "other", None, None, "Lydien mineur", "Lydian minor", ["Majeure ♯4 ♭6"], [], "1 2 3 #4 5 b6 b7"),
    ("locrian_major", 4, "other", None, None, "Locrien majeur", "Locrian major", ["Gamme arabe (mode)"], ["Arabian scale"], "1 2 3 4 b5 b6 b7"),
    ("spanish_8", 4, "world", None, None, "Gamme espagnole (8 notes)", "Spanish 8-note scale", [], ["Spanish octatonic"], "1 b2 b3 3 4 b5 b6 b7"),

    ("hirajoshi", 4, "world", None, None, "Hirajoshi", "Hirajoshi", [], [], "1 2 b3 5 b6"),
    ("in_sen", 4, "world", None, None, "In Sen", "In Sen", ["Insen"], ["Insen"], "1 b2 4 5 b7"),
    ("iwato", 4, "world", None, None, "Iwato", "Iwato", [], [], "1 b2 4 b5 b7"),
    ("kumoi", 4, "world", None, None, "Kumoi", "Kumoi", [], [], "1 2 b3 5 6"),
    ("pelog", 4, "world", None, None, "Pelog", "Pelog", ["Pelog balinais"], ["Balinese pelog"], "1 b2 b3 5 b6"),
    ("chinese", 4, "world", None, None, "Pentatonique lydienne (chinoise)", "Chinese / Lydian pentatonic", [], ["Chinese scale", "Lydian pentatonic"], "1 3 #4 5 7"),

    ("poorvi", 4, "world", None, None, "Poorvi (thaat)", "Poorvi (thaat)", ["Purvi"], ["Purvi"], "1 b2 3 #4 5 b6 7"),
    ("marwa", 4, "world", None, None, "Marwa (thaat)", "Marwa (thaat)", ["Marva"], ["Marva"], "1 b2 3 #4 5 6 7"),
    ("todi", 4, "world", None, None, "Todi (thaat)", "Todi (thaat)", [], [], "1 b2 b3 #4 5 b6 7"),

    ("major_hexatonic", 4, "other", None, None, "Hexatonique majeure", "Major hexatonic", [], [], "1 2 3 4 5 6"),
    ("minor_hexatonic", 4, "other", None, None, "Hexatonique mineure", "Minor hexatonic", [], [], "1 2 b3 4 5 b7"),
]

CATEGORIES = {
    "diatonic": ("Majeure et modes diatoniques", "Major and diatonic modes"),
    "pentatonic": ("Pentatoniques", "Pentatonic"),
    "blues": ("Blues", "Blues"),
    "melodic_minor": ("Mineure mélodique et ses modes", "Melodic minor and its modes"),
    "harmonic_minor": ("Mineure harmonique et ses modes", "Harmonic minor and its modes"),
    "harmonic_major": ("Majeure harmonique et ses modes", "Harmonic major and its modes"),
    "symmetric": ("Gammes symétriques", "Symmetric scales"),
    "bebop": ("Gammes bebop", "Bebop scales"),
    "double_harmonic": ("Double harmonique et ses modes", "Double harmonic and its modes"),
    "world": ("Gammes du monde", "World scales"),
    "other": ("Autres gammes", "Other scales"),
}

LEVELS = {
    "1": ("Essentielles", "Essentials"),
    "2": ("Modes de l'Église", "Church modes"),
    "3": ("Jazz et classique", "Jazz and classical"),
    "4": ("Autres modes et gammes du monde", "Other modes and world scales"),
}


def step_label(s):
    return {1: "½", 2: "T", 3: "T½", 4: "2T"}.get(s, str(s))


def slug(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# Gammes listées aussi à un autre niveau, sous un de leurs alias (clé = slug de l'alias).
# Ex. la majeure apparaît au niveau 2 (modes de l'Église) sous le nom « Ionien ».
ALSO_LEVELS = {"major": {"2": "ionien"}, "natural_minor": {"2": "eolien"}}

scales = []
ids = set()
seen = {}
for (sid, lvl, cat, fam, mode, fr, en, afr, aen, deg) in E:
    assert sid not in ids, f'id dupliqué: {sid}'
    ids.add(sid)
    assert cat in CATEGORIES, cat
    iv = parse(deg)
    assert iv[0] == 0, sid
    assert all(b > a for a, b in zip(iv, iv[1:])), f'ordre non croissant: {sid} {iv}'
    assert iv[-1] < 12, sid
    key = tuple(iv)
    assert key not in seen, f'intervalles identiques: {sid} = {seen[key]}'
    seen[key] = sid
    steps = [b - a for a, b in zip(iv, iv[1:] + [12])]
    assert sum(steps) == 12
    scales.append(dict(
        id=sid, level=lvl, category=cat, family=fam, mode=mode, also_levels=ALSO_LEVELS.get(sid),
        name={"fr": fr, "en": en}, aliases={"fr": afr, "en": aen},
        degrees=deg, intervals=iv, steps=steps,
        steps_label=" ".join(step_label(s) for s in steps),
        notes_count=len(iv),
    ))

# Les alias référencés par also_levels doivent exister
for sid, d in ALSO_LEVELS.items():
    s = next(x for x in scales if x["id"] == sid)
    keys = {slug(n) for n in [s["name"]["fr"], s["name"]["en"]] + s["aliases"]["fr"] + s["aliases"]["en"]}
    for lvl, a in d.items():
        assert a in keys, f'alias inconnu pour {sid}: {a}'

# Vérification des rotations (modes d'une même famille)
base = {s["family"]: s for s in scales if s["family"] and s["mode"] == 1}
for s in scales:
    if not s["family"]:
        continue
    B = base[s["family"]]["intervals"]
    n = len(B)
    k = s["mode"] - 1
    assert k < n, s["id"]
    rot = [(B[(k + i) % n] - B[k]) % 12 for i in range(n)]
    assert rot == s["intervals"], f'rotation incohérente: {s["id"]} {rot} vs {s["intervals"]}'

# Tri : niveau puis ordre de saisie (= popularité décroissante dans le niveau)
scales.sort(key=lambda s: s["level"])
for i, s in enumerate(scales, 1):
    s["rank"] = i

families = []
for fam, b in base.items():
    mem = sorted([s for s in scales if s["family"] == fam], key=lambda s: s["mode"])
    families.append({"id": fam, "base": b["id"], "modes": [s["id"] for s in mem]})

meta = {
    "version": "1.0",
    "generated": datetime.date.today().isoformat(),
    "description": "Catalogue de gammes pour application pédagogique, niveaux 1 à 4. Toutes les formules sont relatives à la fondamentale.",
    "conventions": {
        "intervals": "demi-tons depuis la fondamentale (0 = fondamentale)",
        "steps": "écarts successifs en demi-tons, le dernier ramenant à l'octave (somme = 12)",
        "steps_label": "T = ton, ½ = demi-ton, T½ = ton et demi, 2T = deux tons",
        "degrees": "degrés relatifs à la gamme majeure : b = bémol, # = dièse, bb = double bémol. Sert aussi à l'orthographe des notes. Pour les gammes de plus de 7 notes ou ambiguës (triton), c'est une convention.",
        "family_mode": "family regroupe les gammes qui sont des rotations les unes des autres ; mode = numéro du mode dans la famille (1 = mode de base). null si la gamme n'appartient à aucune famille de modes.",
        "names": "le nom affiché d'une gamme se choisit parmi name.fr, name.en et aliases. Une affectation stocke la clé de l'alias choisi (slug : sans accents, minuscules, tirets), par exemple 'ionien' pour la majeure. Une gamme est unique ; seul son nom d'affichage change.",
        "also_levels": "si non null, la gamme est aussi listée à ces niveaux, sous l'alias dont la clé est donnée (ex. major listée au niveau 2 sous 'ionien'). Elle garde son niveau principal (level).",
        "rank": "classement global, du plus courant au plus rare (niveau puis popularité dans le niveau)",
    },
    "levels": {k: {"fr": v[0], "en": v[1]} for k, v in LEVELS.items()},
    "categories": {k: {"fr": v[0], "en": v[1]} for k, v in CATEGORIES.items()},
}

lines = ['{', '"meta": ' + json.dumps(meta, ensure_ascii=False, indent=1) + ',',
         '"families": [']
lines.append(",\n".join(json.dumps(f, ensure_ascii=False) for f in families))
lines.append('],')
lines.append('"scales": [')
lines.append(",\n".join(json.dumps(s, ensure_ascii=False) for s in scales))
lines.append(']')
lines.append('}')
text = "\n".join(lines) + "\n"
json.loads(text)  # validation syntaxique

with open("scales.json", "w", encoding="utf-8") as f:
    f.write(text)

by_level = {}
for s in scales:
    by_level[s["level"]] = by_level.get(s["level"], 0) + 1
print("par niveau:", by_level, "total:", len(scales))
print("familles:", len(families))
print("taille:", len(text.encode("utf-8")), "octets ; gzip:", len(gzip.compress(text.encode("utf-8"))))
print("OK : rotations, doublons et ordre vérifiés")
