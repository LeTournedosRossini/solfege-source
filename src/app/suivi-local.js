// Accès au suivi depuis le navigateur : le stockage local de l'appareil, avec tous les échecs absorbés (navigation privée, stockage plein : jamais d'erreur visible).
import { enregistrer, marquerLecon, charger, etats } from './suivi.js';
const stock = () => { try { return window.localStorage; } catch { return null; } };
/** Enregistre une réponse { j, e, m, ok, r?, c? }. */
export const noter = (ev) => { const s = stock(); if (!s) return false; try { return enregistrer(s, ev); } catch { return false; } };
export const noterLecon = (id, etat) => { const s = stock(); if (!s) return false; try { return marquerLecon(s, id, etat); } catch { return false; } };
export const donnees = () => { const s = stock(); return s ? charger(s) : { v: 1, evts: [], lecons: {} }; };
export const etatsActuels = () => etats(donnees().evts);
