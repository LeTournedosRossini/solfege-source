/*
 * Vue ÉCRITE d'un accord de concert (hauteur sonnante) pour une portée d'instrument transpositeur.
 *
 * Le modèle stocke la hauteur de CONCERT (`PID.PITCH`) et son orthographe de concert. La mise en page, elle, ne sait placer que des
 * notes écrites : `writtenChord` fabrique, sans toucher au modèle, un accord dont chaque note expose `pitch` et `spelling` ÉCRITS
 * (`Note::epitch`, `Note::tpc2` de MuseScore ; voir `model/transpose.js`), y compris pour ses notes d'ornement. Tout le reste
 * (identifiants, propriétés, durée…) est hérité de l'élément d'origine par la chaîne de prototypes : les références (`ref`, ids) ne changent pas.
 */
import { PID, getProperty, writtenSpelling, writtenPitch } from '../model/index.js';
import { spellingOf } from './pitchpos.js';

const hidden = (value) => ({ value, enumerable: false, configurable: true });

/**
 * @param chord  accord du modèle
 * @param conv   { iv, concertKey, prefer } — intervalle de l'instrument (écrit → sonnant), armure de CONCERT de la mesure, préférence
 */
export function writtenChord(chord, conv) {
  if (!chord || !chord.notes) return chord;
  const notes = chord.notes.map((note) => {
    const pitch = getProperty(note, PID.PITCH);
    // orthographe de concert : celle du modèle, sinon celle par défaut selon l'armure de concert (`Note::setTpcFromPitch`)
    const concert = spellingOf(pitch, getProperty(note, PID.SPELLING), conv.concertKey);
    return Object.create(note, {
      pitch: hidden(writtenPitch(pitch, conv.iv)),
      spelling: hidden(writtenSpelling(pitch, concert, conv.iv, conv.concertKey, conv.prefer)),
    });
  });
  const props = { notes: hidden(notes) };
  if (chord.graceNotes && chord.graceNotes.length) props.graceNotes = hidden(chord.graceNotes.map((g) => writtenChord(g, conv)));
  return Object.create(chord, props);
}
