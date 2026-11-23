/*
 * Extraits d'écoute de la démo (moteur audio V1, 11/10/2026) : de courtes démonstrations à juger à l'oreille. Chaque extrait réutilise une
 * œuvre d'exemple de `samples.js` (jamais une partition inventée à côté) en donnant un instrument du catalogue à ses pistes, avec
 * éventuellement des options de `buildSequence` DÉJÀ existantes et une plage de mesures à boucler.
 * Forme : { id, label (clé i18n), work, options, loop? } — loop = { movement, from, to } (indices de mesure).
 */
import {
  sampleTimbresWork, sampleJumpsWork, sampleTempoWork, samplePedalWork, sampleChordSymbolsWork, sampleTrillsWork,
  sampleTablatureTechniquesWork, samplePercussionWork, withInstrument,
} from './samples.js';

export function listeningExcerpts() {
  return [
    { id: 'timbres', label: 'listen.timbres', work: sampleTimbresWork(), options: {} },
    { id: 'jumps', label: 'listen.jumps', work: withInstrument(sampleJumpsWork(), 'piano'), options: {} },
    { id: 'tempo', label: 'listen.tempo', work: withInstrument(sampleTempoWork(), 'piano'), options: {} },
    { id: 'ornaments', label: 'listen.ornaments', work: withInstrument(sampleTrillsWork(), 'piano'), options: {} },
    { id: 'bends', label: 'listen.bends', work: withInstrument(sampleTablatureTechniquesWork(), 'guitar-steel'), options: {}, loop: { movement: 0, from: 5, to: 11 } },
    { id: 'pedal', label: 'listen.pedal', work: withInstrument(samplePedalWork(), 'piano'), options: {} },
    { id: 'chords', label: 'listen.chords', work: withInstrument(sampleChordSymbolsWork(), 'piano'), options: { chordSymbols: { play: true } } },
    { id: 'percussion', label: 'listen.percussion', work: samplePercussionWork(), options: {} },
  ];
}
