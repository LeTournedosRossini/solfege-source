// Les 25 leçons regroupées en quatre parcours thématiques (NAV-03, annexe A du cahier). Chaque leçon appartient à un seul parcours ; l'ordre est celui conseillé pour les suivre.
export const PARCOURS = [
  { id: 'lire', titre: 'Lire la musique', resume: 'La portée, les notes, les durées, la mesure : de quoi déchiffrer une partition simple.',
    lecons: ['portee-cles', 'notes-de-musique', 'figures-de-note', 'alterations', 'mesure-temps', 'silences-liaisons'] },
  { id: 'gammes', titre: 'Gammes et tonalités', resume: 'Les gammes, les armures, les degrés, les modes et la transposition.',
    lecons: ['gammes-majeures', 'gammes-mineures', 'cercle-quintes', 'degres-gamme', 'modes-grecs', 'transposition'] },
  { id: 'accords', titre: 'Intervalles et accords', resume: 'Des intervalles aux accords, à l’harmonisation et aux cadences.',
    lecons: ['intervalles', 'accords-base', 'accords-septieme', 'harmonisation-degres', 'substitution-accords', 'basse-chiffree', 'cadences'] },
  { id: 'expression', titre: 'Expression et forme', resume: 'Nuances, reprises, ornements, articulations et forme d’un morceau.',
    lecons: ['nuances-tempo', 'signes-reprise', 'ornements', 'chromatisme', 'forme-musicale', 'articulations'] },
];
export const parcoursDe = (leconId) => PARCOURS.find((p) => p.lecons.includes(leconId));
