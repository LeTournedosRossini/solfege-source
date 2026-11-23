/*
 * The display options of the page (screen 1): plain values with change notifications. They used to live in hidden HTML controls that the page logic read;
 * now they are held here and the settings panel and the file drawer read and write them directly. UI state only: never saved in the Document.
 */

/** @param {Record<string, unknown>} initial default value of every option (its type is kept: boolean, number) */
export function createPageSettings(initial) {
  const values = { ...initial };
  const listeners = new Set();
  return {
    get: (key) => values[key],
    /** Sets an option; listeners are told only when the value really changes. */
    set(key, value) {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown page setting: ${key}`);
      if (values[key] === value) return false;
      values[key] = value;
      for (const fn of [...listeners]) fn(key, value);
      return true;
    },
    /** @returns {() => void} unsubscribe */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
