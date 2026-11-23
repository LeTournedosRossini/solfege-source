/*
 * Vélocité : niveau de nuance de MuseScore → vélocité 1-127, puis MISE EN FORME réglable par Scorsaire avant l'envoi au synthé
 * (décision de Jean, 08/10/2026 : « pouvoir définir une dynamique maximale ou minimale, ou modifier la courbe de dynamique avant de
 * l'envoyer au sampleur » ; trois étages, dans cet ordre : règles à la MuseScore → profil d'instrument → piste).
 *
 * Niveaux (MuseScore 4.7.5, `framework/mpe/mpetypes.h`, `DynamicType`, 0-10000, `ONE_PERCENT` = 100, pas `DYNAMIC_LEVEL_STEP` = 500) :
 * valeurs recopiées ci-dessous. Conversion niveau → vélocité = `FluidSequencer::expressionLevel` (`fluidsequencer.cpp`, chemin sans événements
 * de dynamique : `m_useDynamicEvents` est faux par défaut ; `noteVelocity` renvoie `expressionLevel(niveau) << 9`, soit en 7 bits
 * `expressionLevel(niveau)`) : niveau ≤ ppp (3250) → 16, niveau ≥ fff (6750) → 127, sinon 16 + 16 × (niveau − 3250) / 500 arrondi, avec le
 * niveau « Natural » (5000) compté un demi-pas plus bas. Donne pp 32, p 48, mp 64, mf 80, f 96, ff 112 ; Natural 64.
 */
export const NATURAL_LEVEL = 5000;

/** Niveaux nommés de MuseScore (`DynamicType`). */
export const DYNAMIC_LEVELS = Object.freeze({
  ppppppppp: 0, pppppppp: 750, ppppppp: 1250, pppppp: 1750, ppppp: 2250, pppp: 2750, ppp: 3250, pp: 3750, p: 4250, mp: 4750,
  natural: NATURAL_LEVEL,
  mf: 5250, f: 5750, ff: 6250, fff: 6750, ffff: 7250, fffff: 7750, ffffff: 8250, fffffff: 8750, ffffffff: 9250, fffffffff: 10000,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Vélocité 16-127 d'un niveau de nuance (port de `FluidSequencer::expressionLevel`). */
export function velocityFromLevel(level) {
  const MIN_LEVEL = DYNAMIC_LEVELS.ppp;
  const MAX_LEVEL = DYNAMIC_LEVELS.fff;
  if (level <= MIN_LEVEL) return 16;
  if (level >= MAX_LEVEL) return 127;
  let steps = (level - MIN_LEVEL) / 500;
  if (level === NATURAL_LEVEL) steps -= 0.5;
  return clamp(Math.round(16 + steps * 16), 16, 127);
}

// ───────────────────────── mise en forme ─────────────────────────

/**
 * Étage de mise en forme : { min, max, limit, curve }.
 *  - `curve` : null (droite) ou points [[entrée, sortie], …] de 1 à 127, relié par segments ; hors des points extrêmes, valeur de l'extrémité.
 *  - `min`, `max` : bornes de la vélocité de sortie (1-127).
 *  - `limit` : 'scale' (défaut) = toute l'échelle 1-127 est ramenée dans [min, max], on garde les nuances relatives ;
 *              'clamp' = on coupe seulement ce qui dépasse.
 */
export function createVelocityStage({ min = 1, max = 127, limit = 'scale', curve = null } = {}) {
  return { min, max, limit, curve: curve ? curve.map(([x, y]) => [x, y]) : null };
}

/** Erreurs de validation d'un étage (liste vide = valide). */
export function validateVelocityStage(stage) {
  const errors = [];
  if (!stage || typeof stage !== 'object') return ['étage de vélocité : objet attendu'];
  const inRange = (v) => Number.isFinite(v) && v >= 1 && v <= 127;
  if (!inRange(stage.min)) errors.push('étage de vélocité : min hors de 1-127');
  if (!inRange(stage.max)) errors.push('étage de vélocité : max hors de 1-127');
  if (inRange(stage.min) && inRange(stage.max) && stage.min > stage.max) errors.push('étage de vélocité : min supérieur à max');
  if (stage.limit !== 'scale' && stage.limit !== 'clamp') errors.push(`étage de vélocité : limite inconnue (${stage.limit})`);
  if (stage.curve !== null && stage.curve !== undefined) {
    if (!Array.isArray(stage.curve) || stage.curve.length < 2) errors.push('étage de vélocité : la courbe demande au moins 2 points');
    else {
      let last = -Infinity;
      for (const p of stage.curve) {
        if (!Array.isArray(p) || p.length !== 2 || !inRange(p[0]) || !inRange(p[1])) { errors.push('étage de vélocité : point de courbe invalide'); break; }
        if (p[0] <= last) { errors.push('étage de vélocité : les points de la courbe doivent croître en entrée'); break; }
        last = p[0];
      }
    }
  }
  return errors;
}

function throughCurve(curve, v) {
  if (!curve) return v;
  if (v <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (v <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return v;
}

/** Applique UN étage à une vélocité (nombre réel permis ; résultat non arrondi, entre min et max). */
export function applyVelocityStage(stage, velocity) {
  if (!stage) return velocity;
  const shaped = clamp(throughCurve(stage.curve ?? null, velocity), 1, 127);
  const min = stage.min ?? 1;
  const max = stage.max ?? 127;
  if (min === 1 && max === 127) return shaped;
  if ((stage.limit ?? 'scale') === 'clamp') return clamp(shaped, min, max);
  return min + ((shaped - 1) / 126) * (max - min);
}

/** Chaîne d'étages (null/undefined ignorés), puis arrondi et borne 1-127 : la vélocité FINALE envoyée au synthé. */
export function shapeVelocity(velocity, stages = []) {
  let v = velocity;
  for (const stage of stages) if (stage) v = applyVelocityStage(stage, v);
  return clamp(Math.round(v), 1, 127);
}

/**
 * Vélocité finale d'UNE note jouée.
 *
 * Vélocité imposée (`PID.USER_VELOCITY`, port de `Note::userVelocityFraction` = `m_userVelocity / 127`, MuseScore 4.7.5) : si elle est > 0, elle
 * REMPLACE le niveau de nuance, les soufflets, le pic d'accent / marcato ET les décalages des règles utilisateur (`velocityOffset`), comme
 * `FluidSequencer::noteVelocity` qui teste `velocityOverride` avant tout (`round(fraction × 65535)` en 16 bits puis `>> 9` en 7 bits : redonne
 * exactement la valeur saisie pour 1-127). 0 = automatique. Seuls les étages de mise en forme (global → profil → piste) s'appliquent ensuite
 * (choix de Jean, 11/10/2026 : les limites d'un instrument restent respectées) ; MuseScore n'a pas d'étages.
 */
export function finalVelocity({ level, velocityOffset = 0, userVelocity = 0, stages = [] }) {
  if (userVelocity > 0) return shapeVelocity(userVelocity, stages);
  return shapeVelocity(velocityFromLevel(level) + velocityOffset, stages);
}

// ───────────────────────── courbe de transfert par piste (dynamique MIDI) ─────────────────────────

/**
 * The MIDI dynamics of a track, as a TRANSFER CURVE (input velocity → output velocity): { x0, y0, x1, y1, bend }.
 *  - (x0, y0) and (x1, y1): the two ends of the curve (the handles of the window). Below x0 the output stays y0, above x1 it stays y1; between them the curve runs from one
 *    end to the other. Raising y0 / lowering y1 narrows the output range (what a compressor does with its threshold and its ratio), the reverse widens it.
 *  - bend, −1 … +1: 0 = straight; > 0 = CONVEX (the curve rises above the diagonal: soft notes are lifted, the range is squeezed like a compressor); < 0 = CONCAVE
 *    (below the diagonal: soft notes stay soft, loud ones stand out, like an expander). Exponent 4^(−bend), the same shape as the automation curves.
 * There is no time constant: a velocity belongs to one note, so this is the static half of a compressor (threshold, ratio, knee), not its attack and release.
 */
export const IDENTITY_DYNAMICS = Object.freeze({ x0: 1, y0: 1, x1: 127, y1: 127, bend: 0 });

/** A clean copy (integers 1-127, x0 < x1, bend −1…1 in steps of 0.01), or null when it is the straight line (nothing to do / to save). */
export function cleanDynamics(d) {
  if (!d || typeof d !== 'object') return null;
  const int = (v, def) => clamp(Math.round(Number.isFinite(v) ? v : def), 1, 127);
  let x0 = int(d.x0, 1); let x1 = int(d.x1, 127);
  if (x1 <= x0) { if (x0 >= 127) x0 = 126; x1 = x0 + 1; }
  const y0 = int(d.y0, 1); const y1 = int(d.y1, 127);
  const bend = clamp(Math.round((Number.isFinite(d.bend) ? d.bend : 0) * 100) / 100, -1, 1);
  const out = { x0, y0, x1, y1, bend };
  return out.x0 === 1 && out.y0 === 1 && out.x1 === 127 && out.y1 === 127 && bend === 0 ? null : out;
}

/** Errors of a stored dynamics value (empty list = valid). */
export function validateDynamics(d) {
  if (d === null || d === undefined) return [];
  const bad = [];
  for (const k of ['x0', 'y0', 'x1', 'y1']) if (!Number.isInteger(d?.[k]) || d[k] < 1 || d[k] > 127) bad.push(`MIDI dynamics: ${k} must be an integer 1-127`);
  if (Number.isInteger(d?.x0) && Number.isInteger(d?.x1) && d.x0 >= d.x1) bad.push('MIDI dynamics: x0 must be below x1');
  if (!(d?.bend >= -1 && d?.bend <= 1)) bad.push('MIDI dynamics: bend must be between -1 and 1');
  return bad;
}

/** The output velocity (a real number, not rounded) for the input velocity `v`. */
export function dynamicsOutput(d, v) {
  const c = cleanDynamics(d) ?? IDENTITY_DYNAMICS;
  if (v <= c.x0) return c.y0;
  if (v >= c.x1) return c.y1;
  const u = (v - c.x0) / (c.x1 - c.x0);
  return c.y0 + (c.y1 - c.y0) * u ** (4 ** -c.bend);
}

/** A velocity stage (see `createVelocityStage`) that follows the curve with up to 32 segments, or null when the curve is the straight line. */
export function dynamicsStage(d) {
  const c = cleanDynamics(d);
  if (!c) return null;
  const n = Math.min(32, c.x1 - c.x0);
  const curve = [];
  for (let i = 0; i <= n; i++) {
    const x = i === n ? c.x1 : c.x0 + ((c.x1 - c.x0) * i) / n;
    curve.push([x, dynamicsOutput(c, x)]);
  }
  return createVelocityStage({ limit: 'clamp', curve });
}

/** The bend that makes the curve of `d` pass through output `y` at the middle of its input range (the bend handle of the window drags that point). */
export function bendForMidOutput(d, y) {
  const c = cleanDynamics(d) ?? IDENTITY_DYNAMICS;
  if (c.y1 === c.y0) return 0;
  const u = clamp((y - c.y0) / (c.y1 - c.y0), 0.02, 0.98);
  return clamp(Math.round(-Math.log(Math.log(u) / Math.log(0.5)) / Math.log(4) * 100) / 100, -1, 1);
}
