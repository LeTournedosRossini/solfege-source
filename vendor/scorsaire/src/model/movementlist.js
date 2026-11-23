/*
 * The movements of a Scorsaire file, read from its JSON WITHOUT building the model (no DOM, no hydration): what a server needs to let a teacher
 * pick "movement 3" of a sheet of exercises. The `id` of a movement is written in the file and kept by every save, so it names the same movement
 * for as long as that movement exists (a new id is given only to a copy or to a re-import).
 *   listMovements(text) → { ok: true, format, version, supported, title, movements: [{ id, index, title, measures: [measure ids in order] }] }
 *                       | { ok: false, reason: 'json' | 'format' | 'version' }
 */
import { FILE_FORMAT, FILE_VERSION } from './serialize.js';
import { PID } from './pid.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param input the text of `score.json` (or the parsed object) */
export function listMovements(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { return { ok: false, reason: 'json' }; }
  }
  if (!isObj(data) || data.format !== FILE_FORMAT || !isObj(data.work) || !Array.isArray(data.work.movements)) return { ok: false, reason: 'format' };
  if (!Number.isInteger(data.version) || data.version < 1) return { ok: false, reason: 'version' };
  const titleKey = PID.TITLE;
  return {
    ok: true,
    format: data.format,
    version: data.version,
    supported: data.version <= FILE_VERSION, // false = a newer file than this program reads: the reader would refuse it
    title: String(data.work.props?.[titleKey] ?? ''),
    movements: data.work.movements.map((m, index) => ({ id: String(m.id), index, title: String(m.props?.[titleKey] ?? ''), measures: (m.masterbars ?? []).map((b) => String(b.id)) })),
  };
}
