// Génère le tableau « propriétés modifiables par type d'élément » (registre pour les barres contextuelles de l'UI) : node tools/ui-registry.mjs > corps.md
import { PID_TABLE } from '../src/model/pid.js';
import { ELEMENT_TYPES, elementSchema } from '../src/model/schema.js';
import * as M from '../src/model/index.js';
import { Z_TYPE } from '../src/view/hit-shape.js';
const order = ['chord','note','tabnote','percnote','accnote','rest','chordsymbol','measure','masterbar','voice','staff','track','movement','work','volta','jump','marker','tempo','tempoChange','fermata','swing','systemContainer','staffContainer','group','sync'];
const out = [];
for (const t of order) {
  const s = elementSchema(t);
  const kids = Object.entries(s.children ?? {}).map(([k, v]) => `${k}: ${v.join('/')}`).join(' ; ');
  out.push(`## ${t}${kids ? `\nEnfants : ${kids}` : ''}\n\n| Propriété (pid) | Type | Valeurs / défaut | Groupe | Barre contextuelle |\n|---|---|---|---|---|`);
  for (const p of s.pids) {
    const d = PID_TABLE[p]; if (!d) continue;
    const vals = d.values ? d.values.join(' \\| ') : d.sid ? 'style' : (d.default === null || d.default === undefined ? '—' : JSON.stringify(d.default));
    const ui = p === 'play' ? 'FAIT (tranche 4) : bouton jouer/couper' : p === 'chordQualities' ? 'FAIT (tranche 5) : éditeur du dictionnaire (hors barre contextuelle)' : '';
    out.push(`| ${p} | ${d.type} | ${String(vals).slice(0, 80)} | ${d.group} | ${ui} |`);
  }
  out.push('');
}

// ---------- entrées de listes (étape 5, tranche 2 bis) : sélectionnables, retrouvées par `doc.findListEntry` ----------
// Champs relus dans les constructeurs de `model/elements.js`, `trill.js`, `pedal.js` (`?` = facultatif). Garde-fou : une démo qui porte un champ absent d'ici fait échouer le script.
const FIELDS = {
  lyric: 'textId, index, chordId, endChordId?',
  hairpin: 'startChordId, endChordId, hairpinType, voiceAssignment?',
  trill: 'startChordId, endChordId, trillType, play?, intervalAbove?, intervalBelow?, placement?',
  breath: 'afterId, breathType, pause?',
  tie: 'startNoteId, endNoteId',
  slur: 'startChordId, endChordId',
  hopo: 'startChordId, endChordId',
  bend: 'type, startNoteId, endNoteId, showHoldLine, dipVibrato?, diveTabPos?, amount?, slack?',
  techline: 'type, startChordId, endChordId, text?, vibratoType?, placement?',
  tremolo: 'startChordId, endChordId, strokes',
  glissando: 'startNoteId, endNoteId, glissandoType?, showText?, text?, glissandoStyle?, play?',
  pedal: 'startMeasureId, startPosition, endMeasureId, endPosition, play?, pedalType?, placement?',
  capo: 'itemId, fret, ignoredStrings, active, mode, text?',
  stringtuning: 'itemId, visibleStrings?, tuning?',
  fingering: 'text, kind, placement?, offset?',
};
const SHAPE = { slur: 'rectangles le long de la courbe', tie: 'rectangles le long de la courbe', hopo: 'rectangles le long de la courbe', hairpin: 'un rectangle par tronçon de ligne', techline: 'un rectangle par tronçon de ligne', pedal: 'un rectangle par tronçon de ligne', bend: 'boîte du segment (union)' };
const known = new Set(Object.values(FIELDS).flatMap((f) => f.split(', ').map((x) => x.replace('?', ''))).concat('id'));
const unknown = new Set();
for (const name of Object.keys(M).filter((k) => /^sample\w+Work$/.test(k))) {
  M.setStrict(false); M.resetIds();
  M.walk(M[name](), (el) => {
    const kinds = el.type === 'staff' ? M.STAFF_LIST_KINDS : ['note', 'tabnote', 'percnote', 'accnote'].includes(el.type) ? M.NOTE_LIST_KINDS : [];
    for (const [pid] of kinds) for (const e of el.props?.[pid] ?? []) for (const k of Object.keys(e)) if (!known.has(k)) unknown.add(`${pid}.${k}`);
  });
}
if (unknown.size) throw new Error(`champs d'entrée de liste absents de FIELDS : ${[...unknown].join(', ')}`);
const OWNER = (pid) => (M.NOTE_LIST_KINDS.some(([p]) => p === pid) ? 'note (note, tabnote, percnote, accnote)' : 'staff');
out.push('# Entrées de listes sélectionnables (tranche 2 bis)\n');
out.push('Retrouvées par identifiant avec `doc.findListEntry(id)` → `{ id, kind, owner, pid, entry, index }` (lecture seule ; toute modification = `doc.set(owner, pid, nouvelleListe)` dans une transaction). Genres d\'entrée hors de ce tableau (clefChanges, lineCountChanges, articulations, paroles) : non indexés.\n');
out.push('| Genre | Propriétaire | Propriété (pid) | Champs de l\'entrée | Forme de hit-test | Empilement (ElementType MuseScore) | Sélection | Barre contextuelle |\n|---|---|---|---|---|---|---|---|');
for (const [pid, kind] of [...M.STAFF_LIST_KINDS, ...M.NOTE_LIST_KINDS]) {
  const z = kind === 'techline' ? 'selon la technique (79 à 91)' : Z_TYPE[kind];
  out.push(`| ${kind} | ${OWNER(pid)} | ${pid} | ${FIELDS[kind]} | ${SHAPE[kind] ?? 'boîte englobante'} | ${z} | FAIT (tranche 2 bis) |  |`);
}
out.push('');
console.log(out.join('\n'));
