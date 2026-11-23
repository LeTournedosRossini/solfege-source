// Chord-pattern hits played by a FRETTED instrument (guitar, ukulele, bass). PURE (no DOM, no document). The sibling of `comping.js` for the piano: the same hits
// (`chordpatterns.js`, written in chord degrees) but the notes are placed on the neck of the fingering the chord has been given (`model/fretriff.js`).
//   - `C`  the whole fingering, strummed (a down stroke, or an up stroke with a pick-up sign; the delay and the falling velocity are the card's);
//   - `B`  the lowest note of the fingering (the named bass of a slash chord when the card follows it);
//   - a degree ("3", "b7", "9"): placed near the hand by `placeRiffHit`; the hand (`L` prefix) and the octave shift mean nothing on a fretted instrument and are ignored.
// Without a fingering (no chord shape for this chord) the notes are played as on a keyboard, at the pitch they have above the root.
import { strokeNotes, strokeDirection, voicingStrings, autoDelayMs, STRUM_DEFAULTS } from './strum.js';
import { COMPING_DEFAULTS, degreeSemis, bassNote } from './comping.js';
import { placeRiffHit } from '../model/fretriff.js';

/**
 * @param events [{ t, kind: 'chord', id, dur?, parts, articulations?, bpm? }] sorted by time (s), the hits of the pattern
 * @param ctx    { chordAt(t) → { voicing | pitches, until } | null (the fingering), compAt(t) → { spec, until } | null (the chord), end, options }
 * @returns {{ pitch, t, duration, velocity, string: number | null, fret: number | null, source, event }[]}
 *   `string` is the index in the tuning of the fingering (0 = the lowest string), null for a note played as on a keyboard.
 */
export function planPick(events, ctx) {
  const o = { ...STRUM_DEFAULTS, ...COMPING_DEFAULTS, ...(ctx.options ?? {}) };
  const out = [];
  events.forEach((ev, i) => {
    if (ev.kind !== 'chord') return;
    const comp = ctx.compAt(ev.t);
    if (!comp?.spec) return;
    const fingering = ctx.chordAt(ev.t);
    let end = events[i + 1]?.t ?? ctx.end;
    if (ev.dur != null && ev.t + ev.dur < end) end = ev.t + ev.dur; // a pattern hit has its own length
    if (comp.until != null && comp.until < end) end = comp.until;
    if (!(end > ev.t)) return;
    const arts = ev.articulations ?? [];
    const accent = arts.includes('accent') || arts.includes('marcato') || arts.includes('accentStaccato');
    const staccato = arts.includes('staccato') || arts.includes('staccatissimo') || arts.includes('accentStaccato');
    const length = Math.min(end - ev.t, staccato ? o.staccatoDuration : Infinity);
    const factor = accent ? o.accentBoost : 1;
    const voicing = fingering?.voicing ?? null;
    const strings = voicing ? voicingStrings(voicing) : [];
    // a note already sounded by this hit (the bass inside the strummed chord, a degree the shape already holds) is not struck twice
    const seen = new Set();
    const push = (n) => {
      const key = `${n.string ?? 'k'}:${n.pitch}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ string: null, fret: null, source: 'fallback', ...n, event: ev.id ?? null });
    };

    for (const q of ev.parts ?? []) {
      if (q.kind === 'chord') {
        let set = strings.length ? strings : (fingering?.pitches ?? []).map((pitch, index) => ({ index, pitch }));
        if (o.singleNote) set = set.slice(0, 1);
        const direction = strokeDirection(arts, { offbeat: !!ev.offbeat, pattern: o.pattern }); // the stroke the pattern gives the hit, else the card's: down, or alternating (up off the beat)
        const delayMs = o.delayMs ?? autoDelayMs(ev.bpm);
        for (const n of strokeNotes({ ...o, strings: set, direction, muted: false, delayMs, start: ev.t, duration: length })) {
          push({ pitch: n.pitch, t: n.t, duration: n.duration, velocity: n.velocity * factor * o.handVelocity, string: voicing ? n.string : null, fret: voicing ? voicing.frets[n.string] : null, source: voicing ? 'shape' : 'fallback', direction });
        }
      } else if (q.kind === 'bass') {
        const low = strings[0] ?? null; // `voicingStrings` lists the strings from the lowest
        if (low) push({ pitch: low.pitch, t: ev.t, duration: length, velocity: o.bassVelocity * factor, string: low.index, fret: voicing.frets[low.index], source: 'shape' });
        else {
          const pitch = bassNote(comp.spec.bassPc ?? comp.spec.rootPc);
          if (pitch !== null) push({ pitch, t: ev.t, duration: length, velocity: o.bassVelocity * factor });
        }
      }
    }

    // the degrees of the hit are placed together (one note per string)
    const degrees = (ev.parts ?? []).filter((q) => q.kind === 'degree')
      .map((q) => ({ q, semis: degreeSemis(q, comp.spec, o) })).filter((d) => d.semis !== null);
    if (degrees.length) {
      const placed = placeRiffHit({ voicing, rootPc: comp.spec.rootPc, intervals: degrees.map((d) => d.semis), options: o.reach != null ? { reach: o.reach } : {} });
      placed.notes.forEach((n) => push({ pitch: n.pitch, t: ev.t, duration: length, velocity: o.handVelocity * factor, string: n.string, fret: n.fret, source: n.source }));
    }
  });
  return out.sort((a, b) => a.t - b.t || a.pitch - b.pitch);
}
