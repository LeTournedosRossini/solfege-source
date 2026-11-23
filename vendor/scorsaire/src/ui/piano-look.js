/**
 * Look of the on-screen keyboard keys (shared by the editor and the standalone reader): same shape and shading, colours from the interface set
 * (cream whites, warm-ink blacks, the fretboard blue for lit keys). Set `PIANO_SET_LOOK` to false for the original wood-and-gold keys.
 */
export const PIANO_SET_LOOK = true;
/** True on the dark theme (`data-dark` on the page root). */
export const themeIsDark = (root = typeof document !== 'undefined' ? document.documentElement : null) => !!root?.hasAttribute('data-dark');
/** True on the high-contrast theme (`data-hc`). */
export const themeIsHC = (root = typeof document !== 'undefined' ? document.documentElement : null) => !!root?.hasAttribute('data-hc');
export function applyKeyLook(kb, dark = themeIsDark()) {
  if (!PIANO_SET_LOOK) return;
  if (themeIsHC()) { // high contrast: pure white and black keys with a white outline, yellow when lit
    kb.setWhiteRest({ top: '#ffffff', mid: '#ffffff', bot: '#e6e6e6' });
    kb.setBlackRest({ top: '#1a1a1a', mid: '#000000', bot: '#000000' });
    kb.setKeyBorder('#ffffff');
    kb.setActiveColor('#ffd800');
    return;
  }
  if (dark) { // dark theme: ivory keys a little dimmed (they do not dazzle), soft black keys, gold for the lit ones
    kb.setWhiteRest({ top: '#e6e1d4', mid: '#dbd5c6', bot: '#c7bfac' });
    kb.setBlackRest({ top: '#34343a', mid: '#222226', bot: '#0c0c0e' });
    kb.setKeyBorder('#2a2a2e');
    kb.setActiveColor('#caa457');
    return;
  }
  kb.setWhiteRest({ top: '#fdfcf8', mid: '#f7f4ec', bot: '#e9e4d6' });
  kb.setBlackRest({ top: '#4a4640', mid: '#33302b', bot: '#1c1b1a' });
  kb.setKeyBorder('#cfc8b8');
  kb.setActiveColor('#2b6cff');
}

/** The interface's colours for the frame and the buttons of the keyboard (the keys keep their own); the page's own variables, light or dark. */
export function interfaceTheme(root = document.documentElement) {
  const cs = getComputedStyle(root); const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  const ink = v('--ink', '#1c1b1a'); const line = v('--line', '#d8d3c8');
  if (themeIsHC(root)) return { frame: '#000000', topBarLine: '#ffffff', btnBg: '#000000', btnBorder: '#ffffff', btnIcon: '#ffffff', btnHoverBg: '#3a3000', btnHoverIcon: '#ffffff', noteName: '#ffffff', sliderBg: '#000000', sliderBorder: '#ffffff' };
  if (themeIsDark(root)) return { frame: '#1c1c1f', topBarLine: line, btnBg: '#2a2b2d', btnBorder: '#3d3e42', btnIcon: ink, btnHoverBg: '#3a3b3d', btnHoverIcon: '#ffffff', noteName: ink, sliderBg: '#151517', sliderBorder: line };
  return { frame: '#efece4', topBarLine: line, btnBg: '#ffffff', btnBorder: '#bbbbbb', btnIcon: ink, btnHoverBg: '#f2f2f2', btnHoverIcon: '#000000', noteName: ink, sliderBg: '#e4e0d6', sliderBorder: line };
}

/** The colours of the fretboard for the theme shown (a darker warm wood on the dark theme). */
export function fretboardTheme(root = document.documentElement) {
  const t = interfaceTheme(root);
  if (themeIsHC(root)) return { frame: '#000000', board: '#000000', ink: '#ffffff', line: '#ffffff', fret: '#d6d6d6', lit: '#ffd800' };
  if (themeIsDark(root)) return { frame: t.frame, board: '#26241f', ink: t.noteName, line: '#55555c', fret: '#6b6a6e', lit: '#caa457' };
  return { frame: t.frame, board: '#f7f4ec', ink: t.noteName, line: t.topBarLine, fret: '#9a948a', lit: '#2b6cff' };
}
