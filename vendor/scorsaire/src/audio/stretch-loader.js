/*
 * Loads Signalsmith Stretch (time stretch + pitch shift, MIT, WASM in an AudioWorklet) ON DEMAND. In the built page the library file is embedded as text
 * (`__SIGNALSMITH__`, see tools/build.js: NOT minified, the library builds the worklet code from its own source) and evaluated at the first use;
 * under Node (tests) the stretch is replaced by a fake, so this file is only used in the browser.
 *
 * `file://`: a worklet module loaded from a Blob URL is refused (spike of 23/10/2026), a `data:` URL is accepted. The library makes its worklet code
 * with `new Blob`: on `file://` the Blob URL it asks for is swapped for a `data:` URL while the first node is created.
 */
let cached = null;

function evaluate(code) {
  const module = { exports: {} };
  // the file is a UMD: it sets module.exports when a `module` is given
  new Function('module', 'exports', 'define', code)(module, module.exports, undefined);
  return module.exports;
}

/** @returns {Promise<(ctx: AudioContext, options?: object) => Promise<AudioWorkletNode>>} */
export async function loadStretch() {
  if (cached) return cached;
  if (typeof __SIGNALSMITH__ === 'undefined') throw new Error('Signalsmith Stretch is not embedded in this build');
  const create = evaluate(__SIGNALSMITH__);
  cached = async (ctx, options) => {
    if (typeof location === 'undefined' || location.protocol !== 'file:') return create(ctx, options);
    const NativeBlob = globalThis.Blob; const nativeCreate = URL.createObjectURL.bind(URL);
    const texts = new WeakMap();
    globalThis.Blob = function PatchedBlob(parts, opt) { const b = new NativeBlob(parts, opt); if (opt && /javascript/.test(opt.type || '')) texts.set(b, parts.join('')); return b; };
    globalThis.Blob.prototype = NativeBlob.prototype;
    URL.createObjectURL = (b) => (texts.has(b) ? `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(texts.get(b))))}` : nativeCreate(b));
    try { return await create(ctx, options); } finally { globalThis.Blob = NativeBlob; URL.createObjectURL = nativeCreate; }
  };
  return cached;
}
