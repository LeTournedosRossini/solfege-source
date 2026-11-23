/*!
 * scales-lib.js : bibliothèque de gammes pour guitare et basse (sans dépendance).
 * Fonctionne dans un navigateur (window.ScaleLib), Node (require) et Google Apps Script.
 *
 *   const lib = ScaleLib.create(scalesJson, { lang: 'fr' });
 *
 * CATALOGUE
 *   lib.get('dorian')                       -> fiche de la gamme (ou null)
 *   lib.list({ level: 2 })                  -> [{ id, scale, alias, name }] (alias = clé du nom d'affichage par défaut)
 *   lib.list({ maxLevel: 3, category })     -> toutes les gammes jusqu'au niveau 3
 *   lib.search('dori')                      -> recherche sans accents sur noms et alias
 *   lib.names('major')                      -> [{ key, label, lang, isDefault }] noms au choix pour l'affichage
 *   lib.displayName('major', { alias: 'ionien' })  -> 'Ionien'
 *   lib.custom('1 2 b3 4 5 6 b7' | [0,2,3,5,7,9,10], { name })  -> gamme à formule libre
 *
 * CALCULS (scale = id, fiche du catalogue ou gamme libre ; root = 'F', 'F#', 'Bb', 'Sol'…)
 *   lib.notes(scale, root, { names: 'letters'|'solfege', accidentals: 'unicode'|'ascii' })
 *   lib.bestRoot(scale, root)               -> fondamentale enharmonique à l'orthographe la plus simple (G# -> Ab)
 *   lib.harmonize(scale, root, opts)        -> accords par degré (gammes de 7 notes ; symbol/roman = null si l'accord n'est pas usuel)
 *   lib.availableSystems(scale, opts)       -> systèmes de positions possibles
 *   lib.positions(scale, root, { system, instrument, tuningName, tuning, maxFret, octaves })
 *   lib.fretboard(scale, root, opts)        -> toutes les notes de la gamme sur le manche
 *   lib.asciiTab(position)                  -> petite tablature texte (débogage)
 *
 * Systèmes de positions :
 *   '3nps'       3 notes consécutives par corde, une position par degré de la gamme (numérotée par le degré de départ).
 *   'pentatonic' boîtes de 2 notes par corde ; la boîte 1 démarre sur la fondamentale à la corde grave (numérotation usuelle).
 *   'caged'      5 positions liées aux formes d'accords, dans l'ordre C-A-G-E-D le long du manche ; sans cordes à vide
 *                par défaut (openStrings: true pour les autoriser). Modes de la majeure et pentatoniques, guitare accordée comme la standard.
 *   'berklee'    7 positions de 17 notes, système de Jens Larsen (variante de Leavitt / Berklee), gammes de 7 notes,
 *                guitare 6 cordes accordée en quartes + tierce. Exact pour la majeure, la mélodique et l'harmonique
 *                mineure et leurs modes (diagrammes décodés) ; extrapolé selon la même règle pour les autres
 *                (champ extrapolated). Numéro = degré de départ sur la corde grave.
 *   'position'   position classique : le numéro est la case de l'index (définition de Berklee Online), 4 cases par position.
 *   'window'     boîte de N cases (width) démarrant sur chaque degré, à la corde grave.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScaleLib = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- utilitaires ----------
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SOLFEGE = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const MAJOR_PC = [0, 2, 4, 5, 7, 9, 11];
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  function mod(a, n) { return ((a % n) + n) % n; }
  function stripAccents(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function slug(s) { return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  function accString(acc, style) {
    const u = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
    const a = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
    const t = style === 'ascii' ? a : u;
    if (t[String(acc)] !== undefined) return t[String(acc)];
    const one = acc < 0 ? (style === 'ascii' ? 'b' : '♭') : (style === 'ascii' ? '#' : '♯');
    return one.repeat(Math.abs(acc));
  }

  // 'F#', 'Bb', 'Sol', 'Ré♭' -> { letter (0 = C), acc, pc }
  function parseNote(str) {
    const s = stripAccents(String(str).trim()).toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b');
    const m = /^(do|re|mi|fa|sol|la|si|[a-g])\s*(#{0,3}|b{0,3})$/.exec(s);
    if (!m) throw new Error('Note inconnue : ' + str);
    const solfege = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
    const letter = m[1].length > 1 ? solfege.indexOf(m[1]) : 'cdefgab'.indexOf(m[1]);
    const acc = m[2] ? (m[2][0] === '#' ? m[2].length : -m[2].length) : 0;
    return { letter: letter, acc: acc, pc: mod(LETTER_PC[letter] + acc, 12) };
  }

  function parseDegrees(str) {
    return String(str).trim().split(/\s+/).map(function (t) {
      const m = /^([b#]*)([1-7])$/.exec(t);
      if (!m) throw new Error('Degré invalide : ' + t);
      return { token: t, num: Number(m[2]), alt: m[1].split('#').length - 1 - (m[1].split('b').length - 1) };
    });
  }

  // Degrés conventionnels à partir d'intervalles (pour les formules libres)
  function degreesFromIntervals(iv) {
    if (iv.length === 7) {
      return iv.map(function (x, i) {
        const alt = x - MAJOR_PC[i];
        return (alt < 0 ? 'b'.repeat(-alt) : '#'.repeat(alt)) + (i + 1);
      }).join(' ');
    }
    const has = function (x) { return iv.indexOf(x) >= 0; };
    return iv.map(function (x) {
      switch (x) {
        case 0: return '1'; case 1: return 'b2'; case 2: return '2'; case 3: return 'b3';
        case 4: return '3'; case 5: return '4'; case 6: return has(5) ? 'b5' : '#4';
        case 7: return '5'; case 8: return has(7) ? 'b6' : '#5'; case 9: return '6';
        case 10: return 'b7'; default: return '7';
      }
    }).join(' ');
  }

  function intervalsFromDegrees(str) {
    return parseDegrees(str).map(function (d) { return mod(MAJOR_PC[d.num - 1] + d.alt, 12); });
  }

  // ---------- accordages (MIDI, de la corde la plus grave à la plus aiguë) ----------
  const TUNINGS = {
    guitar6: {
      standard: { midi: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'E'], fr: 'Standard (EADGBE)', en: 'Standard (EADGBE)' },
      dropD: { midi: [38, 45, 50, 55, 59, 64], names: ['D', 'A', 'D', 'G', 'B', 'E'], fr: 'Drop D (DADGBE)', en: 'Drop D (DADGBE)' },
      halfStepDown: { midi: [39, 44, 49, 54, 58, 63], names: ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'Eb'], fr: 'Demi-ton plus bas', en: 'Half step down' },
      wholeStepDown: { midi: [38, 43, 48, 53, 57, 62], names: ['D', 'G', 'C', 'F', 'A', 'D'], fr: 'Ton plus bas', en: 'Whole step down' },
      dadgad: { midi: [38, 45, 50, 55, 57, 62], names: ['D', 'A', 'D', 'G', 'A', 'D'], fr: 'DADGAD', en: 'DADGAD' },
      openG: { midi: [38, 43, 50, 55, 59, 62], names: ['D', 'G', 'D', 'G', 'B', 'D'], fr: 'Open G (DGDGBD)', en: 'Open G (DGDGBD)' },
      openD: { midi: [38, 45, 50, 54, 57, 62], names: ['D', 'A', 'D', 'F#', 'A', 'D'], fr: 'Open D (DADF#AD)', en: 'Open D (DADF#AD)' }
    },
    guitar7: {
      standard: { midi: [35, 40, 45, 50, 55, 59, 64], names: ['B', 'E', 'A', 'D', 'G', 'B', 'E'], fr: 'Standard 7 cordes (BEADGBE)', en: 'Standard 7-string (BEADGBE)' }
    },
    bass4: {
      standard: { midi: [28, 33, 38, 43], names: ['E', 'A', 'D', 'G'], fr: 'Standard (EADG)', en: 'Standard (EADG)' },
      dropD: { midi: [26, 33, 38, 43], names: ['D', 'A', 'D', 'G'], fr: 'Drop D (DADG)', en: 'Drop D (DADG)' },
      halfStepDown: { midi: [27, 32, 37, 42], names: ['Eb', 'Ab', 'Db', 'Gb'], fr: 'Demi-ton plus bas', en: 'Half step down' }
    },
    bass5: {
      standard: { midi: [23, 28, 33, 38, 43], names: ['B', 'E', 'A', 'D', 'G'], fr: 'Standard (BEADG)', en: 'Standard (BEADG)' },
      highC: { midi: [28, 33, 38, 43, 48], names: ['E', 'A', 'D', 'G', 'C'], fr: 'Si aigu (EADGC)', en: 'High C (EADGC)' }
    }
  };

  // Formes d'accords CAGED : corde de la fondamentale (0 = corde grave) et étendue en cases relative à la fondamentale
  const CAGED_SHAPES = [
    { id: 'C', rootString: 1, min: -3, max: 0 },
    { id: 'A', rootString: 1, min: 0, max: 2 },
    { id: 'G', rootString: 0, min: -3, max: 0 },
    { id: 'E', rootString: 0, min: 0, max: 2 },
    { id: 'D', rootString: 2, min: 0, max: 3 }
  ];

  // Système « 7 positions » de Jens Larsen (variante du système Leavitt / Berklee), décodé de ses diagrammes
  // pour la majeure, la mélodique mineure et l'harmonique mineure. Une position = 17 notes consécutives de la
  // gamme à partir d'un degré de la corde grave : 3 notes sur les cordes Mi grave, La, Ré et Mi aigu ; les 5 autres
  // se répartissent entre Sol et Si (3 notes sur Sol si leur écart est d'au plus 3 cases, sinon 2).
  const BERKLEE_PARENTS = [
    { id: 'major', iv: [0, 2, 4, 5, 7, 9, 11] },
    { id: 'melodic_minor', iv: [0, 2, 3, 5, 7, 9, 11] },
    { id: 'harmonic_minor', iv: [0, 2, 3, 5, 7, 8, 11] }
  ];
  // Seul écart à la règle dans les diagrammes : mineure harmonique, position 2 (Sol à 2 notes)
  const BERKLEE_G_OVERRIDE = { harmonic_minor: { 2: 2 } };

  // ---------- accords ----------
  const TRIADS = {
    '0,4,7': { q: 'maj', sym: '', upper: true, rsym: '' },
    '0,3,7': { q: 'min', sym: 'm', upper: false, rsym: '' },
    '0,3,6': { q: 'dim', sym: 'dim', upper: false, rsym: '°' },
    '0,4,8': { q: 'aug', sym: 'aug', upper: true, rsym: '+' },
    '0,4,6': { q: 'maj(b5)', sym: '(b5)', upper: true, rsym: '(b5)' }
  };
  const SEVENTHS = {
    '0,4,7,11': { q: 'maj7', sym: 'maj7', rs: 'maj7' },
    '0,4,7,10': { q: '7', sym: '7', rs: '7' },
    '0,3,7,10': { q: 'm7', sym: 'm7', rs: '7' },
    '0,3,7,11': { q: 'mMaj7', sym: 'm(maj7)', rs: 'maj7' },
    '0,3,6,10': { q: 'm7b5', sym: 'm7b5', rs: 'ø7' },
    '0,3,6,9': { q: 'dim7', sym: 'dim7', rs: '°7' },
    '0,3,6,11': { q: 'dim(maj7)', sym: 'dim(maj7)', rs: '°maj7' },
    '0,4,8,11': { q: 'maj7#5', sym: 'maj7#5', rs: 'maj7+' },
    '0,4,8,10': { q: '7#5', sym: '7#5', rs: '7+' },
    '0,4,6,10': { q: '7b5', sym: '7b5', rs: '7(b5)' },
    '0,4,6,11': { q: 'maj7b5', sym: 'maj7b5', rs: 'maj7(b5)' }
  };

  // ---------- création de la bibliothèque ----------
  function create(data, defaults) {
    defaults = defaults || {};
    const scales = data.scales.slice().sort(function (a, b) { return a.rank - b.rank; });
    const byId = new Map(scales.map(function (s) { return [s.id, s]; }));
    const famBase = {};
    (data.families || []).forEach(function (f) { famBase[f.id] = byId.get(f.base); });
    const lang0 = defaults.lang || 'fr';

    function get(id) { return byId.get(id) || null; }

    function resolve(s) {
      if (typeof s === 'string') {
        const r = byId.get(s);
        if (!r) throw new Error('Gamme inconnue : ' + s);
        return r;
      }
      if (s && s.intervals) return s;
      throw new Error('Gamme invalide');
    }

    // ----- noms -----
    function names(scaleOrId) {
      const s = resolve(scaleOrId);
      const out = []; const seenKeys = {};
      function add(label, lang, isDefault) {
        const key = slug(label);
        if (!label || seenKeys[key]) return;
        seenKeys[key] = true;
        out.push({ key: key, label: label, lang: lang, isDefault: !!isDefault });
      }
      add(s.name.fr, 'fr', lang0 === 'fr'); add(s.name.en, 'en', lang0 === 'en');
      (s.aliases.fr || []).forEach(function (a) { add(a, 'fr'); });
      (s.aliases.en || []).forEach(function (a) { add(a, 'en'); });
      return out;
    }

    function displayName(scaleOrId, o) {
      o = o || {};
      const s = resolve(scaleOrId);
      if (o.alias != null && o.alias !== '') {
        const key = slug(o.alias);
        const hit = names(s).filter(function (n) { return n.key === key; })[0];
        if (hit) return hit.label;
      }
      return s.name[o.lang || lang0] || s.name.fr;
    }

    function list(o) {
      o = o || {};
      const lang = o.lang || lang0;
      const own = []; const also = [];
      scales.forEach(function (s) {
        if (o.category && s.category !== o.category) return;
        if (o.level != null) {
          if (s.level === o.level) own.push({ id: s.id, scale: s, alias: null, name: displayName(s, { lang: lang }) });
          else if (s.also_levels && s.also_levels[String(o.level)]) {
            const alias = s.also_levels[String(o.level)];
            also.push({ id: s.id, scale: s, alias: alias, name: displayName(s, { alias: alias, lang: lang }) });
          }
        } else if (o.maxLevel == null || s.level <= o.maxLevel) {
          own.push({ id: s.id, scale: s, alias: null, name: displayName(s, { lang: lang }) });
        }
      });
      also.sort(function (a, b) { return (a.scale.mode || 0) - (b.scale.mode || 0); });
      return own.concat(also);
    }

    function search(text, o) {
      const q = slug(text);
      if (!q) return [];
      const scored = [];
      scales.forEach(function (s) {
        let best = 0;
        names(s).forEach(function (n) {
          if (n.key === q) best = Math.max(best, 3);
          else if (n.key.indexOf(q) === 0) best = Math.max(best, 2);
          else if (n.key.indexOf(q) >= 0) best = Math.max(best, 1);
        });
        if (best) scored.push({ s: s, best: best });
      });
      scored.sort(function (a, b) { return b.best - a.best || a.s.rank - b.s.rank; });
      return scored.map(function (x) { return x.s; });
    }

    // ----- gamme à formule libre -----
    function custom(formula, o) {
      o = o || {};
      let intervals; let degrees;
      if (Array.isArray(formula)) {
        if (formula.every(function (x) { return typeof x === 'number'; })) intervals = formula.slice();
        else degrees = formula.join(' ');
      } else {
        const toks = String(formula).trim().split(/[\s,]+/);
        if (toks[0] === '0') intervals = toks.map(Number);
        else degrees = toks.join(' ');
      }
      if (degrees) intervals = intervalsFromDegrees(degrees);
      if (intervals[0] !== 0) throw new Error('La formule doit commencer par la fondamentale (0 ou 1).');
      for (let i = 1; i < intervals.length; i++) {
        if (!(intervals[i] > intervals[i - 1]) || intervals[i] > 11) throw new Error('Intervalles croissants entre 0 et 11 attendus.');
      }
      if (!degrees) degrees = degreesFromIntervals(intervals);
      const steps = intervals.map(function (x, i) { return (i + 1 < intervals.length ? intervals[i + 1] : 12) - x; });
      const label = { 1: '½', 2: 'T', 3: 'T½', 4: '2T' };
      return {
        id: o.id || 'custom', custom: true, level: null, category: 'custom', family: null, mode: null, also_levels: null,
        name: { fr: o.name || 'Gamme personnalisée', en: o.name || 'Custom scale' },
        aliases: { fr: [], en: [] },
        degrees: degrees, intervals: intervals, steps: steps,
        steps_label: steps.map(function (x) { return label[x] || String(x); }).join(' '),
        notes_count: intervals.length
      };
    }

    // ----- notes et orthographe -----
    function notes(scaleOrId, rootName, o) {
      o = o || {};
      const sc = resolve(scaleOrId);
      const r = parseNote(rootName);
      const degs = parseDegrees(sc.degrees);
      if (degs.length !== sc.intervals.length) throw new Error('Degrés et intervalles incohérents : ' + sc.id);
      const letters = o.names === 'solfege' ? SOLFEGE : LETTERS;
      return sc.intervals.map(function (iv, i) {
        const L = mod(r.letter + degs[i].num - 1, 7);
        const pc = mod(r.pc + iv, 12);
        const acc = mod(pc - LETTER_PC[L] + 6, 12) - 6;
        return {
          index: i, name: letters[L] + accString(acc, o.accidentals), letter: L, acc: acc, pc: pc,
          interval: iv, degree: degs[i].token, isRoot: i === 0
        };
      });
    }

    // Fondamentale enharmonique qui donne l'orthographe la plus simple (ex. G# majeur -> Ab)
    function bestRoot(scaleOrId, rootName) {
      const sc = resolve(scaleOrId);
      const r = parseNote(rootName);
      const cands = [];
      for (let L = 0; L < 7; L++) {
        for (let acc = -1; acc <= 1; acc++) {
          if (mod(LETTER_PC[L] + acc, 12) !== r.pc) continue;
          const name = LETTERS[L] + accString(acc, 'ascii');
          const cost = notes(sc, name).reduce(function (s, x) { return s + x.acc * x.acc; }, 0);
          cands.push({ name: name, cost: cost, same: L === r.letter && acc === r.acc });
        }
      }
      cands.sort(function (a, b) { return a.cost - b.cost || (b.same ? 1 : 0) - (a.same ? 1 : 0); });
      return cands[0].name;
    }

    // ----- harmonisation (gammes de 7 notes) -----
    function harmonize(scaleOrId, rootName, o) {
      o = o || {};
      const sc = resolve(scaleOrId);
      if (sc.intervals.length !== 7) return null;
      const nts = notes(sc, rootName, o);
      const degs = parseDegrees(sc.degrees);
      return nts.map(function (n, i) {
        const idx = [i, (i + 2) % 7, (i + 4) % 7, (i + 6) % 7];
        const rel = idx.map(function (j) { return mod(nts[j].pc - n.pc, 12); });
        const tKey = rel.slice(0, 3).join(','); const sKey = rel.join(',');
        const t = TRIADS[tKey]; const sv = SEVENTHS[sKey];
        const alt = degs[i].alt;
        const pre = (alt < 0 ? '♭'.repeat(-alt) : alt > 0 ? '♯'.repeat(alt) : '');
        const num = ROMAN[degs[i].num - 1];
        const base = pre + (t && !t.upper ? num.toLowerCase() : num);
        const tNames = idx.slice(0, 3).map(function (j) { return nts[j].name; });
        const sNames = idx.map(function (j) { return nts[j].name; });
        return {
          degree: i + 1, degreeToken: degs[i].token, root: n.name,
          // symbol, quality et roman valent null quand l'empilement de tierces ne donne pas un accord usuel
          triad: {
            symbol: t ? n.name + t.sym : null, quality: t ? t.q : null,
            roman: t ? base + t.rsym : null, notes: tNames, intervals: rel.slice(0, 3)
          },
          seventh: {
            symbol: sv ? n.name + sv.sym : null, quality: sv ? sv.q : null,
            roman: sv ? base + sv.rs : null, notes: sNames, intervals: rel
          }
        };
      });
    }

    // ----- instruments -----
    function resolveTuning(o) {
      if (o.tuning && Array.isArray(o.tuning)) {
        return { midi: o.tuning.slice(), names: o.tuning.map(function (m) { return SHARP_NAMES[mod(m, 12)]; }), id: 'custom' };
      }
      const inst = TUNINGS[o.instrument || 'guitar6'];
      if (!inst) throw new Error('Instrument inconnu : ' + o.instrument);
      const t = inst[o.tuningName || 'standard'];
      if (!t) throw new Error('Accordage inconnu : ' + o.tuningName);
      return { midi: t.midi.slice(), names: t.names.slice(), id: o.tuningName || 'standard' };
    }

    function cagedParentRootPc(sc, rootPc) {
      if (!sc.family) return null;
      const base = famBase[sc.family];
      if (!base || (base.id !== 'major' && base.id !== 'major_pentatonic')) return null;
      return mod(rootPc - base.intervals[sc.mode - 1], 12);
    }

    function isGuitarLike(tun) {
      const m = tun.midi;
      if (m.length !== 6) return false;
      const want = [5, 5, 5, 4, 5];
      return want.every(function (d, i) { return m[i + 1] - m[i] === d; });
    }

    function availableSystems(scaleOrId, o) {
      o = o || {};
      const sc = resolve(scaleOrId);
      const tun = resolveTuning(o);
      const n = sc.intervals.length;
      const out = [];
      if (n >= 6) out.push({ id: '3nps', fr: '3 notes par corde', en: '3 notes per string' });
      if (n <= 6) out.push({ id: 'pentatonic', fr: 'Boîtes (2 notes par corde)', en: 'Boxes (2 notes per string)' });
      if (isGuitarLike(tun) && cagedParentRootPc(sc, 0) !== null) out.push({ id: 'caged', fr: 'CAGED', en: 'CAGED' });
      if (n === 7 && isGuitarLike(tun)) out.push({ id: 'berklee', fr: 'Berklee (7 positions)', en: 'Berklee (7 positions)' });
      out.push({ id: 'position', fr: 'Positions par case de l\'index', en: 'Positions by index-finger fret' });
      out.push({ id: 'window', fr: 'Boîte de cases', en: 'Fret window' });
      return out;
    }

    // ----- positions -----
    function buildInfo(sc, rootName, o) {
      const r = parseNote(rootName);
      const nts = notes(sc, rootName, o);
      const pcMap = new Map();
      nts.forEach(function (n) { pcMap.set(n.pc, n); });
      return { sc: sc, r: r, nts: nts, pcMap: pcMap };
    }

    function mkNote(info, midi, fret) {
      const n = info.pcMap.get(mod(midi, 12));
      return { fret: fret, midi: midi, pc: n.pc, name: n.name, degree: n.degree, interval: n.interval, index: n.index, isRoot: n.isRoot };
    }

    function emptyStrings(tun) {
      const S = tun.midi.length;
      return tun.midi.map(function (m, i) {
        return { index: i, number: S - i, open: tun.names[i], openMidi: m, notes: [] };
      });
    }

    function finish(pos) {
      let lo = Infinity; let hi = -Infinity;
      pos.strings.forEach(function (st) {
        st.notes.sort(function (a, b) { return a.fret - b.fret; });
        st.notes.forEach(function (n) { lo = Math.min(lo, n.fret); hi = Math.max(hi, n.fret); });
      });
      pos.minFret = lo; pos.maxFret = hi;
      return pos;
    }

    function shifted(pos, by, idSuffix) {
      const c = JSON.parse(JSON.stringify(pos));
      c.id = pos.id + idSuffix;
      c.strings.forEach(function (st) { st.notes.forEach(function (n) { n.fret += by; n.midi += by; }); });
      c.minFret += by; c.maxFret += by; c.octave = (pos.octave || 0) + 1;
      return c;
    }

    function npsPositions(info, tun, k, maxFret, sysId, labels) {
      const iv = info.sc.intervals; const n = iv.length; const steps = info.sc.steps; const S = tun.midi.length;
      const out = [];
      for (let d = 0; d < n; d++) {
        const degPc = mod(info.r.pc + iv[d], 12);
        const f0 = mod(degPc - tun.midi[0], 12);
        for (let shift = 0; shift <= 12; shift += 12) {
          const seq = []; let p = tun.midi[0] + f0 + shift; let idx = d;
          for (let t = 0; t < S * k; t++) { seq.push(p); p += steps[idx]; idx = (idx + 1) % n; }
          const strings = emptyStrings(tun); let ok = true;
          for (let s = 0; s < S && ok; s++) {
            for (let j = 0; j < k; j++) {
              const midi = seq[s * k + j]; const fret = midi - tun.midi[s];
              if (fret < 0 || fret > maxFret) { ok = false; break; }
              strings[s].notes.push(mkNote(info, midi, fret));
            }
          }
          if (ok) {
            out.push(finish({
              system: sysId, id: sysId + '-' + (d + 1), startIndex: d, startDegree: info.nts[d].degree, startNote: info.nts[d].name,
              label: labels(d, info.nts[d]), octave: 0, strings: strings
            }));
            break;
          }
        }
      }
      return out;
    }

    function windowPositions(info, tun, width, maxFret) {
      const n = info.sc.intervals.length; const out = [];
      for (let d = 0; d < n; d++) {
        const degPc = mod(info.r.pc + info.sc.intervals[d], 12);
        const start = mod(degPc - tun.midi[0], 12); const end = start + width - 1;
        if (end > maxFret) continue;
        const strings = emptyStrings(tun);
        strings.forEach(function (st, s) {
          for (let f = start; f <= end; f++) {
            if (info.pcMap.has(mod(tun.midi[s] + f, 12))) st.notes.push(mkNote(info, tun.midi[s] + f, f));
          }
        });
        out.push(finish({
          system: 'window', id: 'window-' + (d + 1), startIndex: d, startDegree: info.nts[d].degree, startNote: info.nts[d].name,
          label: {
            fr: 'Boîte de ' + width + ' cases, départ sur le degré ' + info.nts[d].degree,
            en: width + '-fret window, starting on degree ' + info.nts[d].degree
          },
          octave: 0, strings: strings
        }));
      }
      return out;
    }

    // Position classique : le numéro est la case de l'index (définition de Berklee Online). Les doigts 1 à 4
    // couvrent les cases p à p+3 ; en 1re position on joue aussi les cordes à vide.
    // Options : stretch (ajoute une case de chaque côté), fromPosition, toPosition, span.
    function fretPositions(info, tun, maxFret, o) {
      const span = o.span || 4; const ext = o.stretch ? 1 : 0;
      const from = o.fromPosition || 1; const to = o.toPosition || 12;
      const out = [];
      for (let p = from; p <= to; p++) {
        const lo = p === 1 ? 0 : Math.max(0, p - ext);
        const hi = p + span - 1 + ext;
        if (hi > maxFret) continue;
        const strings = emptyStrings(tun);
        strings.forEach(function (st, s) {
          for (let f = lo; f <= hi; f++) {
            if (info.pcMap.has(mod(tun.midi[s] + f, 12))) st.notes.push(mkNote(info, tun.midi[s] + f, f));
          }
        });
        out.push(finish({
          system: 'position', id: 'position-' + p, index: p, startIndex: null, startDegree: null, startNote: null,
          label: { fr: 'Position ' + p + ' (index sur la case ' + p + ')', en: 'Position ' + p + ' (index finger on fret ' + p + ')' },
          window: [lo, hi], octave: 0, strings: strings
        }));
      }
      return out;
    }

    // Système Berklee en 7 positions (voir BERKLEE_PARENTS). Numéro = degré de départ sur la corde grave (1 à 7) ;
    // chart = numéro dans les diagrammes de Larsen pour la tonalité de Do (1 = départ sur le 4e degré, 5 = sur la fondamentale).
    function berkleePositions(info, tun, maxFret, allowOpen) {
      const iv = info.sc.intervals; const minF = allowOpen ? 0 : 1; const out = [];
      function parentOf(d) {
        for (let q = 0; q < BERKLEE_PARENTS.length; q++) {
          const P = BERKLEE_PARENTS[q].iv;
          for (let k = 0; k < 7; k++) {
            let same = true;
            for (let i = 0; i < 7; i++) if (mod(P[(i + k) % 7] - P[k], 12) !== iv[i]) { same = false; break; }
            if (same) return { id: BERKLEE_PARENTS[q].id, chart: mod((d + k) % 7 - 3, 7) + 1 };
          }
        }
        return null;
      }
      for (let j = 0; j < 7; j++) {
        const d = (j + 3) % 7;
        const parent = parentOf(d);
        const over = parent && BERKLEE_G_OVERRIDE[parent.id] ? BERKLEE_G_OVERRIDE[parent.id][parent.chart] : null;
        const f0 = mod(mod(info.r.pc + iv[d], 12) - tun.midi[0] - minF, 12) + minF;
        for (let up = 0; up <= 12; up += 12) {
          const seq = []; let p = tun.midi[0] + f0 + up; let idx = d;
          for (let t = 0; t < 17; t++) { seq.push(p); const nx = (idx + 1) % 7; p += mod(iv[nx] - iv[idx], 12); idx = nx; }
          const ng = over || (seq[11] - seq[9] <= 3 ? 3 : 2);
          const counts = [3, 3, 3, ng, 5 - ng, 3];
          const strings = emptyStrings(tun); let k = 0; let ok = true;
          for (let s = 0; s < 6; s++) {
            for (let c = 0; c < counts[s]; c++) {
              const fret = seq[k] - tun.midi[s];
              if (fret < minF || fret > maxFret) ok = false;
              strings[s].notes.push(mkNote(info, seq[k], fret)); k++;
            }
          }
          if (ok) {
            out.push(finish({
              system: 'berklee', id: 'berklee-' + (d + 1), number: d + 1, chart: j + 1, startIndex: d,
              startDegree: info.nts[d].degree, startNote: info.nts[d].name, extrapolated: parent === null,
              label: {
                fr: 'Berklee (7 positions), départ sur le degré ' + info.nts[d].degree,
                en: 'Berklee (7 positions), starting on degree ' + info.nts[d].degree
              },
              octave: 0, strings: strings
            }));
            break;
          }
        }
      }
      return out;
    }

    function cagedPositions(info, tun, maxFret, widen, allowOpen, span) {
      const parent = cagedParentRootPc(info.sc, info.r.pc);
      const out = [];
      CAGED_SHAPES.forEach(function (shape) {
        const open = tun.midi[shape.rootString];
        let f = mod(parent - open, 12);
        // cagedSpan (4 ou 5 cases) : fenêtre de largeur fixe autour du cœur de la forme, étendue vers le bas puis vers le haut
        let wd = widen;
        if (span) { const extra = Math.max(0, span - (shape.max - shape.min + 1)); wd = [Math.ceil(extra / 2), Math.floor(extra / 2)]; if (extra === 1) wd = [1, 0]; }
        while (f + shape.min < 0) f += 12;
        // Les positions CAGED sont déplaçables : sans cordes à vide, on monte d'une octave (ex. Do majeur : la forme de Do à la case 12)
        if (!allowOpen && f + shape.min - wd[0] < 1) f += 12;
        const lo = Math.max(0, f + shape.min - wd[0]); const hi = f + shape.max + wd[1];
        if (hi > maxFret) return;
        const strings = emptyStrings(tun);
        strings.forEach(function (st, s) {
          for (let fr = lo; fr <= hi; fr++) {
            if (info.pcMap.has(mod(tun.midi[s] + fr, 12))) st.notes.push(mkNote(info, tun.midi[s] + fr, fr));
          }
        });
        out.push(finish({
          system: 'caged', id: 'caged-' + shape.id, shape: shape.id, startIndex: null, startDegree: null, startNote: null,
          label: { fr: 'CAGED, forme de ' + shape.id, en: 'CAGED, ' + shape.id + ' shape' },
          rootFret: f, window: [lo, hi], octave: 0, strings: strings
        }));
      });
      out.sort(function (a, b) { return a.window[0] - b.window[0]; });
      return out;
    }

    function positions(scaleOrId, rootName, o) {
      o = o || {};
      const sc = resolve(scaleOrId);
      const tun = resolveTuning(o);
      const maxFret = o.maxFret != null ? o.maxFret : 22;
      const info = buildInfo(sc, rootName, o);
      const n = sc.intervals.length;
      const system = o.system || (n === 7 ? '3nps' : n === 5 ? 'pentatonic' : 'window');
      const avail = availableSystems(sc, o).map(function (x) { return x.id; });
      if (avail.indexOf(system) < 0) throw new Error('Système « ' + system + ' » indisponible pour cette gamme ou cet accordage (disponibles : ' + avail.join(', ') + ')');
      let out;
      if (system === '3nps') {
        out = npsPositions(info, tun, 3, maxFret, '3nps', function (d, nt) {
          return { fr: '3 notes par corde, départ sur le degré ' + nt.degree, en: '3 notes per string, starting on degree ' + nt.degree };
        });
      } else if (system === 'pentatonic') {
        out = npsPositions(info, tun, 2, maxFret, 'pentatonic', function (d, nt) {
          return { fr: 'Boîte ' + (d + 1) + ' (départ sur le degré ' + nt.degree + ')', en: 'Box ' + (d + 1) + ' (starting on degree ' + nt.degree + ')' };
        });
      } else if (system === 'caged') {
        out = cagedPositions(info, tun, maxFret, o.cagedWiden || [1, 0], o.openStrings === true, o.cagedSpan === 4 || o.cagedSpan === 5 ? o.cagedSpan : 0);
      } else if (system === 'berklee') {
        out = berkleePositions(info, tun, maxFret, o.openStrings === true);
      } else if (system === 'position') {
        out = fretPositions(info, tun, maxFret, o);
      } else {
        out = windowPositions(info, tun, o.width || 5, maxFret);
      }
      if (system !== 'caged') out.sort(function (a, b) { return a.minFret - b.minFret || (a.startIndex || 0) - (b.startIndex || 0); });
      out.forEach(function (p, i) { p.order = i + 1; });
      if (o.octaves) {
        out.slice().forEach(function (p) {
          if (p.maxFret + 12 <= maxFret) out.push(shifted(p, 12, '-hi'));
        });
        out.sort(function (a, b) { return a.minFret - b.minFret; });
        out.forEach(function (p, i) { p.order = i + 1; });
      }
      return out;
    }

    function fretboard(scaleOrId, rootName, o) {
      o = o || {};
      const sc = resolve(scaleOrId);
      const tun = resolveTuning(o);
      const maxFret = o.maxFret != null ? o.maxFret : 22;
      const info = buildInfo(sc, rootName, o);
      const strings = emptyStrings(tun);
      strings.forEach(function (st, s) {
        for (let f = 0; f <= maxFret; f++) {
          if (info.pcMap.has(mod(tun.midi[s] + f, 12))) st.notes.push(mkNote(info, tun.midi[s] + f, f));
        }
      });
      return { tuning: tun, maxFret: maxFret, notes: info.nts, strings: strings };
    }

    function asciiTab(pos) {
      const S = pos.strings.length;
      const lines = pos.strings.map(function (st) { return ''; });
      pos.strings.forEach(function (st, si) {
        st.notes.forEach(function (n) {
          const cell = '-' + n.fret + (n.isRoot ? '*' : '-');
          for (let t = 0; t < S; t++) lines[t] += (t === si ? cell : '-'.repeat(cell.length));
        });
      });
      const out = [];
      for (let t = S - 1; t >= 0; t--) out.push((pos.strings[t].open + '  ').slice(0, 2) + '|' + lines[t] + '-|');
      return out.join('\n');
    }

    return {
      data: data, get: get, list: list, search: search, names: names, displayName: displayName, custom: custom,
      notes: notes, bestRoot: bestRoot, harmonize: harmonize, availableSystems: availableSystems, positions: positions,
      fretboard: fretboard, asciiTab: asciiTab, tunings: TUNINGS
    };
  }

  return { create: create, TUNINGS: TUNINGS, parseNote: parseNote, slug: slug, version: '1.0' };
}));
