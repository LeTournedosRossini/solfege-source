/*
 * The automatic draft of the score being edited: while the person works, the work is copied to the browser's storage (IndexedDB) after a few quiet seconds, and again when the page is
 * hidden or closed, so that a closed tab, an app swiped away or a crash is forgiven: at the next launch the editor offers to take the draft back. It is NOT the real saving (that is the
 * file the person writes); it is cleared as soon as the work is saved or given up. ONE draft slot (the last work edited). The audio of a synchronised song is not in it, only the score.
 * Storage may be missing, refused or full: every access is guarded and the editor works as before.
 */
const DB = 'scorsaire-editor';
const STORE = 'kv';
const KEY = 'draft';

/** The store of the draft. `idb` is injectable for tests; without IndexedDB the draft lives in memory (it still protects against nothing after a reload, but never throws). */
export function createDraftStore(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  let memory = null;
  const open = () => new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('no indexedDB')); return; }
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try { return await new Promise((resolve, reject) => { const tx = db.transaction(STORE, mode); const result = fn(tx.objectStore(STORE)); tx.oncomplete = () => resolve(result?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
  };
  return {
    /** → { savedAt, name, text, base } or null */
    async get() { try { const d = await run('readonly', (s) => s.get(KEY)); return d && typeof d.text === 'string' ? d : null; } catch { return memory; } },
    async put(draft) { memory = draft; try { await run('readwrite', (s) => s.put(draft, KEY)); return true; } catch { return false; } },
    async clear() { memory = null; try { await run('readwrite', (s) => s.delete(KEY)); } catch { /* nothing to clear */ } },
  };
}

/**
 * Writes the draft after `quiet` ms without a change, never later than `maxWait` ms after the first unsaved change (a long burst of editing is still copied), and at once on `flush`.
 * @param o.snapshot  () → { name, text, base? } | null (null: nothing to copy now; `base` = the text of the last clean state of the work)
 * @param o.isDirty   () → true when the work has unsaved changes
 */
export function createAutosave({ store, snapshot, isDirty, quiet = 2500, maxWait = 15000, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null; let firstAt = null; let writing = Promise.resolve();
  const write = () => {
    timer = null; firstAt = null;
    if (!isDirty()) return writing;
    const snap = snapshot();
    if (!snap) return writing;
    writing = writing.then(() => store.put({ savedAt: now(), name: snap.name ?? '', text: snap.text, base: snap.base ?? null })); // `base` = the text of the last clean state, to tell afterwards what the draft changes
    return writing;
  };
  return {
    /** A change was made: copy after the quiet delay (or at the latest after `maxWait`). */
    touch() {
      if (!isDirty()) return;
      const t = now();
      if (firstAt === null) firstAt = t;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(write, Math.max(0, Math.min(quiet, firstAt + maxWait - t)));
    },
    /** Copy now (the page is being hidden or closed). */
    flush() { if (timer !== null) { clearTimer(timer); timer = null; } return write(); },
    /** The work was saved or given up: the draft is no longer needed. */
    clear() { if (timer !== null) { clearTimer(timer); timer = null; } firstAt = null; writing = writing.then(() => store.clear()); return writing; },
  };
}
