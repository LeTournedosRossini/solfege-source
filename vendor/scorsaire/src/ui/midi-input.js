/*
 * MIDI keyboards (Web MIDI): the notes a connected keyboard plays, with their velocity and the browser's timestamp, as events for the rest of the interface
 * (the on-screen keys' sound, the note entry and the recording window). WITHOUT DOM; `requestAccess` is injectable (tests use a fake device).
 *
 * Web MIDI exists in Chrome and Edge (computers, and Android with a USB keyboard on an OTG cable); NOT in Safari (iPad, iPhone): `supported()` says so and the
 * interface explains it. The permission is asked by `enable()`, which must be called from a user gesture (a button).
 * An event: { type: 'on' | 'off', midi, velocity, timeStamp (ms, the `performance.now()` clock: what a recording is timed with), device (input id) } or
 * { type: 'sustain', down: boolean, timeStamp, device }.
 */

/** { type, midi, velocity } for a note on / off, { type: 'sustain', down } for the sustain pedal (controller 64), null for anything else. */
export function parseMidiMessage(data) {
  if (!data || data.length < 2) return null;
  const status = data[0] & 0xf0;
  if (status === 0x90 || status === 0x80) {
    const velocity = data[2] ?? 0;
    return { type: status === 0x90 && velocity > 0 ? 'on' : 'off', midi: data[1] & 0x7f, velocity: status === 0x90 && velocity > 0 ? velocity & 0x7f : 0 };
  }
  if (status === 0xb0 && (data[1] & 0x7f) === 64) return { type: 'sustain', down: (data[2] ?? 0) >= 64 };
  return null;
}

const defaultRequest = () => navigator.requestMIDIAccess({ sysex: false });

export function createMidiInput({ requestAccess = defaultRequest, isSupported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function', initialDevice = 'all' } = {}) {
  let access = null; let device = initialDevice; let pending = null;
  const noteListeners = new Set(); const changeListeners = new Set();
  const connected = () => (access ? [...access.inputs.values()].filter((i) => i.state !== 'disconnected') : []);
  const emitChange = () => { for (const fn of [...changeListeners]) fn(); };
  const handler = (input) => (e) => {
    const m = parseMidiMessage(e.data);
    if (!m) return;
    const ev = { ...m, timeStamp: e.timeStamp, device: input.id };
    for (const fn of [...noteListeners]) fn(ev);
  };
  /** Listens to the chosen input (or all of them) and to no other. */
  const bind = () => {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = input.state !== 'disconnected' && (device === 'all' || device === input.id) ? handler(input) : null;
    emitChange();
  };
  return {
    supported: isSupported,
    enabled: () => !!access,
    /** Asks the browser for MIDI access (from a user gesture). Rejects with `unsupported` or the browser's refusal. */
    async enable() {
      if (access) return;
      if (!isSupported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      pending ??= requestAccess().then((a) => { access = a; access.addEventListener?.('statechange', bind); bind(); }).catch((e) => { pending = null; throw Object.assign(new Error(String(e?.message ?? e)), { code: 'denied' }); });
      await pending;
    },
    /** [{ id, name }] of the keyboards plugged in now. */
    devices: () => connected().map((i) => ({ id: i.id, name: i.name || i.manufacturer || i.id })),
    /** 'all' or an input id. */
    selected: () => device,
    select(id) { device = id ?? 'all'; bind(); },
    onNote(fn) { noteListeners.add(fn); return () => noteListeners.delete(fn); },
    /** `fn()` when a keyboard is plugged in or out, or the selection changes. */
    onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    destroy() { for (const i of access?.inputs.values() ?? []) i.onmidimessage = null; noteListeners.clear(); changeListeners.clear(); },
  };
}
