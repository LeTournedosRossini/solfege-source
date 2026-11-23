/*
 * Import report: what an importer ignored, changed or could not place. Messages are aggregated by code (one line with a count).
 * `level`: 'info' (a normal conversion worth knowing), 'warning' (something of the file is lost or approximated).
 */
export function createReport() {
  const items = new Map();
  const stats = {};
  return {
    /** Records one occurrence of `code` (the message is that of the FIRST occurrence; `data` is kept for the interface). */
    add(level, code, message, data) {
      const found = items.get(code);
      if (found) found.count += 1;
      else items.set(code, { level, code, message, count: 1, data });
    },
    warn(code, message, data) { this.add('warning', code, message, data); },
    info(code, message, data) { this.add('info', code, message, data); },
    stat(name, n = 1) { stats[name] = (stats[name] ?? 0) + n; },
    /** { items: [{ level, code, message, count }], stats } — warnings first. */
    result() {
      const list = [...items.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1));
      return { items: list, stats: { ...stats } };
    },
  };
}
