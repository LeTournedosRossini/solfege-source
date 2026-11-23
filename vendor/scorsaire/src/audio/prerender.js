/*
 * Pre-render of a backing track: the SoundFont engine is run on a VIRTUAL clock against a SpessaSynth processor that is rendered by hand, sample block by
 * sample block, and the result is kept as a stereo buffer. The engine is the real one (`SoundFontEngine`: channels, programs, mixer, pedal, bends,
 * automation), so what is rendered is what would have been played; only the clock and the output are different. Nothing here touches the browser audio
 * (the library, `Core`, is passed in), so it runs under Node.
 */
import { SoundFontEngine } from './soundfont-engine.js';

const BLOCK = 128; // the processor's own block size (samples)

/** Just enough of an audio context for the engine to build its output chain: a clock we move by hand, gains and a destination. */
export class OfflineContext {
  constructor(sampleRate) {
    this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'running';
    const param = () => { const p = { value: 1 }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'setTargetAtTime']) p[m] = () => p; return p; };
    const node = () => ({ connect: (to) => to, disconnect() {}, gain: param() });
    this.destination = node();
    this.createGain = node;
  }
  resume() { return Promise.resolve(); }
}

/**
 * A class with the surface of the library's `WorkletSynthesizer` that the engine uses, but backed by a `SpessaSynthProcessor` rendered by `render`.
 * @param Core the `spessasynth_core` module ({ SpessaSynthProcessor, SoundBankLoader })
 */
export function offlineSynthClass(Core) {
  const { SpessaSynthProcessor, SoundBankLoader } = Core;
  return class OfflineSynth {
    constructor(ctx) {
      this.processor = new SpessaSynthProcessor(ctx.sampleRate, { initialTime: 0, effectsEnabled: true, eventsEnabled: false });
      this.isReady = this.processor.processorInitialized;
      this.soundBankManager = {
        addSoundBank: async (data, id) => { this.processor.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(data), id); },
      };
    }

    get channelCount() { return this.processor.midiChannels.length; }

    addNewChannel() { for (let i = 0; i < 16; i++) this.processor.createMIDIChannel(); }

    connect() {} setSystemParameter(name, value) { try { this.processor.setSystemParameter(name, value); } catch { /* a parameter this version does not know */ } }

    destroy() {}

    _send(status, ch, a, b, o) {
      const c = ch % 16;
      const data = b === undefined ? new Uint8Array([status | c, a]) : new Uint8Array([status | c, a, b]);
      this.processor.processMessage(data, ch - c, { time: Number.isFinite(o?.time) ? o.time : 0 });
    }

    noteOn(ch, key, vel, o) { this._send(0x90, ch, key, vel, o); }

    noteOff(ch, key, o) { this._send(0x80, ch, key, 0, o); }

    controllerChange(ch, cc, value, o) { this._send(0xb0, ch, cc, value, o); }

    programChange(ch, program, o) { this._send(0xc0, ch, program, undefined, o); }

    pitchWheel(ch, value, o) { this._send(0xe0, ch, value & 127, (value >> 7) & 127, o); }

    pitchWheelRange(ch, range, o) { this.controllerChange(ch, 101, 0, o); this.controllerChange(ch, 100, 0, o); this.controllerChange(ch, 6, range, o); }

    stopAll() { for (let ch = 0; ch < this.channelCount; ch++) this.controllerChange(ch, 120, 0); }

    /** Renders `count` samples into `left` / `right` starting at `start` (the processor's clock moves by as much). */
    render(left, right, start, count) {
      for (let done = 0; done < count; done += BLOCK) this.processor.process(left, right, start + done, Math.min(BLOCK, count - done)); // one block at a time, like the worklet
    }
  };
}

/**
 * Renders `sequence` from `from` to `to` (seconds in the sequence) into a stereo buffer.
 * @returns { left, right, sampleRate, from, to } — sample 0 is the instant `from`; `tail` seconds of ring-out follow `to`.
 * @param o.Core        the `spessasynth_core` module
 * @param o.fonts       [{ data: ArrayBuffer, id? }] (the engine's own format)
 * @param o.onProgress  (0..1) called now and then
 * @param o.yieldToUi   async () called now and then to let the page breathe (default: nothing)
 */
export async function renderBacking({ sequence, from, to, Core, fonts, sampleRate = 44100, tail = 1.2, step = 0.03, onProgress = () => {}, yieldToUi = async () => {}, signal = null }) {
  const ctx = new OfflineContext(sampleRate);
  let pending = null;
  const engine = new SoundFontEngine({ context: ctx, globals: {}, addModule: async () => {}, setTimer: (fn) => { pending = fn; return 1; }, clearTimer: () => { pending = null; } });
  const Synth = offlineSynthClass(Core);
  await engine.prepare({ WorkletSynthesizer: Synth, fonts, processorUrl: 'offline' });
  engine.load(sequence, { position: from });
  engine.play();
  const origin = engine.ctxTimeOf(from); // virtual time at which `from` sounds (the engine starts a little after "now")
  const seconds = Math.max(0, to - from) + tail;
  const total = Math.ceil(seconds * sampleRate);
  const lead = Math.round(origin * sampleRate);
  const left = new Float32Array(total); const right = new Float32Array(total);
  const frames = Math.ceil((lead + total) / BLOCK) * BLOCK;
  const scratchL = new Float32Array(frames); const scratchR = new Float32Array(frames);
  let done = 0; let lastYield = 0;
  while (done < frames) {
    if (signal?.aborted) { engine.stop?.(); throw Object.assign(new Error('aborted'), { code: 'aborted' }); }
    const count = Math.min(Math.max(BLOCK, Math.round(step * sampleRate / BLOCK) * BLOCK), frames - done);
    ctx.currentTime = (done + count) / sampleRate; // the engine looks ahead from here: everything dated before this is already queued
    pending?.(); // the engine's scheduler timer is an interval: the same function every step
    engine._synth.render(scratchL, scratchR, done, count);
    done += count;
    if (done - lastYield >= sampleRate * 0.5) { lastYield = done; onProgress(Math.min(1, done / frames)); await yieldToUi(); }
  }
  engine.stop?.();
  left.set(scratchL.subarray(lead, lead + total)); right.set(scratchR.subarray(lead, lead + total));
  try { engine.dispose?.(); } catch { /* nothing to free */ }
  onProgress(1);
  return { left, right, sampleRate, from, to };
}
