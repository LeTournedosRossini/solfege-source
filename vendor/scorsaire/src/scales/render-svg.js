/*
 * A scale drawn as an SVG TEXT, with no browser: what the school portal puts in an exported note (an HTML file cannot hold the component). PURE: the recipe in, a string out;
 * it runs in Node (the portal's backend) and in the page alike. The same drawings as `<scorsaire-scale>`: the neck, or the staff / tablature (through `renderNoteSvg`).
 *   renderScaleSvg(recipe, { instrument, view, system, position, width, lang, label, ink, paper }) → { svg, width, height, view, instrument, title, notes, positionLabel, credit }
 * `recipe` = the JSON of the component (an object or its text). `instrument` (id or French name) overrides the one of the recipe; with none the staff of a piano is drawn.
 * The neck uses the CSS variables of the component with fallbacks, so it is readable in a bare HTML page. `credit` = the line to write under a Berklee / CAGED position
 * (Jens Larsen), else null. Throws a `RecipeError` (`code`: 'scale' | 'root' | 'formula') for a recipe that cannot be read.
 */
import { lib, TUNINGS } from './index.js';
import { normalizeRecipe, scaleOf } from './recipe.js';
import { SCALE_INSTRUMENTS } from './instruments.js';
import { scaleNoteDocument, positionOf, wholeNeck } from './document.js';
import { keyboardSvg } from './keyboard-svg.js';
import { fretboardSvg } from './fretboard-svg.js';
import { scaleText } from './i18n.js';
import { renderNoteSvg } from '../note/render-svg.js';

export function renderScaleSvg(input, { instrument, view, system, position, width = 600, lang = 'fr', label = 'name', ink = '#000', paper = '#fff' } = {}) {
  const given = typeof input === 'string' ? JSON.parse(input) : { ...input };
  const r = normalizeRecipe({ ...given, ...(instrument ? { instrument } : {}), ...(view ? { view } : {}), ...(system ? { system } : {}), ...(position ? { position } : {}) });
  const l = lang === 'en' ? 'en' : 'fr';
  const scale = scaleOf(r); const notes = lib.notes(scale, r.root, { names: l === 'fr' ? 'solfege' : 'letters' });
  const name = lib.displayName(scale.id ?? scale, { alias: r.alias, lang: l });
  const out = { instrument: r.instrument, view: r.view, title: `${notes[0].name} ${String(name).toLowerCase()}`, notes: notes.map((n) => n.name).join(' · '), positionLabel: null, credit: null };
  const ins = SCALE_INSTRUMENTS[r.instrument];
  let pos = null;
  if (ins.family !== 'staff' && (r.view === 'tab' || r.view === 'fretboard') && !wholeNeck(r)) { try { pos = positionOf(r); } catch { pos = null; } }
  if (pos) { out.positionLabel = pos.position.label?.[l] ?? pos.position.id; if (pos.system === 'berklee' || pos.system === 'caged') out.credit = scaleText(l, 'credit'); }
  if (r.view === 'keyboard') {
    const degrees = notes.map((n, i) => ({ pc: n.pc, name: n.name, degree: String(i + 1), isRoot: i === 0 }));
    const svg = keyboardSvg({ notes: degrees, label, width: Math.max(300, Math.floor(width)), title: `${scaleText(l, 'view_keyboard')} · ${out.title}` });
    const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    return { ...out, svg, width: size ? Number(size[1]) : width, height: size ? Number(size[2]) : 0 };
  }
  if (r.view === 'fretboard' && ins.family !== 'staff') {
    const midi = TUNINGS[ins.lib].standard.midi;
    const svg = fretboardSvg({ midi, position: pos ? pos.position : null, all: pos ? null : lib.fretboard(scale, r.root, { instrument: ins.lib }).strings, label, from: pos ? null : 0, to: pos ? null : 15, width: Math.max(300, Math.floor(width)), title: `${scaleText(l, 'view_fretboard')} · ${out.title}` });
    const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    return { ...out, svg, width: size ? Number(size[1]) : width, height: size ? Number(size[2]) : 0 };
  }
  const drawn = renderNoteSvg(scaleNoteDocument(r).json, { width, ink, paper, lang });
  return { ...out, svg: drawn.svg, width: drawn.width, height: drawn.height };
}
