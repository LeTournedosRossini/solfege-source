/*
 * Sérialisation — fichier de sauvegarde JSON versionné.
 *
 *   { "format": "scorsaire", "version": 1, "idCounter": 42, "work": { …arbre des éléments… } }
 *
 * Comme les éléments sont des données pures dont `props` ne contient que les valeurs locales (écarts aux
 * défauts et aux styles), le fichier est directement l'arbre du modèle : compact, et un nouveau défaut de style
 * s'applique sans réécrire les anciens fichiers. Les identifiants sont conservés, et le compteur d'identifiants
 * est remonté au chargement pour qu'un nouvel élément ne puisse jamais entrer en collision avec un existant.
 *
 * Évolution du format : incrémenter FILE_VERSION et ajouter `MIGRATIONS[ancienneVersion] = (données) => données`.
 * Un fichier d'une version plus récente que celle du logiciel est REFUSÉ (jamais de perte silencieuse).
 */
import { idCounter, ensureIdsAtLeast, idNumber } from './ids.js';
import { ELEMENT_TYPES, STAFF_TYPES } from './schema.js';
import { createElement } from './elements.js';
import { validateWork } from './validate.js';
import { walk } from './store.js';
import { HAND_PERCUSSION_PERCMAP } from './percmap.js';
import { PID } from './pid.js';
import { getProperty } from './props.js';
import { measureLengthOf, itemDuration } from './timing.js';
import { ZERO, fAdd } from './fraction.js';
import { fermataStretch } from './tempo.js';

export const FILE_FORMAT = 'scorsaire';
export const FILE_VERSION = 57;

/** Parcourt récursivement l'arbre JSON BRUT (pas encore hydraté) d'un élément et appelle `fn(node)` sur chacun. */
function walkRaw(node, fn) {
  if (!isObj(node)) return;
  fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'props' || key === 'style' || !Array.isArray(value)) continue;
    for (const child of value) walkRaw(child, fn);
  }
}

/** { versionSource: (données) => données à la version suivante }. */
export const MIGRATIONS = {
  // v1 → v2 : PID.TIED (booléen sur note/tabnote, jamais rendu) remplacé par PID.TIES (liste, portée, ancrée par
  // identité de note) — voir claude/etape-3-suivi-et-decisions.md et pid.js. Aucun fichier réel ne portait de vraie
  // liaison (le champ n'était jamais lu ni dessiné) : la migration se contente donc de retirer le champ mort plutôt
  // que de tenter de reconstruire des PID.TIES (ce qui exigerait de deviner quelle note suit quelle note — interdit
  // par la règle du projet).
  1: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (isObj(node.props) && 'tied' in node.props) delete node.props.tied;
    });
    return { ...data, work };
  },
  // v2 → v3 : ajout de PID.TREMOLO (accord) et PID.TREMOLOS (portée) — propriétés facultatives, aucune donnée à convertir ;
  // la version est relevée pour qu'une application plus ancienne refuse un fichier qui peut contenir des trémolos.
  2: (data) => data,
  // v3 → v4 : ajout de PID.GLISSANDOS (portée) — propriété facultative, aucune donnée à convertir.
  3: (data) => data,
  // v4 → v5 : ornements (tranche 3) — `chord.graceNotes` (accords enfants), PID.GRACE_TYPE, PID.SHOW_STEM_SLASH. L'ancienne
  // propriété `graceNotes` (liste, jamais écrite ni lue) disparaît des props ; rien d'autre à convertir.
  4: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (isObj(node.props) && 'graceNotes' in node.props) delete node.props.graceNotes;
    });
    return { ...data, work };
  },
  // v5 → v6 : techniques de jeu 4d-a — PID.HOPOS (portée), PID.CHORD_LINE (accord) : propriétés facultatives, aucune donnée à convertir.
  5: (data) => data,
  // v6 → v7 : 4d-b — PID.BENDS (portée) facultatif, aucune donnée à convertir.
  6: (data) => data,
  // v7 → v8 : 4d-c — PID.TECH_LINES (portée) facultatif, aucune donnée à convertir.
  7: (data) => data,
  // v8 → v9 : 4d-d — PID.TAPPING, PID.ARPEGGIO (accord), articulations golpe/golpeThumb/slap/pop : facultatifs, aucune donnée à convertir.
  8: (data) => data,
  // v9 → v10 : 4e — PID.CAPOS, PID.STRING_TUNINGS (portée) : facultatifs, aucune donnée à convertir (PID.CAPO statique conservé : capo de la portée accord).
  9: (data) => data,
  // v10 → v11 : tranche 5 (percussion) — le son d'une note de percussion est un IDENTIFIANT anglais de la drummap (PID.SOUND, PID.PERCMAP) ;
  // la propriété `roll` (jamais lue ni dessinée) disparaît : le roulement est le trémolo (PID.TREMOLO) de l'accord, comme dans MuseScore.
  // Aucun fichier réel à convertir (confirmé par Jean, 04/10/2026).
  10: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (isObj(node.props) && 'roll' in node.props) delete node.props.roll;
    });
    return { ...data, work };
  },
  // v11 → v12 : tranche 6 (doigtés) — PID.FINGERING (objet, jamais lu ni dessiné) remplacé par PID.FINGERINGS (liste de { id, text, kind, placement? }).
  // Aucun fichier réel ne portait de doigté : la migration retire seulement l'ancien champ mort.
  11: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (isObj(node.props) && 'fingering' in node.props) delete node.props.fingering;
    });
    return { ...data, work };
  },
  // v12 → v13 : UNIFICATION de la percussion (05/10/2026, demande de Jean) — un seul type de portée `percussion` et une seule propriété `percmap`.
  //   - `drummap` (batterie) devient `percmap` (même structure) ;
  //   - une portée `handPercussion` devient `percussion` ; elle garde son jeu de sons : sa `percmap` si elle en avait une, sinon la carte
  //     « percussion à main » qui était sa valeur par défaut, écrite explicitement (la valeur par défaut de la percmap est maintenant la batterie) ;
  //   - une portée `percussion` sans carte reste sans carte : son défaut (Scorsaire Drum Kit) est inchangé.
  12: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (!isObj(node.props)) return;
      const p = node.props;
      if (p.staffType === 'handPercussion') {
        p.staffType = 'percussion';
        if (!isObj(p.percmap)) p.percmap = structuredClone(HAND_PERCUSSION_PERCMAP);
      }
      if ('drummap' in p) {
        if (p.drummap !== null && !isObj(p.percmap)) p.percmap = p.drummap;
        delete p.drummap;
      }
    });
    return { ...data, work };
  },
  // v13 → v14 : tranche 6 (accordéon main gauche) — l'élément `accevent` (jamais rendu autrement que par un espace réservé) disparaît : chaque événement
  // devient un accord ordinaire dont les notes sont des boutons `accnote` (PID.ACC_ROW + épellation), ou un silence.
  //   kind 'bass' → accord à 1 note (rang = `rank` de la basse, 2 par défaut) ; 'chord' → 1 bouton d'accord ; 'both' → basse + bouton ; 'rest' → silence.
  //   Rang d'accord : M → 3, m → 4, 7 → 5, dim → 6. Les anciens `accButtons` (accords combinés) étaient inutilisés : ignorés.
  13: (data) => {
    const work = structuredClone(data.work);
    const MIDI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const CHORD_ROWS = { M: 3, m: 4, 7: 5, dim: 6 };
    const note = (id, row, spec, octave) => {
      const alter = spec.alter ?? 0;
      const step = spec.note ?? spec.root;
      return { type: 'accnote', id, props: { accRow: row, spelling: { step, alter, octave }, pitch: 12 * (octave + 1) + MIDI[step] + alter } };
    };
    walkRaw(work, (node) => {
      if (!Array.isArray(node.items)) return;
      node.items = node.items.map((item) => {
        if (item.type !== 'accevent') return item;
        const p = item.props ?? {};
        const props = {};
        for (const k of ['duration', 'tuplet', 'beamBreak']) if (p[k] !== undefined) props[k] = p[k];
        if (p.accKind === 'rest') return { type: 'rest', id: item.id, props };
        const notes = [];
        if (p.accKind !== 'chord' && p.accBass) notes.push(note(`${item.id}b0`, p.accBass.rank ?? 2, p.accBass, 2));
        if (p.accKind !== 'bass' && p.accChord) notes.push(note(`${item.id}b1`, CHORD_ROWS[p.accChord.quality] ?? 3, p.accChord, 3));
        return { type: 'chord', id: item.id, props, notes, graceNotes: [] };
      });
    });
    return { ...data, work };
  },
  // v14 → v15 : sauts et marqueurs (`movement.jumps` / `movement.markers`), PID.REPEAT_COUNT (masterbar), PID.PAUSE (mouvement) —
  // propriétés et listes facultatives, rien à convertir ; la version est relevée pour qu'une application plus ancienne les refuse.
  14: (data) => data,
  // v15 → v16 : table de tempo de la piste système. `masterbar.props.tempo` (réel, jamais lu par aucun code) disparaît ; le Mouvement reçoit
  // `tempos` / `tempoChanges`. Un tempo est créé en début de mesure pour chaque masterbar dont le tempo local diffère du précédent
  // (le premier, s'il en a un). Les points d'orgue (articulations) gardent leur forme : `timeStretch` / `play` sont facultatifs.
  15: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (node.type !== 'movement') return;
      const tempos = Array.isArray(node.tempos) ? node.tempos : [];
      let previous = null;
      for (const bar of node.masterbars ?? []) {
        const bpm = isObj(bar.props) ? bar.props.tempo : undefined;
        if (isObj(bar.props)) delete bar.props.tempo;
        if (typeof bpm !== 'number' || bpm === previous) continue;
        previous = bpm;
        tempos.push({ type: 'tempo', id: `${bar.id}t`, props: { measureId: bar.id, position: [0, 1], tempoKind: 'normal', bpm, beatUnit: { base: 'quarter', dots: 0 } } });
      }
      node.tempos = tempos;
      if (!Array.isArray(node.tempoChanges)) node.tempoChanges = [];
    });
    return { ...data, work };
  },
  // v16 → v17 : le point d'orgue devient un signe de STRUCTURE (`movement.fermatas`, ancré par mesure + fraction), indépendant du contenu des
  // portées. Jusqu'ici la lecture le déduisait des articulations `fermata*` des accords ; chaque instant qui en portait un reçoit un élément
  // `fermata` (la sorte la plus étirante, `timeStretch` / `play` repris) pour que la durée de lecture ne change pas. Les articulations restent
  // (affichage seul : elles n'ont plus aucun effet sur la lecture).
  16: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (node.type !== 'movement') return;
      const bars = node.masterbars ?? [];
      const found = new Map(); // `${indice de mesure}|${n/d}` -> { measureId, position, art, stretch }
      for (const track of node.tracks ?? []) {
        for (const staff of track.staves ?? []) {
          if (!STAFF_TYPES[getProperty(staff, PID.STAFF_TYPE)]?.sequential) continue;
          for (const voice of staff.voices ?? []) {
            (voice.measures ?? []).forEach((measure, mi) => {
              if (mi >= bars.length) return;
              const length = measureLengthOf(bars[mi]);
              let t = ZERO;
              for (const item of measure?.items ?? []) {
                for (const a of item.props?.articulations ?? []) {
                  const stretch = fermataStretch(a) ?? 0;
                  if (stretch <= 0) continue;
                  const k = `${mi}|${t[0]}/${t[1]}`;
                  if (stretch > (found.get(k)?.stretch ?? 0)) found.set(k, { measureId: bars[mi].id, position: [...t], art: a, stretch });
                }
                t = fAdd(t, itemDuration(item, length));
              }
            });
          }
        }
      }
      const fermatas = Array.isArray(node.fermatas) ? node.fermatas : [];
      let n = 0;
      for (const { measureId, position, art } of found.values()) {
        const props = { measureId, position, fermataType: art.type };
        if (art.timeStretch !== undefined) props.timeStretch = art.timeStretch;
        fermatas.push({ type: 'fermata', id: `${measureId}f${n++}`, props });
      }
      node.fermatas = fermatas;
    });
    return { ...data, work };
  },
  // v17 → v18 : swing de la piste système (`movement.swings`) — liste facultative, rien à convertir ; la version est relevée pour qu'une application
  // plus ancienne refuse un fichier qui peut en contenir.
  17: (data) => data,
  // v18 → v19 : hauteur sonnante — `PID.PITCH` = hauteur de CONCERT ; `PID.TRANSPOSITION` devient un intervalle { diatonic, chromatic } (écrit → sonnant,
  // convention MuseScore) au lieu d'un entier jamais lu ni dessiné : l'ancien entier est retiré (aucune transposition n'était affichée, rien à convertir) ;
  // `PID.PREFER_SHARP_FLAT` (piste) et le style `concertPitch` sont facultatifs.
  18: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if (node.type === 'track' && isObj(node.props) && typeof node.props.transposition === 'number') delete node.props.transposition;
    });
    return { ...data, work };
  },
  // v19 → v20 : lignes de trille `PID.TRILLS` (portée, facultative, vide par défaut) et `ornamentStyle` facultatif d'une articulation : rien à convertir.
  19: (data) => data,
  // v20 → v21 : `glissandoStyle` et `play` facultatifs d'une entrée de PID.GLISSANDOS (lecture audio) : rien à convertir.
  20: (data) => data,
  // v21 → v22 : lecture des bends — entrées de PID.BENDS : `play`, `startTimeFactor`, `targetTimeFactor`, `endTimeFactor` facultatifs, aucune donnée à convertir.
  21: (data) => data,
  // v22 → v23 : lecture de la pédale — PID.PEDALS (portée) facultatif, vide par défaut : rien à convertir.
  22: (data) => data,
  // v23 → v24 : `PID.PLAY` facultatif sur les symboles d'accord, les accords de notes et les notes (jouer / ne pas jouer, voir play.js) : rien à convertir.
  23: (data) => data,
  // v24 → v25 : affichage de la pédale — `pedalType` et `placement` facultatifs sur les entrées de PID.PEDALS (défaut : « Ped. » + ligne, dessous) : rien à convertir.
  24: (data) => data,
  // v25 → v26 : `PID.USER_VELOCITY` facultatif sur les notes (vélocité imposée 0-127, 0 = automatique, voir pid.js) : rien à convertir.
  25: (data) => data,
  // v26 → v27 : `PID.CHORD_QUALITIES` facultatif sur l'œuvre (dictionnaire de qualités d'accord du document ; absent = les qualités intégrées) : rien à convertir.
  26: (data) => data,
  // v27 → v28 : champs facultatifs des qualités d'accord (`variants`, `shown`, `enharmonic`) et `PID.CHORD_SPELLING` de la portée d'accords : rien à convertir.
  27: (data) => data,
  // v28 → v29 : champ facultatif `gaps` des qualités d'accord (espacement entre les pièces de l'écriture) : rien à convertir.
  28: (data) => data,
  // v29 → v30 : `PID.INPUT_GRID` facultatif sur le masterbar (grille de saisie des symboles d'accord ; absent = dérivée du chiffrage) : rien à convertir.
  29: (data) => data,
  // v30 → v31 : `PID.STAFF_MOVE` facultatif sur accord et silence (portées croisées) : rien à convertir.
  30: (data) => data,
  // v31 → v32 : portée rythmique / neutre (`rhythm`, `neutral`) — leurs notes deviennent des `rhythmnote` (aucune hauteur : `pitch`, `spelling` et le reste
  // disparaissent, `play` et `userVelocity` restent) ; une portée neutre garde les têtes ordinaires (`rhythmHead: 'normal'`, défaut de sa création).
  31: (data) => {
    const work = structuredClone(data.work);
    const KEEP = ['play', 'userVelocity', 'visible', 'color'];
    const convertChord = (chord) => {
      if (!isObj(chord)) return;
      for (const list of [chord.notes, ...(Array.isArray(chord.graceNotes) ? chord.graceNotes.map((g) => g.notes) : [])]) {
        if (!Array.isArray(list)) continue;
        list.forEach((n, i) => {
          if (n.type !== 'note') return;
          const props = {};
          for (const k of KEEP) if (isObj(n.props) && k in n.props) props[k] = n.props[k];
          list[i] = { type: 'rhythmnote', id: n.id, props };
        });
        if (list.length > 1) list.length = 1; // un accord rythmique = une note
      }
    };
    walkRaw(work, (node) => {
      const t = node.props?.staffType;
      if (t !== 'rhythm' && t !== 'neutral' || !Array.isArray(node.voices)) return;
      if (t === 'neutral' && !('rhythmHead' in node.props)) node.props.rhythmHead = 'normal';
      for (const voice of node.voices) for (const m of voice.measures ?? []) for (const item of m.items ?? []) if (item.type === 'chord') convertChord(item);
    });
    return { ...data, work };
  },
  // v32 → v33 : paroles. L'ancienne propriété `lyrics` des accords (liste jamais dessinée) disparaît ; les paroles sont désormais un texte par couplet
  // sur l'œuvre (`lyricTexts`) et des liens syllabe → accord sur la portée (`lyricLinks`) — voir model/lyrics.js.
  32: (data) => {
    const work = structuredClone(data.work);
    const strip = (node) => {
      if (Array.isArray(node)) return node.forEach(strip);
      if (!isObj(node)) return;
      if (node.type === 'chord' && isObj(node.props)) delete node.props.lyrics;
      for (const v of Object.values(node)) strip(v);
    };
    strip(work);
    return { ...data, work };
  },
  // v33 → v34 : silences « trou » (`gap`, voix 2-4) ; propriété facultative, rien à convertir.
  33: (data) => data,
  // v34 → v35 : masquage du décor — PID.HIDDEN_DECOR (portée) facultatif, vide par défaut : rien à convertir.
  34: (data) => data,
  // v35 → v36 : types de crochet de MuseScore (`bracketStyle` : normal | square | line | brace, défaut normal) ; l'ancien 'thin' (défaut d'alors,
  // souvent absent du fichier) devient 'square', 'thick' devient 'normal' ; `groupBarlines` et `groupOrder` facultatifs.
  35: (data) => {
    const work = structuredClone(data.work);
    const MAP = { thin: 'square', thick: 'normal' };
    const fix = (g) => {
      if (!isObj(g)) return;
      g.props = isObj(g.props) ? g.props : {};
      g.props.bracketStyle = MAP[g.props.bracketStyle ?? 'thin'] ?? g.props.bracketStyle;
      if (Array.isArray(g.groups)) g.groups.forEach(fix);
    };
    for (const mv of work.movements ?? []) if (Array.isArray(mv.groups)) mv.groups.forEach(fix);
    return { ...data, work };
  },
  // v36 → v37 : champ facultatif `grips` des liaisons, ties, hopos et soufflets (poignées utilisateur). Migration vide.
  36: (data) => data,
  // v37 → v38 : propriété facultative `styleOverrides` d'une piste (réglages de notation propres à la piste). Migration vide.
  37: (data) => data,
  // v38 → v39 : propriété facultative `timeSigStyle` du masterbar (chiffrage écrit C ou C barré). Migration vide.
  38: (data) => data,
  // v39 → v40 : liste `rehearsalMarks` du Mouvement (repères de répétition), style SHOW_SYSTEM_OBJECTS. Migration vide.
  39: (data) => data,
  // v40 → v41 : liste facultative `staffTexts` de la portée (textes de portée, techniques de jeu). Migration vide.
  40: (data) => data,
  // v41 → v42 : propriété facultative `repeatText` du masterbar (texte « x4 » de la barre de reprise de fin). Migration vide.
  41: (data) => data,
  // v42 → v43 : the nested notation of a STACKED container (`staves`, aligned on the measures it covers) moves into a FRAGMENT (a small movement of its
  // own, one track): masterbars copied from the main measures covered (time signature, key signature…), the staves unchanged. The editor of a nested
  // score opens fragments. A container between measures never had `staves`.
  42: (data) => {
    const work = structuredClone(data.work);
    let max = 0;
    walkRaw(work, (n) => { max = Math.max(max, idNumber(n.id)); });
    const gen = (prefix) => `${prefix}${++max}`;
    const copied = [PID.TIME_SIG, PID.KEY_SIG, PID.BEAM_GROUPING, PID.MEASURE_LENGTH, PID.MEASURE_OFFSET, PID.TIME_SIG_STYLE];
    walkRaw(work, (node) => {
      if (node.type !== 'movement') return;
      const bars = node.masterbars ?? [];
      for (const track of node.tracks ?? []) {
        for (const staff of track.staves ?? []) {
          for (const c of staff.containers ?? []) {
            if (!Array.isArray(c.staves) || !c.staves.length || c.props?.containerPlacement === 'between') continue;
            const first = bars.findIndex((b) => b.id === c.props?.measureId);
            if (first < 0) continue;
            const span = c.props?.span ?? 1;
            const masterbars = bars.slice(first, first + span).map((b) => ({
              id: gen('b'), type: 'masterbar', props: Object.fromEntries(copied.filter((k) => b.props && k in b.props).map((k) => [k, structuredClone(b.props[k])])),
            }));
            c.fragments = [{ id: gen('mv'), type: 'movement', props: {}, masterbars, tracks: [{ id: gen('t'), type: 'track', props: {}, staves: c.staves }] }];
            c.staves = [];
          }
        }
      }
    });
    return { ...data, work };
  },
  // v43 → v44: the container kind `ossia` is merged into `nestedNotation` (every nested score carries the same settings: own signatures, free
  // layout, transposition, playback). New properties are optional. Migration only renames the kind.
  43: (data) => {
    const work = structuredClone(data.work);
    walkRaw(work, (node) => {
      if ((node.type === 'staffContainer' || node.type === 'systemContainer') && node.props?.containerKind === 'ossia') node.props.containerKind = 'nestedNotation';
    });
    return { ...data, work };
  },
  // v44 → v45: the work gets `parts` (print layouts, screen 2); every older file receives the default part (fixed id, the whole score, A4, margins 10 mm)
  44: (data) => {
    const work = structuredClone(data.work);
    if (!Array.isArray(work.parts) || !work.parts.length) work.parts = [{ id: 'pt0', type: 'part', props: {}, style: {} }];
    return { ...data, work };
  },
  // v45 → v46: parts may own containers (zones between systems) and staff gaps: optional, nothing to convert
  45: (data) => data,
  // v46 → v47: named views of a movement (PID.VIEWS): optional, nothing to convert
  46: (data) => data,
  // v47 → v48: the chord track (a track with a chord staff) is always the FIRST track of a movement (at most one per movement is checked on load).
  // Only the order is fixed here: a second chord track is never deleted or merged, the validator reports it.
  // v48 → v49: mixer properties (track volume and mute, master volume of the work): optional, nothing to convert
  // v49 → v50: mixer automation lanes of a track (PID.AUTOMATION): optional, nothing to convert
  49: (data) => data,
  // v50 → v51: the work may have sheets (screen 3: cells, layout, reader options): an optional list, nothing to convert (also the optional PID.WHEELS list of a staff, written pitch bends)
  50: (data) => data,
  48: (data) => data,
  // v51 → v52 : le JOUEUR AUTOMATIQUE passe de la portée d'accords à sa PISTE (`playerPattern`, `playerCard`, `playerInstrument`) : le motif, la carte et l'instrument du
  // doigté qu'une portée d'accords portait (`chordPattern`, `strumCard`, `strumInstrument`) deviennent ceux de sa piste. Les portées rythmiques gardent leur carte.
  51: (data) => {
    const work = structuredClone(data.work);
    for (const mv of work.movements ?? []) {
      for (const track of mv.tracks ?? []) {
        for (const st of track.staves ?? []) {
          if (st.props?.staffType !== 'chord' || !('chordPattern' in st.props)) continue;
          track.props = { ...(track.props ?? {}), playerPattern: st.props.chordPattern };
          if (st.props.strumCard != null) track.props.playerCard = st.props.strumCard;
          if (st.props.strumInstrument != null && st.props.strumInstrument !== 'auto') track.props.playerInstrument = st.props.strumInstrument;
          delete st.props.chordPattern; delete st.props.strumCard; delete st.props.strumInstrument;
        }
      }
    }
    return { ...data, work };
  },
  // v52 → v53 : PID.PLAYER_SEED (graine des variations d'un joueur de piste) — propriété facultative, aucune donnée à convertir ; la version est relevée pour qu'une application plus ancienne refuse un fichier qui peut en porter.
  52: (data) => data,
  // v53 → v54 : PID.PLAYER_RULES (où les variations d'un joueur de piste peuvent venir, par mesure ou par section) — propriété facultative, aucune donnée à convertir.
  53: (data) => data,
  // v54 → v55 : PID.GROOVES (grooves de batterie propres au projet) — propriété facultative, aucune donnée à convertir.
  54: (data) => data,
  // v55 → v56 : PID.STYLES (styles propres au projet) — propriété facultative, aucune donnée à convertir.
  55: (data) => data,
  // v56 → v57 : the sheet reader option `showNames` (names of the tracks: absent = as the file says) and the lock `names` — optional, nothing to convert.
  56: (data) => data,
  47: (data) => {
    const work = structuredClone(data.work);
    for (const mv of work.movements ?? []) {
      const isChord = (t) => (t.staves ?? []).some((st) => st.props?.staffType === 'chord');
      if (Array.isArray(mv.tracks)) mv.tracks = [...mv.tracks.filter(isChord), ...mv.tracks.filter((t) => !isChord(t))];
    }
    return { ...data, work };
  },
};

export class ScoreFileError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ScoreFileError';
    this.errors = errors;
  }
}

export function serializeWork(work) {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, idCounter: idCounter(), work });
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Builds a real element (with its children) from its plain JSON form. */
export function hydrate(node) {
  if (!isObj(node) || typeof node.type !== 'string' || typeof node.id !== 'string') {
    throw new ScoreFileError('Élément mal formé (id et type attendus)');
  }
  const schema = ELEMENT_TYPES[node.type];
  if (!schema) throw new ScoreFileError(`Type d'élément inconnu : ${node.type}`);
  const allowed = new Set(['id', 'type', 'props', 'style', ...Object.keys(schema.children)]);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) throw new ScoreFileError(`Champ inconnu « ${key} » dans un élément « ${node.type} » (${node.id})`);
  }
  const children = {};
  for (const key of Object.keys(schema.children)) {
    const list = node[key] ?? [];
    if (!Array.isArray(list)) throw new ScoreFileError(`« ${node.id}.${key} » doit être une liste`);
    children[key] = list.map(hydrate);
  }
  try {
    return createElement(node.type, { id: node.id, props: node.props ?? {}, children, style: node.style });
  } catch (e) {
    throw new ScoreFileError(`Élément ${node.id} (${node.type}) invalide : ${e.message}`);
  }
}

/**
 * Lit un fichier (texte JSON ou objet déjà parsé) et renvoie le Work.
 * @throws ScoreFileError  format inconnu, version trop récente ou inconnue, contenu invalide
 */
export function loadWork(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new ScoreFileError(`Fichier illisible (JSON invalide) : ${e.message}`);
    }
  }
  if (!isObj(data) || data.format !== FILE_FORMAT) {
    throw new ScoreFileError(`Ce fichier n'est pas un fichier « ${FILE_FORMAT} »`);
  }
  if (!Number.isInteger(data.version) || data.version < 1) throw new ScoreFileError(`Version de fichier invalide : ${data.version}`);
  if (data.version > FILE_VERSION) {
    throw new ScoreFileError(
      `Fichier de version ${data.version}, plus récente que celle supportée (${FILE_VERSION}) : mettre l'application à jour`
    );
  }
  while (data.version < FILE_VERSION) {
    const migrate = MIGRATIONS[data.version];
    if (!migrate) throw new ScoreFileError(`Aucune migration depuis la version ${data.version}`);
    data = { ...migrate(data), version: data.version + 1 };
  }

  if (!isObj(data.work) || data.work.type !== 'work') throw new ScoreFileError('Œuvre manquante');
  const work = hydrate(data.work);

  const errors = validateWork(work);
  if (errors.length) throw new ScoreFileError(`Fichier invalide : ${errors[0]}`, errors);

  let maxId = 0;
  walk(work, (el) => {
    maxId = Math.max(maxId, idNumber(el.id));
  });
  ensureIdsAtLeast(Math.max(maxId + 1, Number.isInteger(data.idCounter) ? data.idCounter : 0));
  return work;
}
