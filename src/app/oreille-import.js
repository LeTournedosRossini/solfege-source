// Import d'un document Scorsaire (fichier .scorsaire, ou « note » de Scorsaire) : chaque mouvement devient une phrase du répertoire.
import { loadWork } from '../../vendor/scorsaire/src/model/serialize.js';
import { createNoteDocument } from '../../vendor/scorsaire/src/note/document.js';

/** Texte d'un fichier → liste de { title, measures, noteDoc } (un élément par mouvement). Lève une Error au message lisible si le fichier n'est pas valide. */
export function lireDocumentScorsaire(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce fichier n’est pas un document Scorsaire (texte illisible).'); }
  const src = data?.format === 'scorsaire-note' ? data.work : data;
  let work;
  try { work = loadWork(src); } catch (e) { throw new Error(`Document Scorsaire non reconnu : ${e.message}`); }
  if (!work.movements.length) throw new Error('Ce document ne contient aucun mouvement.');
  return work.movements.map((mv, i) => ({
    title: (mv.title || '').trim() || (work.title ? `${work.title} — ${i + 1}` : `Mouvement ${i + 1}`),
    measures: mv.masterbars.length,
    noteDoc: createNoteDocument({ ...work, movements: [mv] }),
  }));
}
