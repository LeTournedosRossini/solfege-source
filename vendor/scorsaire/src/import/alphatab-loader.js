/*
 * Loads AlphaTab (the Guitar Pro reader) ON DEMAND. In the built page the library is embedded as text (`__ALPHATAB__`, see tools/build.js) and
 * evaluated at the first Guitar Pro import, so it costs nothing at start-up; under Node (tests) it is imported from node_modules.
 * Only the reader is used: `importer.ScoreLoader.loadScoreFromBytes` and the score model.
 */
let cached = null;

export async function loadAlphaTab() {
  if (cached) return cached;
  if (typeof __ALPHATAB__ !== 'undefined') {
    // eslint-disable-next-line no-eval
    (0, eval)(__ALPHATAB__);
    cached = globalThis.__scorsaireAlphaTab;
  } else {
    const spec = '@coderline/alphatab'; // a variable: the bundler must not follow it
    cached = await import(/* @vite-ignore */ spec);
  }
  if (!cached?.importer) throw new Error('AlphaTab could not be loaded');
  return cached;
}
