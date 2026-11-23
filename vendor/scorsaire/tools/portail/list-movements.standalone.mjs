// The movements of a Scorsaire `score.json`, with NO import: copy this single file to the server.
//   listMovements(text, { maxVersion }) → { ok: true, version, supported, title, movements: [{ id, index, title, measures: [ids] }] } | { ok: false, reason }
// Same answer as src/model/movementlist.js (a test compares them). `maxVersion` = the newest file version your readers support (57 on 03/11/2026).
export function listMovements(input, { maxVersion = Infinity } = {}) {
  let data = input;
  if (typeof input === 'string') { try { data = JSON.parse(input); } catch { return { ok: false, reason: 'json' }; } }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(data) || data.format !== 'scorsaire' || !isObj(data.work) || !Array.isArray(data.work.movements)) return { ok: false, reason: 'format' };
  if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, reason: 'version' };
  return {
    ok: true, format: data.format, version: data.version, supported: data.version <= maxVersion,
    title: String(data.work.props?.title ?? ''),
    movements: data.work.movements.map((m, index) => ({ id: String(m.id), index, title: String(m.props?.title ?? ''), measures: (m.masterbars ?? []).map((b) => String(b.id)) })),
  };
}
