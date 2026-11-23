/*
 * The AudioWorklet processor of the track compressor. NOT imported by the application: `tools/build.js` reads this file as TEXT and puts it after `compressor.js` (without its
 * `export`s) in one script (`__COMPRESSOR_WORKLET__`), which the engines start from a Blob URL. So `processBlock` and `createCompressorState` are the very functions the tests run.
 * The page sends the settings with `port.postMessage(settings)`; the processor sends back the deepest gain reduction (dB) about every 20 ms for the meter.
 */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class ScorsaireCompressor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.state = createCompressorState();
    this.settings = { on: false };
    this.deepest = 0;
    this.blocks = 0;
    this.port.onmessage = (event) => { this.settings = event.data; };
  }

  process(inputs, outputs) {
    const input = inputs[0]; const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const n = Math.min(input.length, output.length, 2);
    const ins = []; const outs = [];
    for (let k = 0; k < n; k++) { ins.push(input[k]); outs.push(output[k]); }
    const depth = processBlock(this.state, this.settings, ins, outs, sampleRate);
    if (depth < this.deepest) this.deepest = depth;
    this.blocks += 1;
    if (this.blocks >= 8) { this.port.postMessage(this.deepest); this.deepest = 0; this.blocks = 0; }
    return true;
  }
}
registerProcessor('scorsaire-compressor', ScorsaireCompressor);
