// Tiny helper to draw icons in a convenient frame and bake them into final 24 x 24 path data (rotation, uniform scale, fit to the box).
// A shape is a list of segments: ['M', x, y] ['L', x, y] ['C', x1, y1, x2, y2, x, y] ['Z']. Coordinates are in the drawing frame.
export function bake(paths, { rotate = 0, margin = 2.2, box = 24 } = {}) {
  const a = (rotate * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const rot = (x, y) => [x * cos - y * sin, x * sin + y * cos];
  const pts = [];
  const rotated = paths.map((segs) => segs.map(([cmd, ...n]) => {
    if (cmd === 'Z') return [cmd];
    const out = [];
    for (let i = 0; i < n.length; i += 2) { const [x, y] = rot(n[i], n[i + 1]); out.push(x, y); pts.push([x, y]); }
    return [cmd, ...out];
  }));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = (box - 2 * margin) / Math.max(x1 - x0, y1 - y0);
  const ox = box / 2 - ((x0 + x1) / 2) * k, oy = box / 2 - ((y0 + y1) / 2) * k;
  const f = (v) => String(Math.round(v * 100) / 100);
  return rotated.map((segs) => segs.map(([cmd, ...n]) => (cmd === 'Z' ? 'Z' : `${cmd}${n.map((v, i) => f(i % 2 ? v * k + oy : v * k + ox)).join(' ')}`)).join(''));
}
