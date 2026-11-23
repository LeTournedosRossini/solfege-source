// The variations of an automatic player (model/player.js): a break of the drums, an approach chord of the keyboard, an extra hit. They happen with a CHANCE that depends on where the
// measure stands in the FORM (a break is likelier at the end of a section) and they follow a few RULES (not twice at the same place from one pass to the next). PURE (no DOM).
//
// Nothing is drawn at random while playing: every decision comes from a SEED saved in the player and from the identity of the place (`unit`), so the playback, the export and the
// window that writes the result as notes agree, and "draw again" is a new seed.
import { sectionSpans } from './sections.js';

/** 32-bit FNV-1a hash of a text. */
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A number in [0, 1) that depends only on the seed and the identity of the place (the same inputs always give the same number). */
export function unit(seed, id) {
  let a = (hash32(`${seed}|${id}`) + 0x6d2b79f5) >>> 0; // one round of mulberry32 on the hash
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** Bars of a phrase when the movement has no sections (a break comes at the end of a phrase of four bars). */
export const DEFAULT_PHRASE = 4;

/**
 * Where each played measure stands in the form: one entry per slot, in playing order.
 * @param mv     the movement (its sections: `sections.js`)
 * @param slots  [{ measure, … }] the played measures in order (a repeated measure appears twice)
 * @returns {{ key, occurrence, barInSection, barsLeft, sectionStart, label, category, section, measureId }[]}
 *   `key` names the PLACE (the section's label and the bar inside it: "Refrain#3"), `occurrence` counts how many times that place was reached before (0 the first time, 1 on the
 *   repeat…), `barsLeft` = bars left in the section after this one (0 = its last bar). Without sections, phrases of `phrase` bars stand for them.
 */
export function structureOfSlots(mv, slots, { phrase = DEFAULT_PHRASE } = {}) {
  const spans = sectionSpans(mv);
  const seen = new Map();
  return slots.map((slot) => {
    const mi = slot.measure;
    const span = spans.find((s) => mi >= s.from && mi <= s.to) ?? null;
    const barInSection = span ? mi - span.from : mi % phrase;
    const barsLeft = span ? span.to - mi : phrase - 1 - (mi % phrase);
    const key = `${span ? (span.label || span.category) : 'phrase'}#${barInSection}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      key, occurrence, barInSection, barsLeft, sectionStart: barInSection === 0, label: span?.label ?? '', category: span?.category ?? null,
      section: span ? (span.label || span.category) : null, measureId: mv.masterbars[mi]?.id ?? null,
    };
  });
}

/**
 * How much likelier a variation is at a place of the form: 1 in the middle of a section, up to 1 + `boost` on its last bar and 1 + `boost` / 2 on the one before.
 * @param structure an entry of `structureOfSlots` (null = no information: 1)
 */
export function structureWeight(structure, boost = 0) {
  if (!structure || !(boost > 0)) return 1;
  return 1 + boost * (structure.barsLeft === 0 ? 1 : structure.barsLeft === 1 ? 0.5 : 0);
}

/**
 * Decides, in time order, which places get a variation. A decision is made once per `id` (asking again gives the same answer).
 * @param seed the seed of the player
 * rule `noRepeat`: a place that had a variation on the previous pass (same `key`, `occurrence` − 1) does not get one again.
 */
export function createVariationPicker({ seed = 0 } = {}) {
  const decided = new Map(); // id → boolean
  const chosen = new Map(); // key → Set of occurrences that got a variation
  return {
    /**
     * @param o { id (unique identity of this decision), key (the place), occurrence, chance (0-1), weight (the structure, ≥ 0), noRepeat, rule (`ruleFor`: the user's say on this place) }
     * @returns {boolean}
     */
    decide({ id, key = id, occurrence = 0, chance = 1, weight = 1, noRepeat = false, rule = null }) {
      if (decided.has(id)) return decided.get(id);
      let yes;
      if (rule?.mode === 'never') yes = false; // the user forbade it here
      else if (rule?.mode === 'always') yes = true; // the user wants it here
      else if (noRepeat && occurrence > 0 && chosen.get(key)?.has(occurrence - 1)) yes = false;
      else {
        const p = Math.min(1, Math.max(0, chance * weight * (rule?.mode === 'factor' ? rule.factor : 1)));
        yes = p >= 1 || (p > 0 && unit(seed, `${id}|${occurrence}`) < p);
      }
      decided.set(id, yes);
      if (yes) { if (!chosen.has(key)) chosen.set(key, new Set()); chosen.get(key).add(occurrence); }
      return yes;
    },
    /** A number in [0, 1) for a choice among kinds (the same for the same seed and id). */
    pick(id) { return unit(seed, id); },
  };
}

// ---- the user's rules: WHERE the variations may come, in THIS work (stored on the player of a track, not in the card)
export const RULE_KINDS = Object.freeze(['all', 'approach', 'break', 'extra']);
export const RULE_MODES = Object.freeze(['never', 'always', 'factor']);

/** A checked rule { kind, where: { measureId } | { section }, mode, factor? } or null. `kind` 'all' covers every variation; `factor` (for 'factor') is the multiplier of the chance. */
export function createVariationRule(input) {
  const where = input?.where?.measureId ? { measureId: String(input.where.measureId) } : input?.where?.section ? { section: String(input.where.section) } : null;
  if (!where || !RULE_MODES.includes(input.mode)) return null;
  const kind = RULE_KINDS.includes(input.kind) ? input.kind : 'all';
  if (input.mode !== 'factor') return { kind, where, mode: input.mode };
  const factor = Number(input.factor);
  return Number.isFinite(factor) && factor >= 0 && factor <= 10 ? { kind, where, mode: 'factor', factor } : null;
}

export function validateVariationRules(list) {
  if (!Array.isArray(list)) return ['variation rules: list expected'];
  return list.flatMap((r, i) => (createVariationRule(r) ? [] : [`variation rule ${i}: a place (measureId or section), a mode (${RULE_MODES.join(', ')}) and, for factor, a number from 0 to 10`]));
}

/**
 * The rule that applies to a variation of `kind` at a place of the form (an entry of `structureOfSlots`): the one on THE MEASURE wins over the one on its SECTION; a rule for the kind
 * wins over one for 'all'; among equals the last one wins. null when nothing applies.
 */
export function ruleFor(rules, kind, structure) {
  if (!rules?.length || !structure) return null;
  let best = null; let bestRank = -1;
  rules.forEach((r) => {
    if (r.kind !== 'all' && r.kind !== kind) return;
    const hit = r.where.measureId ? r.where.measureId === structure.measureId : structure.section != null && r.where.section === structure.section;
    if (!hit) return;
    const rank = (r.where.measureId ? 2 : 0) + (r.kind === kind ? 1 : 0);
    if (rank >= bestRank) { best = r; bestRank = rank; }
  });
  return best ? { mode: best.mode, factor: best.factor } : null;
}

const sameWhere = (a, b) => (a.measureId ? a.measureId === b.measureId : a.section === b.section);
/** The rules with `rule` set (it replaces the one of the same place and kind). */
export const withRule = (rules, rule) => [...(rules ?? []).filter((r) => !(sameWhere(r.where, rule.where) && r.kind === rule.kind)), rule];
/** The rules without the one of this place and kind. */
export const withoutRule = (rules, where, kind = 'all') => (rules ?? []).filter((r) => !(sameWhere(r.where, where) && r.kind === kind));
