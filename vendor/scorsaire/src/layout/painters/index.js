/* Enregistre les peintres fournis avec le moteur. */
import { registerStaffPainter } from './registry.js';
import { scorePainter } from './score.js';
import { tabPainter } from './tab.js';
import { percussionPainter } from './percussion.js';
import { accordionPainter } from './accordion.js';
import { chordPainter } from './chord.js';
import { rhythmPainter, neutralPainter } from './rhythm.js';
import { lyricsPainter } from './lyrics.js';

registerStaffPainter('score', scorePainter);
registerStaffPainter('tab', tabPainter);
registerStaffPainter('percussion', percussionPainter);
registerStaffPainter('accordion-left', accordionPainter);
registerStaffPainter('chord', chordPainter);
registerStaffPainter('rhythm', rhythmPainter);
registerStaffPainter('neutral', neutralPainter);
registerStaffPainter('lyrics', lyricsPainter);

export { registerStaffPainter, staffPainterFor, registeredStaffTypes } from './registry.js';
export { emptyPainter } from './empty.js';
