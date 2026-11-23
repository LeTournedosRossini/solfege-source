/*
 * Playing-technique texts that have NO other codification in the model (articulations, technique lines, chord properties and note flags already
 * play differently and are not repeated here). A technique text of a staff is a staff text with a `technique` id: besides being drawn, it
 * sends a message to the player at its instant — `{ kind: 'technique', data: { technique } }`, or the message the user mapped to it
 * (`options.techniqueRules[id] = { kind, data }`, e.g. `{ kind: 'keyswitch', data: { note: 24 } }` for a sampler). Pure data.
 */
export const TECHNIQUES = Object.freeze([
  { id: 'pizz', text: 'pizz.' },
  { id: 'arco', text: 'arco' },
  { id: 'conSord', text: 'con sord.' },
  { id: 'senzaSord', text: 'senza sord.' },
  { id: 'colLegno', text: 'col legno' },
  { id: 'sulPont', text: 'sul pont.' },
  { id: 'sulTasto', text: 'sul tasto' },
  { id: 'ord', text: 'ord.' },
  { id: 'flz', text: 'flz.' },
  { id: 'solo', text: 'solo' },
  { id: 'tutti', text: 'tutti' },
  // rotary speaker (Leslie) of an organ: the rotor speed from here on (audio/leslie.js); sent as `{ kind: 'leslie', data: { mode } }`, not as a technique
  { id: 'leslieChorale', text: 'Chorale' },
  { id: 'leslieTremolo', text: 'Tremolo' },
  { id: 'leslieBrake', text: 'Brake' },
]);
const BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));
export const techniqueText = (id) => BY_ID.get(id)?.text ?? null;
export const isTechnique = (id) => BY_ID.has(id);
