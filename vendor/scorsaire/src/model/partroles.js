/*
 * ROLES of the layouts made for a tablet: a short code saying what the layout is for, so that a musician can tell the Lecteur once "I always read DRMS" and get the right
 * layout in every work, whatever the author named it. The name stays free; the role is a separate property of the part (`PID.PART_ROLE`). The presets are the usual
 * abbreviations of a rehearsal chart; the model accepts any short code (upper case, up to 12 characters) so that nobody is held to the list.
 */
/** The presets, in menus by family (the order is the order of the menus). */
export const ROLE_GROUPS = Object.freeze([
  { id: 'rhythm', roles: ['DRMS', 'PERC', 'BSS', 'GTR', 'RGTR', 'LGTR', 'AC-GTR', 'KEYS', 'PNO', 'CHORDS'] },
  { id: 'strings', roles: ['VLN1', 'VLN2', 'VLA', 'VLC', 'CTR-BSS'] },
  { id: 'woodwinds', roles: ['FLT', 'OBOE', 'CLAR', 'BSN', 'SAX-A1', 'SAX-A2', 'SAX-T1', 'SAX-T2', 'SAX-B'] },
  { id: 'brass', roles: ['TPT1', 'TPT2', 'TPT3', 'TPT4', 'TBN1', 'TBN2', 'TBN3', 'TBN4', 'TBN-B', 'HORN', 'TUBA'] },
  { id: 'voices', roles: ['VOX', 'BVOX', 'LEAD'] },
]);
export const PART_ROLES = Object.freeze(ROLE_GROUPS.flatMap((g) => g.roles));
export const ROLE_MAX = 12;

/** The clean code of a role, or null when there is none. */
export const normalizeRole = (value) => {
  const code = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '').slice(0, ROLE_MAX);
  return code || null;
};
