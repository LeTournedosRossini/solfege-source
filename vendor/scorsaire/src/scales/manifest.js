/*
 * The instruments for the PORTAL (`manifest.json › instruments`), so that it never writes our codes by hand:
 *   codes     one per instrument: { code, fr, en, family, views, defaultView, transposition? (semitones, written → sounding), tablature (a neck exists), staff }
 *   families  { id, fr, en, variants: [codes], default: code }: what the portal stores (« Saxophone »), the first variant being the one used when only the family is known
 *   noScale   instruments of the school that have no scale: the portal sends nothing for them
 *   none      the value of `instrument=` that says « no instrument »
 * PURE (read by `tools/publish-portail.mjs`, checked by tests).
 */
import { SCALE_INSTRUMENTS, INSTRUMENT_FAMILIES, NO_SCALE_INSTRUMENTS, TRANSPOSITION } from './instruments.js';
import { scaleText } from './i18n.js';

export function instrumentsManifest() {
  const familyOf = new Map(INSTRUMENT_FAMILIES.flatMap((f) => f.variants.map((v) => [v, f.id])));
  const codes = Object.entries(SCALE_INSTRUMENTS).map(([code, i]) => ({
    code, fr: scaleText('fr', `inst_${code}`), en: scaleText('en', `inst_${code}`), family: familyOf.get(code), views: i.views, defaultView: i.views[0],
    ...(TRANSPOSITION[code] ? { transposition: TRANSPOSITION[code] } : {}), tablature: i.views.includes('tab'),
  }));
  const families = INSTRUMENT_FAMILIES.map((f) => ({ id: f.id, fr: scaleText('fr', `fam_${f.id}`), en: scaleText('en', `fam_${f.id}`), variants: [...f.variants], default: f.variants[0] }));
  return { none: 'none', codes, families, noScale: [...NO_SCALE_INSTRUMENTS] };
}
