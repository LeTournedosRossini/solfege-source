// Entry of the SCALE bundle: registers <scorsaire-scale> (and the note viewer it draws the staff and the tablature with).
import { setDefaultSoundsBase } from '../note/view.js';
import { defineScorsaireScale } from './component.js';
setDefaultSoundsBase(new URL('./sounds/', import.meta.url));
defineScorsaireScale();
