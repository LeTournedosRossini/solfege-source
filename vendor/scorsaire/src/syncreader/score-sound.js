/*
 * The SOUND of the score in the synchro reader: the score is heard with the recording (for the parts the recording does not hold, to help a learner).
 * The sequence of the score is re-timed on the time map (`retimeSequence`, as on screen 4) and played by the audio engine of the reader; the recording
 * leads: the engine follows its position, speed, pitch and loop, and the two audio clocks are brought to agree on what is HEARD.
 * The mixer of the score (volume, mute, solo per track, volume of the whole) lives in memory: nothing is ever written.
 */
import { buildSequence } from '../audio/sequence.js';
import { retimeSequence } from '../audio/syncscore.js';
import { savedMixer, effectiveVolume, masterFactor, masterVolumeOf } from '../audio/mixer.js';
import { measureLengthOf } from '../model/timing.js';
import { fToNumber } from '../model/fraction.js';

/** @param o.work the work · o.getMap() the sync map · o.stems the stem player · o.audio `createReaderAudio()` */
export function createScoreSound({ work, getMap, stems, audio }) {
  const movement = work.movements[0];
  const mix = { master: masterVolumeOf(work), tracks: {}, solo: new Set() };
  for (const tr of movement.tracks) { const s = savedMixer(tr, work); mix.tracks[tr.id] = { fader: s.fader, mute: s.mute }; }
  const listeners = new Set(); const emit = () => { for (const fn of [...listeners]) fn(); };
  const mixerNow = () => {
    const out = {};
    for (const tr of movement.tracks) {
      const base = savedMixer(tr, work); const m = mix.tracks[tr.id];
      out[tr.id] = { ...base, fader: m.fader, volume: effectiveVolume(m.fader, mix.master), masterFactor: masterFactor(mix.master), mute: m.mute, solo: mix.solo.has(tr.id) };
    }
    return out;
  };
  let started = false; let stale = true; let seq = null; let engine = null; let tuner = null; let later = null; let wasPlaying = false; let rateKey = ''; let loopKey = '';
  const eng = () => audio.getEngine();
  const at = (st) => st.position / st.rate;
  const build = () => {
    const st = stems.state();
    const base = buildSequence(work, { speed: 1, playRepeats: !!getMap().order, mixer: mixerNow(), chordSymbols: { play: true } }); // a recording with repeats: the score is built as it is PLAYED
    return retimeSequence(base, getMap(), { rate: st.rate, semitones: st.semitones, lengths: movement.masterbars.map((b) => fToNumber(measureLengthOf(b))) });
  };
  const applyLoop = () => { const st = stems.state(); eng().setLoop?.(st.loop ? { start: st.loop.start / st.rate, end: st.loop.end / st.rate } : null); };
  const load = () => { const st = stems.state(); seq = build(); engine = eng(); engine.load(seq, { position: at(st) }); applyLoop(); stale = false; };

  // the two audio clocks agree on what is HEARD: the engine goes to the position the recording will have when it starts
  const heardOffsetMs = () => {
    const st = stems.state(); const e = eng(); const clock = e.audioClock?.(); if (!clock || !st.playing || !e.isPlaying()) return null;
    const ce = e.ctxTimeOf?.(st.position / st.rate); const ps = stems.perfOfMedia?.(st.position);
    return ce == null || ps == null ? null : clock.perfOf(ce) - ps;
  };
  const alignClocks = () => {
    const st = stems.state(); const e = eng(); const clock = e.audioClock?.(); if (!clock || !st.playing || !e.isPlaying()) return;
    const media = stems.mediaAtPerf?.(clock.perfOf(clock.now() + (e.options?.startLatency ?? 0.05)));
    if (media != null) e.seek(media / st.rate);
  };
  const tune = (round = 0) => { // right after a start or a jump (twice), then now and then; the score moves only when it is farther than the threshold
    clearTimeout(tuner);
    tuner = setTimeout(() => { const off = heardOffsetMs(); if (off !== null && Math.abs(off) > (round < 2 ? 8 : 20)) alignClocks(); if (stems.state().playing) tune(round + 1); }, round === 0 ? 400 : round === 1 ? 800 : 6000);
  };
  const start = () => { // called in the gesture that starts the recording
    if (!started) { started = true; audio.start?.(); } // the SoundFont is asked for at the first play (the light engine sounds until it is ready)
    clearTimeout(later);
    if (stale || engine !== eng()) load(); else eng().seek(at(stems.state()));
    // a count-in (a start at the very beginning of the piece): the recording has not reached its first note yet, the score waits for it
    const st = stems.state(); const clock = eng().audioClock?.(); const media = clock ? stems.mediaAtPerf?.(clock.perfOf(clock.now())) : null;
    const lead = media != null ? st.position - media : 0;
    if (lead > 0.1) { later = setTimeout(() => { if (stems.state().playing) { eng().seek(at(stems.state())); eng().play(); alignClocks(); tune(0); } }, Math.max(0, (lead / st.rate) * 1000 - (eng().options?.startLatency ?? 0.05) * 1000)); return; }
    eng().play(); alignClocks(); tune(0);
  };
  const offs = [
    stems.onSeek(() => { clearTimeout(later); if (!engine || stale) return; const st = stems.state(); eng().seek(at(st)); if (st.playing) { alignClocks(); tune(0); } }),
    stems.subscribe((st) => {
      const key = `${st.rate}|${st.semitones}`;
      if (key !== rateKey) { rateKey = key; stale = true; if (st.playing) { try { start(); } catch { /* no engine */ } } }
      const lk = st.loop ? `${st.loop.start}|${st.loop.end}` : '';
      if (lk !== loopKey) { loopKey = lk; if (engine && !stale) applyLoop(); }
      if (st.playing !== wasPlaying) { wasPlaying = st.playing; if (st.playing) { try { start(); } catch { /* no engine */ } } else { clearTimeout(tuner); clearTimeout(later); try { eng().pause(); } catch { /* nothing plays */ } } }
    }),
  ];
  // the engine can change under us (the SoundFont becomes ready): the sequence is loaded into the new one at the position of the recording
  const offStatus = audio.onStatus?.(() => { if (engine && eng() !== engine) { try { engine.stop(); } catch { /* gone */ } stale = true; if (stems.state().playing) { try { start(); } catch { /* no engine */ } } } });

  const push = () => { if (engine && !stale) eng().setMixer?.(mixerNow()); emit(); };
  return {
    state: () => ({ master: mix.master, tracks: movement.tracks.map((tr) => ({ id: tr.id, fader: mix.tracks[tr.id].fader, mute: mix.tracks[tr.id].mute, solo: mix.solo.has(tr.id) })), anySolo: mix.solo.size > 0 }),
    setTrack(id, patch) { const m = mix.tracks[id]; if (!m) return; if ('fader' in patch) m.fader = Math.min(1, Math.max(0, patch.fader)); if ('mute' in patch) m.mute = !!patch.mute; if ('solo' in patch) { if (patch.solo) mix.solo.add(id); else mix.solo.delete(id); } push(); },
    setMaster(v) { mix.master = Math.min(1, Math.max(0, v)); push(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { for (const o of offs) o(); offStatus?.(); clearTimeout(tuner); clearTimeout(later); try { engine?.stop(); } catch { /* gone */ } },
  };
}
