// Courte explication affichée après une erreur dans les jeux de lecture (REV-05) : une phrase qui dit POURQUOI, pas seulement la bonne réponse. Pur, testable sous Node.
import { FR_NOTE, SHARP_KEYS, FLAT_KEYS } from './jeux-donnees.js';

const LET = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ORDINAL = (n, masc = false) => (n === 1 ? (masc ? '1er' : '1re') : `${n}e`);

/** Où se trouve une note sur la portée : « sur la 2e ligne », « dans le 3e interligne », « sur la 1re ligne supplémentaire »… */
export function placeSurPortee(clef, nom) {
  const m = /^([A-G])(\d)$/.exec(nom); if (!m) return '';
  const base = clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2;                 // ligne du bas : Mi4 en clé de Sol, Sol2 en clé de Fa
  const pas = Number(m[2]) * 7 + LET.indexOf(m[1]) - base;                // pair = ligne, impair = interligne (0 = ligne du bas)
  const note = FR_NOTE[m[1]];
  if (pas >= 0 && pas <= 8) return pas % 2 === 0 ? `${note} est sur la ${ORDINAL(pas / 2 + 1)} ligne (en comptant depuis le bas).` : `${note} est dans le ${ORDINAL((pas + 1) / 2, true)} interligne (en comptant depuis le bas).`;
  const dessous = pas < 0, k = dessous ? -pas : pas - 8, sens = dessous ? 'sous' : 'au-dessus de';
  if (k % 2 === 0) return `${note} est sur la ${ORDINAL(k / 2)} ligne supplémentaire ${dessous ? 'sous' : 'au-dessus de'} la portée.`;
  return k === 1 ? `${note} est dans l’espace juste ${sens} la portée.` : `${note} est dans l’espace ${sens} la ${ORDINAL((k - 1) / 2)} ligne supplémentaire.`;
}

const INTERVALLES = {
  m2: ['Seconde mineure', 2, 1], M2: ['Seconde majeure', 2, 2], m3: ['Tierce mineure', 3, 3], M3: ['Tierce majeure', 3, 4], P4: ['Quarte juste', 4, 5], A4: ['Quarte augmentée (triton)', 4, 6],
  P5: ['Quinte juste', 5, 7], m6: ['Sixte mineure', 6, 8], M6: ['Sixte majeure', 6, 9], m7: ['Septième mineure', 7, 10], M7: ['Septième majeure', 7, 11], P8: ['Octave', 8, 12],
};
const ACCORDS = {
  'Majeur': 'Accord majeur : une tierce majeure puis une tierce mineure (fondamentale, tierce, quinte).',
  'Mineur': 'Accord mineur : une tierce mineure puis une tierce majeure.',
  'Septième de dominante': 'Septième de dominante : un accord majeur auquel on ajoute une septième mineure (4 notes).',
  'Septième majeure': 'Septième majeure : un accord majeur auquel on ajoute une septième majeure (4 notes).',
  'Septième mineure': 'Septième mineure : un accord mineur auquel on ajoute une septième mineure (4 notes).',
};
const DUREES = {
  'Ronde': 'La ronde vaut 4 temps : tête vide, sans hampe.', 'Blanche': 'La blanche vaut 2 temps : tête vide, avec une hampe.', 'Noire': 'La noire vaut 1 temps : tête pleine, avec une hampe.',
  'Croche': 'La croche vaut un demi-temps : tête pleine, hampe et un crochet.', 'Double-croche': 'La double-croche vaut un quart de temps : tête pleine, hampe et deux crochets.',
  'Pause': 'La pause dure 4 temps (une mesure à 4 temps) : un petit rectangle qui pend sous la 4e ligne.', 'Demi-pause': 'La demi-pause dure 2 temps : un petit rectangle posé sur la 3e ligne.',
  'Soupir': 'Le soupir dure 1 temps.', 'Demi-soupir': 'Le demi-soupir dure un demi-temps.', 'Quart de soupir': 'Le quart de soupir dure un quart de temps.',
};
const DEGRES = {
  'Tonique': '1er degré : la note qui donne son nom à la tonalité, la note de repos.', 'Sus-tonique': '2e degré : juste au-dessus de la tonique.', 'Médiante': '3e degré : au milieu entre la tonique et la dominante.',
  'Sous-dominante': '4e degré : juste au-dessous de la dominante.', 'Dominante': '5e degré : la note la plus importante après la tonique.', 'Sus-dominante': '6e degré : juste au-dessus de la dominante.',
  'Sensible': '7e degré : un demi-ton sous la tonique, elle « veut » monter vers elle.',
};
const ALTERATIONS = {
  'Dièse': 'Le dièse (♯) hausse la note d’un demi-ton : la seconde note est un demi-ton plus haut que la première.',
  'Bémol': 'Le bémol (♭) baisse la note d’un demi-ton : la seconde note est un demi-ton plus bas que la première.',
  'Bécarre': 'Le bécarre (♮) annule l’altération précédente : la note redevient naturelle.',
};
const GAMMES = {
  maj: 'Gamme majeure : T T ST T T T ST (tons et demi-tons), les demi-tons entre les degrés 3-4 et 7-8.',
  min: 'Mineure naturelle : T ST T T ST T T ; aucune note haussée, c’est la gamme de la tonalité (relative) sans altération supplémentaire.',
  harmin: 'Mineure harmonique : comme la naturelle, mais le 7e degré est haussé d’un demi-ton (la sensible) ; il y a un intervalle de 3 demi-tons entre le 6e et le 7e degré.',
  melmin: 'Mineure mélodique (à la montée) : les 6e et 7e degrés sont haussés d’un demi-ton ; c’est une gamme majeure dont seule la tierce reste mineure.',
};
const MODES = {
  Ionien: 'Ionien : c’est la gamme majeure (T T ST T T T ST).', Dorien: 'Dorien : mineur avec une sixte majeure (T ST T T T ST T) ; tierce mineure et septième mineure.',
  Phrygien: 'Phrygien : mineur avec une seconde mineure (ST T T T ST T T), couleur andalouse.', Lydien: 'Lydien : majeur avec une quarte augmentée (T T T ST T T ST).',
  Mixolydien: 'Mixolydien : majeur avec une septième mineure (T T ST T T ST T), couleur blues et rock.', 'Éolien': 'Éolien : c’est la gamme mineure naturelle (T ST T T ST T T).',
  Locrien: 'Locrien : mineur avec une seconde mineure et une quinte diminuée (ST T T ST T T T), très instable.',
};
const CADENCES = {
  Parfaite: 'Cadence parfaite : V → I, la dominante revient sur la tonique ; la conclusion la plus franche.', Plagale: 'Cadence plagale : IV → I, plus douce, la « cadence d’Amen ».',
  'Demi-cadence': 'Demi-cadence : la phrase s’arrête sur l’accord de dominante (V), en suspens, sans revenir à la tonique.', Rompue: 'Cadence rompue : V → VI, on attendait la tonique, la musique part vers la relative mineure.',
};
const ARTIC = { Staccato: 'Staccato : un point au-dessus ou en dessous de la note ; elle est jouée courte et détachée.', Legato: 'Legato : une liaison d’expression ; les notes s’enchaînent sans coupure.',
  Tenuto: 'Tenuto : un petit trait horizontal ; la note est tenue pour toute sa durée.', Accent: 'Accent : un signe « > » ; la note est jouée nettement plus fort que ses voisines.' };
const ORNEM = { Trille: 'Trille : alternance rapide et répétée avec la note juste au-dessus, noté « tr » ou par une petite vague.', Mordant: 'Mordant : un seul aller-retour très rapide avec la note du dessous.',
  'Mordant supérieur': 'Mordant supérieur (pincé) : un seul aller-retour très rapide avec la note du dessus.', Appoggiature: 'Appoggiature : une petite note d’appui avant la note principale, qui lui prend un peu de son temps.' };
const REPR = { 'Barres de reprise': 'Barres de reprise : le passage entre les deux barres se joue deux fois.', 'Première et deuxième fins': 'Première et deuxième fins : on joue la mesure du crochet 1, on reprend, puis on saute au crochet 2.',
  Segno: 'Segno : un signe auquel le « D.S. » (Dal Segno) renvoie.', Coda: 'Coda : la section finale vers laquelle on saute (« al Coda »).', 'D.C. (Da Capo)': 'D.C. (Da Capo) : « depuis le début » ; on revient tout au début du morceau.', 'D.S. (Dal Segno)': 'D.S. (Dal Segno) : « depuis le signe » ; on revient au segno.' };
const NUAN = { 'Très doux': 'pp, pianissimo : très doux.', Doux: 'p, piano : doux.', 'Assez doux': 'mp, mezzo-piano : assez doux.', 'Assez fort': 'mf, mezzo-forte : assez fort.', Fort: 'f, forte : fort.', 'Très fort': 'ff, fortissimo : très fort.',
  Crescendo: 'Crescendo (cresc. ou soufflet qui s’ouvre) : on augmente peu à peu le volume.', Decrescendo: 'Decrescendo ou diminuendo (dim. ou soufflet qui se referme) : on diminue peu à peu le volume.',
  'Très lent': 'Largo : très lent, large (40 à 60 pulsations par minute).', Lent: 'Adagio : lent, posé (60 à 76).', 'Modéré': 'Andante (76 à 108) et Moderato (108 à 120) : un tempo modéré, allant.', Vif: 'Allegro : vif, joyeux (120 à 156).', 'Très rapide': 'Presto : très rapide (168 à 200).' };
const ETRA = { 'Note de passage': 'Note de passage : elle comble l’espace d’une tierce entre deux notes de l’accord, par mouvement conjoint.', 'Note voisine': 'Note voisine (broderie) : elle s’écarte d’un degré puis revient sur la note de départ.',
  'Note de l’accord': 'Note de l’accord : une note de l’accord indiqué (fondamentale, tierce, quinte).', 'Gamme chromatique': 'Gamme chromatique : elle n’avance que par demi-tons, touches noires comprises.' };
const FORM = { 'Binaire (A B)': 'Forme binaire : deux sections contrastées, sans retour à la première.', 'Ternaire (A B A)': 'Forme ternaire : la première section revient après la section contrastante.', 'Thème et variations': 'Thème et variations : un thème repris plusieurs fois en étant transformé.' };
const FONC = { Tonique: 'Fonction tonique (repos) : les accords I, vi et iii.', 'Sous-dominante': 'Fonction sous-dominante (tension légère) : les accords IV et ii.', Dominante: 'Fonction dominante (forte tension, veut résoudre) : les accords V et vii°.' };
const CHIF = { 'Position fondamentale': 'La fondamentale est à la basse : aucun chiffre (5 3 sous-entendu).', 'Premier renversement (6)': 'La tierce est à la basse : chiffre 6 (une sixte et une tierce au-dessus de la basse).', 'Second renversement (6/4)': 'La quinte est à la basse : chiffre 6/4 (une sixte et une quarte au-dessus de la basse).' };
const DIESES = ['Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si'], BEMOLS = ['Si', 'Mi', 'La', 'Ré', 'Sol', 'Do', 'Fa'];

/** Explication d'un élément suivi (identifiant « intervalle:M3 », « note:treble:G4 », « accord:Majeur »…), ou '' si on n'en a pas. */
export function explication(e) {
  const [type, ...r] = e.split(':'), v = r.join(':');
  if (type === 'note') return placeSurPortee(r[0], r[1]);
  if (type === 'intervalle') { const i = INTERVALLES[v]; return i ? `${i[0]} : ${i[1]} notes en comptant les deux extrémités (${i[1] - 1} degré${i[1] > 2 ? 's' : ''}), ${i[2]} demi-ton${i[2] > 1 ? 's' : ''}.` : ''; }
  if (type === 'accord') return ACCORDS[v] ?? '';
  if (type === 'duree') return DUREES[v] ?? '';
  if (type === 'degre') return DEGRES[v] ?? '';
  if (type === 'alteration') return ALTERATIONS[v] ?? '';
  if (type === 'gamme') return GAMMES[v] ?? '';
  if (type === 'mode') return MODES[v] ?? '';
  if (type === 'articulation') return ARTIC[v] ?? '';
  if (type === 'ornement') return ORNEM[v] ?? '';
  if (type === 'reprise') return REPR[v] ?? '';
  if (type === 'nuance' || type === 'tempo') return NUAN[v] ?? '';
  if (type === 'note-etrangere') return ETRA[v] ?? '';
  if (type === 'forme') return FORM[v] ?? '';
  if (type === 'fonction') return FONC[v] ?? '';
  if (type === 'chiffrage') return CHIF[v] ?? '';
  if (type === 'cadence') return CADENCES[v] ?? '';
  if (type === 'transposition') { const m = /^(.+) vers le (haut|bas)$/.exec(v); return m ? `Transposer d’une ${m[1].toLowerCase()} vers le ${m[2]} : toutes les notes se déplacent du même intervalle (le dessin du motif ne change pas) et l’armure de la nouvelle tonalité est recalculée.` : ''; }
  if (type === 'tonalite') {
    const d = SHARP_KEYS.indexOf(v), b = FLAT_KEYS.indexOf(v);
    if (v === 'Do') return 'Do majeur : aucune altération à l’armure.';
    if (d > 0) return `${v} majeur : ${d} dièse${d > 1 ? 's' : ''} à l’armure (${DIESES.slice(0, d).join(', ')}).`;
    if (b > 0) return `${v} majeur : ${b} bémol${b > 1 ? 's' : ''} à l’armure (${BEMOLS.slice(0, b).join(', ')}).`;
  }
  return '';
}
