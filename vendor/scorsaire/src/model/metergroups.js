/*
 * How the beats of an ASYMMETRIC measure are grouped (5/8 = 3 + 2, 7/8 = 3 + 2 + 2…). A group is a number of units of the denominator (eighths in /8). The grouping of a measure is the masterbar's
 * `PID.BEAM_GROUPING` when it has one (the author's choice: the beaming follows it); without one the grid mode starts from `defaultGrouping` (the notation keeps its own default).
 * Compound measures (6/8, 9/8, 12/8) are not asymmetric: their beat is the dotted quarter, handled by the time signature itself.
 */
const isAsymmetric = ([num, den]) => (den === 8 || den === 16) && (num === 3 || (num >= 5 && num % 3 !== 0));

/** The grouping a measure starts from when nothing was chosen, or null when the signature needs none (the time signature's own beat is used). */
export function defaultGrouping(timeSig) {
  const [num, den] = timeSig;
  if (den !== 8 && den !== 16) return null;
  if (num === 3) return [3];
  if (num % 3 === 0) return null; // 6/8, 9/8, 12/8: compound
  if (num < 5) return null;
  const threes = Math.floor((num - 2) / 3); // as many groups of 3 as fit, then one group of 2 (5 = 3 + 2, 7 = 3 + 2 + 2, 11 = 3 + 3 + 3 + 2)
  const rest = num - threes * 3;
  return [...Array(threes).fill(3), ...Array(rest / 2).fill(2)];
}

/** The groupings offered for a signature: the orders of 2s and 3s that fill it (at most 6), plus “one beat per unit” for 3/8. Empty when none applies. */
export function groupingChoices(timeSig) {
  const [num, den] = timeSig;
  if (!isAsymmetric(timeSig)) return [];
  if (num === 3) return [[3], [1, 1, 1]];
  const out = [];
  const walk = (left, acc) => {
    if (out.length >= 6) return;
    if (left === 0) { out.push(acc); return; }
    for (const part of [3, 2]) if (left >= part) walk(left - part, [...acc, part]);
  };
  walk(num, []);
  return out.filter((g) => g.length >= 2 || num <= 3);
}

export const groupingText = (g) => g.join('+');
export const sameGrouping = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
