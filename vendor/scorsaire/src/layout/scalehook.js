// The layout never knows what a scale is: a reader that does (scales/layout-hook.js) installs a function that gives the fragment to draw for a SCALE container, for the instrument of the
// track that holds it. `fragmentFor(container, recipe, hostTrack, mode)` → a movement (fragment) or null (then the fragment written in the file is drawn).
let hook = null;
export const setScaleHook = (fn) => { hook = typeof fn === 'function' ? fn : null; };
export const scaleHook = () => hook;
