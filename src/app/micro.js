// Détection de hauteur au micro (partagée par l'accordeur et le jeu « Chante la note »). Aucune donnée audio n'est enregistrée ni envoyée : le son est analysé en direct puis oublié.
/** Fréquence fondamentale (Hz) d'un bloc de signal, par autocorrélation ; -1 si le son est trop faible ou indistinct. */
export function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1; const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const trimmed = buf.slice(r1, r2), n = trimmed.length;
  const c = new Array(n).fill(0);
  for (let lag = 0; lag < n; lag++) { let sum = 0; for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag]; c[lag] = sum; }
  let d = 0; while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < n; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
  let T0 = maxpos;
  if (T0 > 0 && T0 < n - 1) {
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);
  }
  return T0 > 0 ? sampleRate / T0 : -1;
}
export const NOTE_NAMES_FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
export function freqToNote(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440), rounded = Math.round(midi);
  return { name: NOTE_NAMES_FR[((rounded % 12) + 12) % 12], octave: Math.floor(rounded / 12) - 1, cents: Math.round((midi - rounded) * 100) };
}

/** Écart en demi-tons (de −6 à +6) entre la hauteur de `freq` et la note MIDI `midi`, sans tenir compte de l'octave (une voix d'homme ou de femme chante la « même » note à des octaves différentes). */
export function ecartClasse(freq, midi) {
  const m = 69 + 12 * Math.log2(freq / 440);
  return ((((m - midi) % 12) + 18) % 12) - 6;
}

/** Ouvre le micro : { lire() → fréquence en Hz ou -1, fermer() }. Lève une erreur si l'accès est refusé. */
export async function ouvrirMicro() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    lire() { analyser.getFloatTimeDomainData(buf); const f = autoCorrelate(buf, ctx.sampleRate); return f > 0 && f < 2000 ? f : -1; },
    fermer() { stream.getTracks().forEach((t) => t.stop()); ctx.close(); },
  };
}
