/*
 * What the Lecteur keeps on the device: the recueil it shows (with the adjustments made while reading) and where the person was. IndexedDB (a recueil can hold several
 * megabytes of works: more than localStorage takes), with a memory fallback where the browser refuses it. Nothing is ever sent anywhere.
 */
const DB = 'scorsaire-lecteur';
const STORE = 'kv';
const memory = new Map();

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getItem(key) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => { const r = db.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error); });
  } catch { return memory.get(key) ?? null; }
}

export async function setItem(key, value) {
  memory.set(key, value);
  try {
    const db = await open();
    await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  } catch { /* kept in memory only */ }
}
