// Entry of the EDIT bundle (the teacher's side): <scorsaire-note> that also writes. It contains the viewer.
import { setDefaultSoundsBase } from './view.js';
import { defineScorsaireNoteEdit } from './edit.js';
setDefaultSoundsBase(new URL('./sounds/', import.meta.url));
defineScorsaireNoteEdit();
