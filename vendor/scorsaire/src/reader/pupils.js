/*
 * The people who play the tracks (`who=<track id>:<name>` of a reader address): the name is written next to the name of the track wherever it is shown (the panel of the tracks, the names of
 * the staves). Shared by the readers; only the copy of the work in memory is changed, the file is never written.
 */
import { PID } from '../model/pid.js';
import { SID } from '../model/sid.js';
import { getProperty } from '../model/props.js';

/** @param work the loaded work @param who { trackId: name } or null */
export function applyWho(work, who) {
  if (!who) return;
  for (const mv of work.movements) for (const tr of mv.tracks) {
    const pupil = who[tr.id]; if (!pupil) continue;
    mv.style = { ...mv.style, [SID.HIDE_INSTRUMENT_NAME_IF_ONE]: false }; // a link for ONE track must still show whose track it is
    const base = String(tr.props[PID.NAME] ?? '').trim();
    tr.props[PID.NAME] = base ? `${base} · ${pupil}` : pupil;
    const abbr = String(getProperty(tr, PID.ABBREVIATION) ?? '').trim(); // the short name (the next systems) carries it too
    tr.props[PID.ABBREVIATION] = abbr ? `${abbr} · ${pupil}` : pupil;
  }
}

/** The tracks asked for by the address that exist in `movement`, or null (all of them). */
export const startTracks = (movement, ids) => { const here = new Set(movement.tracks.map((t) => t.id)); const out = (ids ?? []).filter((id) => here.has(id)); return out.length ? out : null; };
