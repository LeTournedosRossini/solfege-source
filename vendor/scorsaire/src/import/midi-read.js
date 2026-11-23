/*
 * Standard MIDI File reader (formats 0 and 1). PURE: no DOM. Reads the bytes into a flat, tick-based description; nothing musical is decided here.
 *
 *   readMidi(bytes, { maxBytes, maxNotes }) → {
 *     format, division (ticks per quarter note), trackCount, ticks (length of the file),
 *     tempos:   [{ tick, bpm }]               (microseconds per quarter → beats per minute, in quarter notes),
 *     timeSigs: [{ tick, num, den }],
 *     keySigs:  [{ tick, fifths, minor }],
 *     tracks:   [{ index, name, notes: [{ tick, end, midi, velocity, channel }], programs: Map(channel → first program), channels: Set }],
 *     lyrics:   [{ tick, text }]   lyric meta events (0x05), the text as written (spaces kept: they mark the words), or else the text events (0x01) of a karaoke
 *               track named « Words » / « Lyrics » / « Paroles » (the « @ » header lines and the « / » « \ » line marks are dropped)
 *     markers:  [{ tick, text }]   marker meta events (0x06)
 *     ignored:  { controllers, pitchBend, aftertouch, sysex, text, markers, lyrics }   (counts of what is NOT read into `lyrics` / `markers`, for the report)
 *   }
 *
 * Refused with a MidiError (a clear `code`, never a silent cut): not a MIDI file, format 2 (several independent songs), a time base in SMPTE frames,
 * a file or a note count above the limits, a truncated file. A note without its note-off ends with its track; running status, note-on with velocity 0,
 * meta events and system exclusive messages are handled; chunks of unknown type are skipped.
 */
export class MidiError extends Error {
  constructor(code, message, data) { super(message); this.name = 'MidiError'; this.code = code; this.data = data; }
}

export const MIDI_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxNotes: 120000 });

const MAX_TEXTS = 50000; // lyrics + markers read; a file with more says so (`textsCut`)

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/** True when the bytes begin like a Standard MIDI File (a RIFF-wrapped "RMID" file is accepted too). */
export function looksLikeMidi(bytes) {
  if (!bytes || bytes.length < 14) return false;
  if (tag(bytes, 0) === 'MThd') return true;
  return tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'RMID';
}

/** True when the bytes of a picked file are a MIDI file (by their header, whatever the extension). */
export const isMidiFile = (bytes) => looksLikeMidi(bytes);

function decodeRaw(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, ''); } catch { /* not UTF-8: Latin-1 */ }
  let s = '';
  for (const c of bytes) s += String.fromCharCode(c);
  return s.replace(/\0+$/, '');
}
const decodeText = (bytes) => decodeRaw(bytes).trim();
const KARAOKE_TRACK = /^(words|lyrics?|paroles?|texte?)$/i;

/** Variable-length quantity at `pos`: { value, next }. */
function readVlq(b, pos, end) {
  let value = 0;
  for (let k = 0; k < 4; k += 1) {
    if (pos >= end) throw new MidiError('truncated', 'The MIDI file is cut short');
    const c = b[pos]; pos += 1;
    value = (value * 128) + (c & 0x7f);
    if (!(c & 0x80)) return { value, next: pos };
  }
  throw new MidiError('corrupt', 'The MIDI file is damaged (a time value is too long)');
}

export function readMidi(input, limits = {}) {
  const maxBytes = limits.maxBytes ?? MIDI_LIMITS.maxBytes;
  const maxNotes = limits.maxNotes ?? MIDI_LIMITS.maxNotes;
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > maxBytes) throw new MidiError('tooBig', 'The MIDI file is too big', { bytes: bytes.length, max: maxBytes });
  if (!looksLikeMidi(bytes)) throw new MidiError('notMidi', 'Not a MIDI file');
  if (tag(bytes, 0) === 'RIFF') { // RMID: a RIFF "data" chunk holds the SMF
    let p = 12; let found = null;
    while (p + 8 <= bytes.length) {
      const size = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
      if (tag(bytes, p) === 'data') { found = bytes.subarray(p + 8, p + 8 + size); break; }
      p += 8 + size + (size & 1);
    }
    if (!found || !looksLikeMidi(found)) throw new MidiError('notMidi', 'Not a MIDI file');
    bytes = found;
  }
  const headerLen = u32(bytes, 4);
  if (headerLen < 6) throw new MidiError('corrupt', 'The MIDI file header is damaged');
  const format = u16(bytes, 8);
  const trackCount = u16(bytes, 10);
  const rawDivision = u16(bytes, 12);
  if (format > 2) throw new MidiError('format', `MIDI format ${format} is not supported`, { format });
  if (format === 2) throw new MidiError('format2', 'MIDI format 2 (independent songs) is not supported', { format });
  if (rawDivision & 0x8000) throw new MidiError('smpte', 'A MIDI file timed in SMPTE frames has no musical time to write');
  if (rawDivision === 0) throw new MidiError('corrupt', 'The MIDI file header is damaged (no time base)');
  const division = rawDivision;

  const out = {
    format, division, trackCount, ticks: 0, tempos: [], timeSigs: [], keySigs: [], tracks: [],
    lyrics: [], markers: [],
    ignored: { controllers: 0, pitchBend: 0, aftertouch: 0, sysex: 0, text: 0, markers: 0, lyrics: 0 },
  };
  const karaoke = []; // text events (0x01) of every track: [{ tick, text, track }], kept only if no lyric events exist
  let textCount = 0;
  let noteTotal = 0;
  let pos = 8 + headerLen;
  let index = 0;
  while (pos + 8 <= bytes.length) {
    const type = tag(bytes, pos);
    const size = u32(bytes, pos + 4);
    const start = pos + 8;
    let end = start + size;
    if (end > bytes.length) {
      if (type !== 'MTrk') break;
      end = bytes.length; // a track cut short: what can be read is read (the report says so through `truncated`)
      out.truncated = true;
    }
    pos = end;
    if (type !== 'MTrk') continue;
    const track = { index, name: '', notes: [], programs: new Map(), channels: new Set() };
    index += 1;
    const open = new Map(); // `${channel}:${midi}` → the note being held
    const noteOff = (tick, channel, key) => {
      const k = (channel << 8) | key;
      const n = open.get(k);
      if (!n) return;
      n.end = Math.max(tick, n.tick);
      open.delete(k);
    };
    let tick = 0; let status = 0; let p = start;
    try {
      while (p < end) {
        const dt = readVlq(bytes, p, end); p = dt.next; tick += dt.value;
        let byte = bytes[p];
        if (byte === undefined) break;
        if (byte & 0x80) { status = byte; p += 1; } else if (!status) throw new MidiError('corrupt', 'The MIDI file is damaged (an event has no status)');
        const kind = status & 0xf0; const channel = status & 0x0f;
        if (status === 0xff) { // meta
          const metaType = bytes[p]; p += 1;
          const len = readVlq(bytes, p, end); p = len.next;
          const data = bytes.subarray(p, p + len.value); p += len.value;
          if (metaType === 0x2f) break;
          if (metaType === 0x51 && data.length === 3) {
            const us = (data[0] << 16) | (data[1] << 8) | data[2];
            if (us > 0) out.tempos.push({ tick, bpm: 60000000 / us });
          } else if (metaType === 0x58 && data.length >= 2) {
            out.timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
          } else if (metaType === 0x59 && data.length >= 2) {
            out.keySigs.push({ tick, fifths: (data[0] << 24) >> 24, minor: data[1] === 1 });
          } else if (metaType === 0x03 && !track.name) track.name = decodeText(data);
          else if (metaType === 0x05) { if (textCount < MAX_TEXTS) { out.lyrics.push({ tick, text: decodeRaw(data) }); textCount += 1; } else out.textsCut = true; }
          else if (metaType === 0x06) { if (textCount < MAX_TEXTS) { out.markers.push({ tick, text: decodeText(data) }); textCount += 1; } else out.textsCut = true; }
          else if (metaType === 0x01) { if (textCount < MAX_TEXTS) { karaoke.push({ tick, text: decodeRaw(data), track: out.tracks.length }); textCount += 1; } else out.textsCut = true; out.ignored.text += 1; } else if (metaType === 0x02 || metaType === 0x04 || metaType === 0x07) out.ignored.text += 1;
          continue;
        }
        if (status === 0xf0 || status === 0xf7) { // system exclusive
          const len = readVlq(bytes, p, end); p = len.next + len.value;
          out.ignored.sysex += 1;
          continue;
        }
        if (status >= 0xf1) { p += status === 0xf2 ? 2 : (status === 0xf1 || status === 0xf3) ? 1 : 0; continue; }
        const needs = (kind === 0xc0 || kind === 0xd0) ? 1 : 2;
        if (p + needs > end) break;
        const d1 = bytes[p]; const d2 = needs === 2 ? bytes[p + 1] : 0;
        p += needs;
        if (kind === 0x90 && d2 > 0) {
          noteOff(tick, channel, d1); // the same key struck again: the held one ends here
          noteTotal += 1;
          if (noteTotal > maxNotes) throw new MidiError('tooManyNotes', 'The MIDI file holds too many notes', { notes: noteTotal, max: maxNotes });
          const n = { tick, end: -1, midi: d1, velocity: d2, channel };
          track.notes.push(n);
          track.channels.add(channel);
          open.set((channel << 8) | d1, n);
        } else if (kind === 0x80 || kind === 0x90) noteOff(tick, channel, d1);
        else if (kind === 0xc0) { if (!track.programs.has(channel)) track.programs.set(channel, d1); } else if (kind === 0xb0) out.ignored.controllers += 1;
        else if (kind === 0xe0) out.ignored.pitchBend += 1;
        else if (kind === 0xa0 || kind === 0xd0) out.ignored.aftertouch += 1;
      }
    } catch (e) {
      if (e instanceof MidiError && e.code === 'truncated') out.truncated = true; else throw e;
    }
    for (const n of open.values()) n.end = Math.max(tick, n.tick); // held to the end of the track
    for (const n of track.notes) if (n.end < n.tick) n.end = n.tick;
    out.ticks = Math.max(out.ticks, tick);
    out.tracks.push(track);
  }
  if (!out.tracks.length) throw new MidiError('empty', 'The MIDI file holds no track');
  if (!out.lyrics.length) { // a karaoke file: the syllables are text events of the track named « Words » (or « Lyrics »)
    const words = new Set(out.tracks.filter((t) => KARAOKE_TRACK.test(t.name)).map((t) => t.index));
    for (const e of karaoke) {
      if (!words.has(e.track)) continue;
      if (e.text.startsWith('@')) continue; // @K, @L, @T…: file information
      out.lyrics.push({ tick: e.tick, text: e.text });
    }
  }
  out.lyrics.sort((a, b) => a.tick - b.tick);
  out.markers.sort((a, b) => a.tick - b.tick);
  out.tempos.sort((a, b) => a.tick - b.tick);
  out.timeSigs.sort((a, b) => a.tick - b.tick);
  out.keySigs.sort((a, b) => a.tick - b.tick);
  return out;
}
