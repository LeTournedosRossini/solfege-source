/*
 * Plusieurs voix sur une portée, à un même instant — port de MuseScore v4.7.5 `ChordLayout::layoutChords1` et de ses étapes :
 * `calculateChordPosInfo`, `calculateMaxNoteWidths`, `layoutChords2` (têtes en miroir), `centreChords`, `calculateChordOffsets`
 * (seconde, unisson, partage de têtes, crochets, lignes supplémentaires), `applyChordOffsets`, puis `layoutChords3` (`placeDots`,
 * `getNoteListForDots`, `setDotX`, x des notes). `combineVoice` (`Chord::shouldCombineVoice`) ne fusionne PAS les têtes : il décide si
 * deux voix sont mises en page ENSEMBLE (conflits, décalages, alignement des points) ou seulement centrées chacune de son côté ;
 * le partage de têtes de deux voix est `shareHeads` (dans `calculateChordOffsets`).
 *
 * Fonctions pures, unités = espaces de portée. Ligne MuseScore d'une note : 0 = ligne du haut, +1 par demi-interligne vers le bas.
 * Tablature (Full et Common seulement : `o.tab`, `ChordLayout::layoutChords1` : `stemThrough() || isCommonTabStaff()`) : `line` = `stringOrLine()` = corde × 2 (0 = corde du haut),
 * `note.right` = `tabHeadWidth + 2 × tabFretPadding`, pas de centrage (`centreChords` ne s'applique qu'aux portées de notation), axe de hampe `chord.stemPosX`,
 * hampe sans marge de recouvrement ; les points d'augmentation (`layoutChords3`) restent à la charge du peintre de tablature. Pas de portée voisine (`staffMove`), pas d'accord « petit »
 * (cue, ornement : leur propre mise en page) ni de note décalée à la main (`isNudged`) : cas non portés.
 *
 * Entrée `chords` (UN instant d'UNE portée, dans l'ordre des voix) :
 *   { id, track, voice, up, dots, mag = 1, hasStem, stemLen (demi-espaces entiers, longueur par défaut), hook (largeur du crochet NON ligaturé, sinon null),
 *     headType ('quarter' | 'half' | 'whole' | 'brevis' : `durationType().headType()`), combine (bool : `shouldCombineVoice`), hasVoices (autre voix
 *     que la voix 1 sonnant pendant l'accord, silences compris : `Measure::hasVoices(..., true)`),
 *     notes: [{ id, line, right (`bboxRightPos`), body (`headBodyWidth`), headGroup, tpc, visible = true, stemUpX, stemDownX (ancres SMuFL
 *     de la tête, null si absentes), headTypeAuto = true }] }  — notes par hauteur CROISSANTE (comme `chord->notes()`).
 * Options `o` : { nominal (largeur de `noteheadBlack`), stemWidth (style `stemWidth`), ledgerLen (`ledgerLineLength`), lines (nombre de lignes),
 *   straightFlags, dotWidth, dotNoteDistance, dotDotDistance }.
 * Sortie : Map chord.id → { moveX, dotPosX, notes: Map note.id → { x, mirror, dotsHidden, dotRel } }.
 */

const THRESHOLD = 0.01; // `centerThreshold = 0.01 * sp`
const LEDGER_GAP = 0.15; // `ledgerGap = 0.15 * sp`

/** Tri stable par ligne décroissante (`stringOrLine() >` : la note la plus basse d'abord). */
const byLineDesc = (a, b) => b.line - a.line;

export function layoutChordGroup(chords, o) {
  const res = new Map();
  if (!chords.length) return res;
  const ctx = prepare(chords, o);
  const { posInfo } = ctx;
  if (posInfo.upVoices + posInfo.downVoices) {
    calculateMaxNoteWidths(ctx);
    const offsets = centreChords(ctx);
    calculateChordOffsets(ctx, offsets);
    applyChordOffsets(ctx, offsets);
  }
  // sortie
  for (const c of ctx.chords) {
    const notes = new Map();
    for (const n of c.notes) notes.set(n.src.id, { x: n.x, mirror: n.mirror, dotsHidden: n.dotsHidden, dotRel: n.dotRel });
    res.set(c.src.id, { moveX: c.moveX, dotPosX: c.dotPosX, notes });
  }
  return res;
}

/** Copie de travail : accords et notes mutables, avec renvois mutuels. */
function prepare(chords, o) {
  const work = chords.map((src) => {
    const c = { src, up: src.up, voice: src.voice, track: src.track, dots: src.dots ?? 0, mag: src.mag ?? 1, moveX: 0, dotPosX: 0, notes: [] };
    c.notes = [...src.notes].sort((a, b) => b.line - a.line).map((n) => ({
      src: n, chord: c, line: n.line, mirror: false, dotsHidden: false, x: 0, dotPosition: 'auto', dotRel: 0, visible: n.visible !== false,
    }));
    return c;
  });
  const posInfo = {
    upVoices: 0, downVoices: 0, upStemNotes: [], downStemNotes: [], maxUpWidth: 0, maxDownWidth: 0, maxUpMag: 0, maxDownMag: 0,
    upDots: 0, downDots: 0, upHooks: false, downHooks: false, upGrace: false, downGrace: false,
  };
  for (const c of work) {
    if (c.up) {
      posInfo.upVoices++;
      posInfo.upStemNotes.push(...c.notes);
      posInfo.upDots = Math.max(posInfo.upDots, c.dots);
      posInfo.maxUpMag = Math.max(posInfo.maxUpMag, c.mag);
      if (!posInfo.upHooks && c.src.hook != null) posInfo.upHooks = true;
    } else {
      posInfo.downVoices++;
      posInfo.downStemNotes.push(...c.notes);
      posInfo.downDots = Math.max(posInfo.downDots, c.dots);
      posInfo.maxDownMag = Math.max(posInfo.maxDownMag, c.mag);
      if (!posInfo.downHooks && c.src.hook != null) posInfo.downHooks = true;
    }
  }
  return { chords: work, posInfo, o };
}

const combineVoice = (a, b) => a.src.combine !== false && b.src.combine !== false;

/** `ChordLayout::layoutChords2` : quelles têtes passent de l'autre côté de la hampe ; renvoie la largeur maximale des têtes non décalées. */
function layoutChords2(notes, up) {
  let maxWidth = 0;
  const n = notes.length;
  const order = up ? notes.map((_, i) => i) : notes.map((_, i) => n - 1 - i);
  let prevLine = 1000;
  let prevVisible = false;
  let isLeft = notes[order[0]].chord.up;
  let prevChord = notes[order[0]].chord;
  let prevTrack = prevChord.track;
  for (const idx of order) {
    const note = notes[idx];
    const { chord } = note;
    const sameTrack = chord.track === prevTrack;
    const conflict = Math.abs(prevLine - note.line) < 2 && note.visible && prevVisible && (sameTrack || combineVoice(chord, prevChord));
    if (conflict || chord.up !== isLeft) isLeft = !isLeft;
    const mirror = chord.up !== isLeft;
    note.mirror = mirror;
    note.dotsHidden = false;
    if (!mirror) maxWidth = Math.max(maxWidth, note.src.right);
    prevChord = chord;
    prevVisible = note.visible;
    prevTrack = chord.track;
    prevLine = note.line;
  }
  return maxWidth;
}

/** `ChordLayout::calculateMaxNoteWidths`. */
function calculateMaxNoteWidths(ctx) {
  const { posInfo, o } = ctx;
  posInfo.maxUpWidth = o.nominal * posInfo.maxUpMag;
  posInfo.maxDownWidth = o.nominal * posInfo.maxDownMag;
  if (posInfo.upVoices > 1) posInfo.upStemNotes.sort(byLineDesc);
  if (posInfo.upVoices) posInfo.maxUpWidth = Math.max(posInfo.maxUpWidth, layoutChords2(posInfo.upStemNotes, true));
  if (posInfo.downVoices > 1) posInfo.downStemNotes.sort(byLineDesc);
  if (posInfo.downVoices) posInfo.maxDownWidth = Math.max(posInfo.maxDownWidth, layoutChords2(posInfo.downStemNotes, false));
}

/** `ChordLayout::centreChords` : centre les têtes plus larges / plus étroites que `noteheadBlack` sur l'axe nominal. */
function centreChords(ctx) {
  const { posInfo, o } = ctx;
  const off = newOffsets();
  if (o.tab) return off; // « only center chords on standard staves »
  const nominalWidth = o.nominal;
  let headDiff = posInfo.maxUpWidth - nominalWidth;
  const headDiff2 = posInfo.maxUpWidth - nominalWidth * posInfo.maxUpMag;
  if (headDiff > THRESHOLD) {
    off.centerUp = headDiff * -0.5;
    posInfo.maxUpWidth += off.centerUp;
    if (headDiff2 > THRESHOLD) {
      off.centerUp += headDiff2;
      off.oversizeUp = headDiff2;
    }
  } else if (-headDiff > THRESHOLD) {
    off.centerUp = -headDiff * 0.5;
    if (headDiff2 > THRESHOLD) {
      off.centerUp += headDiff2;
      off.oversizeUp = headDiff2;
    }
    off.centerAdjustDown = off.centerUp;
  }
  headDiff = posInfo.maxDownWidth - nominalWidth;
  if (headDiff > THRESHOLD) {
    off.centerDown = headDiff * -0.5;
    posInfo.maxDownWidth = nominalWidth - off.centerDown;
  } else if (-headDiff > THRESHOLD) {
    off.centerDown = -headDiff * 0.5;
    off.centerAdjustUp = off.centerDown;
  }
  return off;
}

function newOffsets() {
  return {
    upOffset: 0, downOffset: 0, dotAdjust: 0, dotAdjustThreshold: 0, centerUp: 0, oversizeUp: 0, centerDown: 0, centerAdjustUp: 0, centerAdjustDown: 0,
    tracksToAdjust: new Set(),
  };
}

/** `ChordLayout::calculateChordOffsets` : conflit entre les chœurs de hampes montantes et descendantes. */
function calculateChordOffsets(ctx, off) {
  const { posInfo, o } = ctx;
  if (!posInfo.upVoices || !posInfo.downVoices) return;
  const bottomUpNote = posInfo.upStemNotes[0];
  const topDownNote = posInfo.downStemNotes[posInfo.downStemNotes.length - 1];
  const separation = topDownNote.line - bottomUpNote.line;
  const overlapNotes = [];

  if (separation === 1) {
    // seconde
    if (posInfo.upDots && !posInfo.downDots) {
      off.upOffset = posInfo.maxDownWidth + 0.1;
      off.tracksToAdjust.add(bottomUpNote.chord.track);
    } else {
      off.downOffset = posInfo.maxUpWidth;
      // aligne les hampes si elles existent
      if (topDownNote.chord.src.hasStem && bottomUpNote.chord.src.hasStem) {
        off.downOffset -= o.stemWidth * topDownNote.chord.mag;
      } else if (topDownNote.chord.src.headType !== 'brevis' && bottomUpNote.chord.src.headType !== 'brevis') {
        off.downOffset -= o.stemWidth * topDownNote.chord.mag;
      }
      off.tracksToAdjust.add(topDownNote.chord.track);
    }
  } else if (separation < 1) {
    // recouvrement (éventuellement unisson)
    for (const n of posInfo.upStemNotes) {
      if (n.line >= topDownNote.line - 1) overlapNotes.push(n);
      else break;
    }
    for (let i = posInfo.downStemNotes.length; i > 0; i--) {
      if (posInfo.downStemNotes[i - 1].line <= bottomUpNote.line + 1) overlapNotes.push(posInfo.downStemNotes[i - 1]);
      else break;
    }
    overlapNotes.sort(byLineDesc);

    let shareHeads = true;
    let matchPending = false;
    let conflictUnison = false;
    let conflictSecondUpHigher = false;
    let conflictSecondDownHigher = false;
    let lastLine = 1000;
    let lastTrack = null;
    let p = overlapNotes[0];
    for (const n of overlapNotes) {
      if (n.mirror && separation < 0) {
        // pas de partage de têtes s'il y a un miroir ; pas de conflit pour une note en miroir
        shareHeads = false;
        continue;
      }
      const track = n.chord.track;
      const d = lastLine - n.line;
      if (d === 0) {
        // unisson
        conflictUnison = true;
        matchPending = false;
        const nHeadType = n.src.headTypeAuto === false ? n.src.headType : n.chord.src.headType;
        const pHeadType = p.src.headTypeAuto === false ? p.src.headType : p.chord.src.headType;
        if (n.src.headGroup !== p.src.headGroup || n.src.tpc !== p.src.tpc || n.mirror || p.mirror
            || (Boolean(n.chord.src.small) !== Boolean(p.chord.src.small) && (nHeadType !== 'quarter' || pHeadType !== 'quarter'))) {
          shareHeads = false;
        } else if ((n.chord.dots !== p.chord.dots || !n.chord.src.hasStem || !p.chord.src.hasStem || nHeadType !== pHeadType)
          && ((n.src.headTypeAuto !== false && p.src.headTypeAuto !== false) || nHeadType !== pHeadType)
          && (n.visible === p.visible)) {
          shareHeads = false;
        }
      } else if (d === 1) {
        // seconde
        if (separation < 0) {
          if (n.chord.up) conflictSecondUpHigher = true;
          else conflictSecondDownHigher = true;
          shareHeads = false;
        }
      } else {
        // pas de conflit
        if (matchPending) shareHeads = false;
        matchPending = true;
      }
      if (!shareHeads) {
        off.tracksToAdjust.add(track);
        if (lastTrack !== null) off.tracksToAdjust.add(lastTrack);
      }
      p = n;
      lastLine = n.line;
      lastTrack = track;
    }
    if (matchPending) shareHeads = false;

    const conflict = conflictUnison || conflictSecondDownHigher || conflictSecondUpHigher;
    let ledgerOverlapAbove = false;
    let ledgerOverlapBelow = false;
    const ledgerGap = LEDGER_GAP;
    const ledgerLen = o.ledgerLen;
    const firstLedgerBelow = o.lines * 2;
    let topDownStemLen = 0;
    if (!conflictUnison && topDownNote.chord.src.hasStem) {
      topDownStemLen = topDownNote.chord.src.stemLen;
      if (bottomUpNote.line > firstLedgerBelow - 1 && topDownNote.line < bottomUpNote.line && topDownNote.line + topDownStemLen >= firstLedgerBelow) {
        ledgerOverlapBelow = true;
      }
    }
    const firstLedgerAbove = -2;
    let bottomUpStemLen = 0;
    if (!conflictUnison && bottomUpNote.chord.src.hasStem) {
      bottomUpStemLen = bottomUpNote.chord.src.stemLen;
      if (topDownNote.line < -1 && topDownNote.line < bottomUpNote.line && bottomUpNote.line - bottomUpStemLen <= firstLedgerAbove) {
        ledgerOverlapAbove = true;
      }
    }

    if (shareHeads) {
      for (let i = overlapNotes.length - 1; i >= 1; i -= 2) {
        const previousNote = overlapNotes[i - 1];
        const n = overlapNotes[i];
        if (previousNote.chord.dots === n.chord.dots) {
          // masque un des deux jeux de points (celui de la voix du bas si la tête est sur une ligne, sinon celui de la voix du haut)
          const onLine = !(previousNote.line & 1);
          if (onLine) {
            if (previousNote.chord.voice & 1) previousNote.dotsHidden = true;
            else n.dotsHidden = true;
          } else if (!(previousNote.chord.voice & 1)) previousNote.dotsHidden = true;
          else n.dotsHidden = true;
        }
      }
    } else if (conflict && posInfo.upDots && !posInfo.downDots) {
      off.upOffset = posInfo.maxDownWidth + 0.1;
    } else if (conflictUnison && separation === 0 && (!posInfo.downGrace || posInfo.upGrace)) {
      off.downOffset = posInfo.maxUpWidth + 0.15;
    } else if (conflictUnison) {
      off.upOffset = posInfo.maxDownWidth + 0.15;
    } else if (conflictSecondUpHigher) {
      off.upOffset = posInfo.maxDownWidth + 0.15;
    } else if (posInfo.downHooks && !posInfo.upHooks && !(posInfo.upDots && !posInfo.downDots)) {
      // décale de la longueur d'une ligne supplémentaire si conflit avec elle, sinon de 0,3 sp
      const adjSpace = ledgerOverlapAbove || ledgerOverlapBelow ? ledgerGap + ledgerLen : 0.3;
      off.downOffset = posInfo.maxUpWidth + adjSpace;
    } else if (conflictSecondDownHigher) {
      if (posInfo.downDots && !posInfo.upDots) {
        const adjSpace = ledgerOverlapAbove || ledgerOverlapBelow ? ledgerGap + ledgerLen : 0.2;
        off.downOffset = posInfo.maxUpWidth + adjSpace;
      } else {
        // évite la collision tête / ligne supplémentaire
        const adjSpace = topDownNote.line <= firstLedgerAbove || bottomUpNote.line >= firstLedgerBelow ? ledgerLen - ledgerGap - 0.2 : -0.2;
        off.upOffset = posInfo.maxDownWidth + adjSpace;
        if (posInfo.downHooks) {
          const needsHookSpace = ledgerOverlapBelow || ledgerOverlapAbove;
          const hookSpace = topDownNote.chord.src.hook ?? 0;
          off.upOffset = needsHookSpace ? hookSpace + ledgerLen + ledgerGap : off.upOffset + 0.3;
        }
      }
    } else {
      // pas de conflit direct : les parties peuvent se recouvrir (hampes descendantes à gauche) ; hampes et lignes supplémentaires dégagées
      let clearLeft = o.tab ? bottomUpNote.chord.src.stemPosX : 0;
      let clearRight = o.tab ? bottomUpNote.chord.src.stemPosX : 0;
      const overlapPadding = o.tab ? 0 : 0.3;
      if (topDownNote.chord.src.hasStem) {
        const w = o.stemWidth * topDownNote.chord.mag;
        if (ledgerOverlapBelow) clearLeft += ledgerLen + ledgerGap + w;
        else clearLeft += w + overlapPadding;
      }
      if (bottomUpNote.chord.src.hasStem) {
        const w = o.stemWidth * bottomUpNote.chord.mag;
        if (ledgerOverlapAbove) clearRight += posInfo.maxDownWidth + ledgerLen + ledgerGap - posInfo.maxUpWidth + w;
        else clearRight += w + Math.max(posInfo.maxDownWidth - posInfo.maxUpWidth, 0) + overlapPadding;
      } else {
        posInfo.downDots = 0; // pas de correction de points dans ce cas
      }
      off.upOffset = Math.max(clearLeft, clearRight);
      // assez de place pour se glisser sous un crochet ?
      const topUpNote = posInfo.upStemNotes[posInfo.upStemNotes.length - 1];
      const pad = o.straightFlags ? 2 : 1;
      const overlapsFlag = topDownNote.line + topDownStemLen + pad > topUpNote.line;
      if (posInfo.downHooks && (ledgerOverlapBelow || overlapsFlag)) {
        const hookWidth = topDownNote.chord.src.hook ?? 0;
        if (ledgerOverlapBelow) off.upOffset = hookWidth + ledgerLen + ledgerGap;
        if (o.tab) off.upOffset = hookWidth + posInfo.maxDownWidth;
        off.upOffset = Math.max(off.upOffset, posInfo.maxDownWidth + 0.1);
        off.dotAdjustThreshold = posInfo.maxUpWidth - 0.3;
      }
      // accord descendant « petit » : pas de centrage
      if (off.centerDown > 0) {
        off.centerDown = 0;
        off.centerAdjustUp = 0;
        off.dotAdjustThreshold = off.upOffset - posInfo.maxDownWidth + posInfo.maxUpWidth - 0.3;
      }
    }
  }

  // correction pour les points
  if ((posInfo.upDots && !posInfo.downDots) || (posInfo.downDots && !posInfo.upDots)) {
    // un seul jeu de points : placé entre les accords
    let dots;
    let mag;
    if (posInfo.upDots) { dots = posInfo.upDots; mag = posInfo.maxUpMag; } else { dots = posInfo.downDots; mag = posInfo.maxDownMag; }
    off.dotAdjust = o.dotNoteDistance + o.dotWidth;
    if (dots > 1) off.dotAdjust += o.dotDotDistance * (dots - 1);
    off.dotAdjust *= mag;
    off.dotAdjust = Math.max(off.dotAdjust - off.dotAdjustThreshold, 0);
  }
  if (separation === 1) off.dotAdjust += 0.1;
}

/** `ChordLayout::applyChordOffsets`, puis `layoutChords3`. */
function applyChordOffsets(ctx, off) {
  const { posInfo } = ctx;
  for (const c of ctx.chords) {
    // seulement centré si la voix est séparée (`combineVoice` désactivé) et sans collision
    if (c.src.combine === false && !off.tracksToAdjust.has(c.track)) {
      c.moveX += c.up ? off.centerUp : off.centerDown;
      continue;
    }
    if (c.up) {
      if (off.upOffset !== 0) {
        const oversizeUp = ctx.o.tab ? off.oversizeUp / 2 : off.oversizeUp;
        c.moveX += off.upOffset + off.centerAdjustUp + oversizeUp;
        if (posInfo.downDots && !posInfo.upDots) c.moveX += off.dotAdjust;
      } else c.moveX += off.centerUp;
    } else if (off.downOffset !== 0) {
      c.moveX += off.downOffset + off.centerAdjustDown;
      if (posInfo.upDots && !posInfo.downDots) c.moveX += off.dotAdjust;
    } else c.moveX += off.centerDown;
  }
  const notes = [...(posInfo.upVoices ? posInfo.upStemNotes : []), ...(posInfo.downVoices ? posInfo.downStemNotes : [])];
  if (posInfo.upVoices + posInfo.downVoices > 1) notes.sort(byLineDesc);
  if (!ctx.o.tab) layoutChords3(ctx, notes);
}

/** `ChordLayout::getNoteListForDots` (une seule portée, sans portée voisine). */
function getNoteListForDots(ctx, c) {
  const topDownNotes = [];
  const bottomUpNotes = [];
  const anchoredDots = [];
  if (!c.src.hasVoices) {
    // seule cette voix : les notes sur une ligne de l'accord, de haut en bas
    for (const note of c.notes) {
      if (note.line & 1) {
        let newOffset = 0;
        const adjustDown = Boolean(c.voice & 1) && !c.up;
        if (anchoredDots.length && anchoredDots[anchoredDots.length - 1] === note.line) {
          if (anchoredDots.length >= 2 && anchoredDots[anchoredDots.length - 2] === note.line + (adjustDown ? 2 : -2)) newOffset = adjustDown ? -2 : 2;
          else newOffset = adjustDown ? 2 : -2;
        }
        anchoredDots.push(note.line + newOffset);
      } else topDownNotes.push(note);
    }
  } else {
    for (const voiceChord of ctx.chords) {
      const startFromTop = !((voiceChord.voice & 1) && !voiceChord.up);
      for (const note of voiceChord.notes) {
        if (note.line & 1) anchoredDots.push(note.line);
        else if (startFromTop) topDownNotes.push(note);
        else bottomUpNotes.push(note);
      }
    }
  }
  topDownNotes.sort((a, b) => a.line - b.line);
  bottomUpNotes.sort((a, b) => b.line - a.line);
  return { topDownNotes, bottomUpNotes, anchoredDots };
}

/** `ChordLayout::placeDots`. */
function placeDots(ctx, notes) {
  let chord = null;
  for (const c of ctx.chords) {
    if (c.dots > 0) { chord = c; break; }
    for (const n of c.notes) n.dotRel = 0;
  }
  if (!chord) return;
  const { topDownNotes, bottomUpNotes, anchoredDots } = getNoteListForDots(ctx, chord);
  for (const note of notes) {
    const onLine = !(note.line & 1);
    if (onLine) {
      const alreadyAdded = new Map();
      let finished = false;
      for (const other of bottomUpNotes) {
        if (other.visible !== note.visible) continue;
        let dotMove = other.dotPosition === 'up' ? -1 : 1;
        const otherDotLoc = other.line + dotMove;
        const added = alreadyAdded.has(otherDotLoc);
        if (!added && anchoredDots.includes(otherDotLoc)) dotMove = -dotMove;
        else if (added && alreadyAdded.get(otherDotLoc) !== other) dotMove = -dotMove;
        if (note === other) {
          note.dotRel = dotMove;
          finished = true;
          anchoredDots.push(note.line + dotMove);
          alreadyAdded.set(other.line + dotMove, other);
          break;
        }
      }
      if (!finished) {
        alreadyAdded.clear();
        for (const other of topDownNotes) {
          if (other.visible !== note.visible) continue;
          let dotMove = other.dotPosition === 'down' ? 1 : -1;
          const otherDotLoc = other.line + dotMove;
          const added = alreadyAdded.has(otherDotLoc);
          if (!added && anchoredDots.includes(otherDotLoc)) dotMove = -dotMove;
          else if (added && alreadyAdded.get(otherDotLoc) !== other) dotMove = -dotMove;
          if (note === other) {
            note.dotRel = dotMove;
            finished = true;
            anchoredDots.push(note.line + dotMove);
            break;
          }
          if (!added) alreadyAdded.set(other.line + dotMove, other);
        }
      }
      if (!finished) note.dotRel = 0; // ne devrait jamais arriver
    } else {
      // dans un interligne : à la hauteur de la tête, sauf unisson dans un même accord
      for (const other of note.chord.notes) {
        if (note === other) { note.dotRel = 0; break; }
        if (note.line === other.line) {
          const adjustDown = Boolean(note.chord.voice & 1) && !note.chord.up;
          note.dotRel = adjustDown ? 2 : -2;
          break;
        }
      }
    }
  }
}

/** `ChordLayout::setDotX` : x des points de chaque accord (conflits entre voix : tous alignés sur la même verticale). */
function setDotX(ctx, dotPos, upDotPosX, downDotPosX) {
  const { chords } = ctx;
  const upNoteLine = (c) => Math.min(...c.notes.map((n) => n.line)); // `upNote()` : la plus haute
  const downNoteLine = (c) => Math.max(...c.notes.map((n) => n.line)); // `downNote()` : la plus basse
  const combineConflicts = new Set();
  const separateConflicts = new Set();
  for (const c1 of chords) {
    for (const c2 of chords) {
      if (c1 === c2) continue;
      if (((c1.up && !c2.up && upNoteLine(c2) - downNoteLine(c1) < 2) || (!c1.up && c2.up && upNoteLine(c1) - downNoteLine(c2) < 2)) && combineVoice(c1, c2)) {
        combineConflicts.add(c1.track); combineConflicts.add(c2.track);
      } else if (((c1.up && c2.up && upNoteLine(c1) - downNoteLine(c2) < 2) || (!c1.up && !c2.up && upNoteLine(c1) - downNoteLine(c2) < 2)) && !combineVoice(c1, c2)) {
        separateConflicts.add(c1.track); separateConflicts.add(c2.track);
      }
    }
  }
  const maxPosX = Math.max(upDotPosX, downDotPosX);
  for (const c of chords) {
    const combineVoices = c.src.combine !== false;
    if (combineConflicts.size) {
      if (combineConflicts.has(c.track)) c.dotPosX = maxPosX;
      else c.dotPosX = combineVoices ? maxPosX : dotPos.get(c.voice);
    } else if (combineVoices) {
      if (separateConflicts.has(c.track)) c.dotPosX = dotPos.get(c.voice);
      else c.dotPosX = c.up ? upDotPosX : downDotPosX;
    } else c.dotPosX = dotPos.get(c.voice);
  }
}

/** `ChordLayout::layoutChords3` : sens des points, positions verticales, x des notes et des points. */
function layoutChords3(ctx, notes) {
  const { o } = ctx;
  const nNotes = notes.length;
  for (let i = nNotes - 1; i >= 0; i--) {
    const note = notes[i];
    let dotPosition = 'auto';
    const chord = note.chord;
    if (chord.dots) {
      if (nNotes > 1 && note.visible && !note.dotsHidden) {
        const line = note.line;
        let above = i < nNotes - 1 ? notes[i + 1] : null;
        if (above && (!above.visible || above.dotsHidden || above.chord.dots === 0 || !combineVoice(chord, above.chord))) above = null;
        const intervalAbove = above ? line - above.line : 1000;
        let below = i > 0 ? notes[i - 1] : null;
        if (below && (!below.visible || below.dotsHidden || below.chord.dots === 0 || !combineVoice(chord, below.chord))) below = null;
        const intervalBelow = below ? below.line - line : 1000;
        if ((line & 1) === 0) {
          // sur une ligne
          if (intervalAbove === 1 && intervalBelow !== 1) dotPosition = 'down';
          else if (intervalBelow === 1 && intervalAbove !== 1) dotPosition = 'up';
          else if (intervalAbove === 0 || intervalBelow === 0) dotPosition = 'auto'; // unisson : résolu plus loin
        } else if (intervalAbove === 0 && above.chord.dots) {
          // dans un interligne, unisson
          if (!(chord.voice & 1)) dotPosition = 'up';
          else if (!(above.chord.voice & 1)) above.dotPosition = 'up';
          else dotPosition = 'down';
        }
      }
    }
    if (dotPosition === 'auto') dotPosition = chord.voice & 1 ? 'down' : 'up';
    note.dotPosition = dotPosition;
  }
  placeDots(ctx, notes);

  const dotPos = new Map(); // x des points de chaque VOIX (`dotPos[idx]`)
  for (const c of ctx.chords) dotPos.set(c.voice, 0);
  let upDotPosX = 0;
  let downDotPosX = 0;
  for (const c of ctx.chords) {
    const up = c.up;
    const overlapMirror = c.src.hasStem ? o.stemWidth * c.mag : c.src.headType === 'whole' ? o.stemWidth * c.mag : 0;
    let minDotPosX = 0;
    const chordNotes = [...c.notes].sort((a, b) => a.line - b.line);
    for (const note of chordNotes) {
      let noteX = 0;
      if (note.mirror) {
        if (up) noteX = stemPosX(c) - overlapMirror;
        else noteX = -note.src.body + overlapMirror;
      } else if (up) noteX = o.nominal * c.mag - note.src.body;
      const dotX = noteX + note.src.body + c.moveX;
      if (c.dots) dotPos.set(c.voice, Math.max(dotPos.get(c.voice), dotX));
      note.x = noteX;
      minDotPosX = Math.max(minDotPosX, dotX);
    }
    if (c.dots) {
      if (c.up) upDotPosX = Math.max(upDotPosX, minDotPosX);
      else downDotPosX = Math.max(downDotPosX, minDotPosX);
    }
  }
  setDotX(ctx, dotPos, upDotPosX, downDotPosX);

  /** `StemLayout::stemPosX` (portée de notation) : x de la hampe d'un accord, dans le repère de l'accord. */
  function stemPosX(c) {
    const refNote = c.up ? c.notes[c.notes.length - 1] : c.notes[0]; // `upNote()` : la plus haute (dernière par ligne décroissante) / `downNote()`
    const attach = c.up ? refNote.src.stemUpX : refNote.src.stemDownX;
    if (attach == null) return c.up ? o.nominal * c.mag : 0;
    const noteWidthOffset = c.up ? refNote.src.body - o.nominal * c.mag : 0;
    return attach - noteWidthOffset;
  }
}
