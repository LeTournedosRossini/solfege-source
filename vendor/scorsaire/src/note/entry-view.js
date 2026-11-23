// Entry of the VIEW bundle (the pupil's side): registers <scorsaire-note>.
import { defineScorsaireNote, setDefaultSoundsBase } from './view.js';
setDefaultSoundsBase(new URL('./sounds/', import.meta.url));
defineScorsaireNote();
