// Bends / dives : propriétés de LECTURE (PID.BENDS, portée) — port du modèle de `GuitarBend` (MuseScore 4.7.5, `guitarbend.cpp`, `propertyDefault`).
// L'affichage est dans layout/bends.js et layout/tabspanners.js ; ici seulement ce qui décide du SON.

/**
 * Facteurs de temps de la courbe (`BEND_START/TARGET/END_TIME_FACTOR`) : fractions [0, 1] de la durée de la note de départ.
 * Défauts par type (`GuitarBend::propertyDefault` + `setBendType`) : début 0 ; fin 1 sauf graceNoteBend et scoop 0,25, dip 0,5 ;
 * cible : dip 0,25, sinon la fin.
 */
export function bendTimeFactorDefaults(type) {
  const end = type === 'graceNoteBend' || type === 'scoop' ? 0.25 : type === 'dip' ? 0.5 : 1;
  const target = type === 'dip' ? 0.25 : end;
  return { start: 0, target, end };
}

/** Facteurs effectifs d'une entrée (`GuitarBend::timeFactors`) : bornés à [0, 1] ; hors ordre début ≤ cible ≤ fin → { 0, 1, 1 }. */
export function bendTimeFactors(entry) {
  const d = bendTimeFactorDefaults(entry.type);
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const start = clamp(entry.startTimeFactor ?? d.start);
  const end = clamp(entry.endTimeFactor ?? d.end);
  const target = clamp(entry.targetTimeFactor ?? (entry.endTimeFactor !== undefined && entry.type !== 'dip' ? end : d.target));
  if (!(start <= target && target <= end)) return { start: 0, target: 1, end: 1 };
  return { start, target, end };
}

/** Un bend est joué sauf `play === false` (`Spanner::playSpanner`). */
export function bendPlays(entry) {
  return entry?.play !== false;
}

/** Erreurs de validation des propriétés de lecture. */
export function validateBendPlayback(list) {
  const errors = [];
  for (const b of list) {
    if (b.play !== undefined && typeof b.play !== 'boolean') errors.push(`bend ${b.id} : play doit être un booléen`);
    for (const k of ['startTimeFactor', 'targetTimeFactor', 'endTimeFactor']) {
      if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] >= 0 && b[k] <= 1)) errors.push(`bend ${b.id} : ${k} doit être un nombre dans [0, 1]`);
    }
    if (b.curve !== undefined && !isValidBendCurve(b.curve)) errors.push(`bend ${b.id} : courbe invalide (2 à ${BEND_CURVE_MAX_POINTS} points, t croissant à partir de 0, |s| ≤ ${BEND_CURVE_MAX_SEMITONES})`);
    const f = { start: b.startTimeFactor, target: b.targetTimeFactor, end: b.endTimeFactor };
    const d = bendTimeFactorDefaults(b.type);
    const s = f.start ?? d.start; const e = f.end ?? d.end; const t = f.target ?? (f.end !== undefined && b.type !== 'dip' ? e : d.target);
    if (!(s <= t && t <= e)) errors.push(`bend ${b.id} : il faut début ≤ cible ≤ fin (${s}, ${t}, ${e})`);
  }
  return errors;
}

// ---------- user curve (bend graph) ----------
// `entry.curve` = [{ t, s, h? }, …] (`h` = Bézier handle [dt, ds], see `sampleBendCurve`) : the pitch of the merged note over its duration, t = fraction [0, 1] of the duration, s = semitones relative
// to the starting note (+ up, − down). It REPLACES the three time factors for playback (the written amount stays the end note's pitch: the last
// point is that amount). MuseScore 4.2+ edits the same thing in its Properties graph; Guitar Pro in its Bend window.
export const BEND_CURVE_MAX_POINTS = 12;
export const BEND_CURVE_MAX_SEMITONES = 12;
/** Minimum gap between two points (fraction of the duration). */
export const BEND_CURVE_MIN_GAP = 0.02;

/** True when `points` is a usable curve: 2..12 points, first at t = 0, t strictly ascending in [0, 1], |s| ≤ 12. */
export function isValidBendCurve(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > BEND_CURVE_MAX_POINTS) return false;
  if (points[0].t !== 0) return false;
  let prev = -1;
  for (const p of points) {
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.s)) return false;
    if (p.t < 0 || p.t > 1 || p.t <= prev || Math.abs(p.s) > BEND_CURVE_MAX_SEMITONES) return false;
    // optional Bézier handle: [dt, ds] from the point to its OUTGOING control point (the incoming one is the mirror image)
    if (p.h !== undefined && !(Array.isArray(p.h) && p.h.length === 2 && p.h.every(Number.isFinite) && Math.abs(p.h[0]) <= 1 && Math.abs(p.h[1]) <= BEND_CURVE_MAX_SEMITONES)) return false;
    prev = p.t;
  }
  return true;
}

/** The user curve of an entry, or null (absent or invalid: playback falls back to the time factors). */
export const bendCurveOf = (entry) => (isValidBendCurve(entry?.curve) ? entry.curve : null);

/** The curve implied by the time factors for an amount of `semitones` (signed): what the graph shows before the user edits it. */
export function defaultBendCurve(entry, semitones) {
  const f = bendTimeFactors(entry);
  const pts = [{ t: 0, s: 0 }];
  const push = (t, s) => { if (t > pts[pts.length - 1].t + 1e-9) pts.push({ t, s }); else pts[pts.length - 1] = { t: pts[pts.length - 1].t, s }; };
  if (f.start > 0) push(f.start, 0);
  push(f.end > 0 ? f.end : 1, semitones);
  if (f.end < 1) push(1, semitones);
  return pts;
}

/**
 * The curve as a polyline for playback and drawing. A segment is straight unless one of its two points has a Bézier handle `h`:
 * control points = P0 + h0 (outgoing) and P3 − h3 (incoming), with their time kept inside the segment so the time never goes backwards.
 * @param perSegment samples per curved segment
 * @returns [{ t, s }] with strictly ascending t
 */
export function sampleBendCurve(points, perSegment = 12) {
  const out = [{ t: points[0].t, s: points[0].s }];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]; const b = points[i + 1];
    if (!a.h && !b.h) { out.push({ t: b.t, s: b.s }); continue; }
    const c1 = a.h ? { t: a.t + a.h[0], s: a.s + a.h[1] } : { t: a.t, s: a.s };
    const c2 = b.h ? { t: b.t - b.h[0], s: b.s - b.h[1] } : { t: b.t, s: b.s };
    c1.t = Math.min(b.t, Math.max(a.t, c1.t));
    c2.t = Math.min(b.t, Math.max(c1.t, c2.t));
    for (let k = 1; k <= perSegment; k++) {
      const u = k / perSegment; const v = 1 - u;
      const t = v * v * v * a.t + 3 * v * v * u * c1.t + 3 * v * u * u * c2.t + u * u * u * b.t;
      const sv = v * v * v * a.s + 3 * v * v * u * c1.s + 3 * v * u * u * c2.s + u * u * u * b.s;
      if (k === perSegment) out.push({ t: b.t, s: b.s });
      else if (t > out[out.length - 1].t + 1e-9) out.push({ t, s: sv });
    }
  }
  return out;
}
