/*
 * The file button of the bottom dock: open, save, new, export, tracks and staves, settings, screen 1 / 2. Each action is a callback of the page (`main.js`) and closes what it opened.
 * A computer (the button is in the page header): a traditional drop-down menu. A tablet or a phone: a sheet from the bottom with the actions written out in words
 * (`bottom-sheet.js`; the row of icons that used to take the bottom of the dock had to be guessed).
 */
import { icon } from './icons.js';
import { createHeaderMenu, menuRow, menuSeparator } from './header-menu.js';
import { openBottomSheet } from './bottom-sheet.js';
import { SHEET_QUERY } from './panel-mode.js';

export function mountFileDrawer({ dock, label = (k) => k, actions }) {
  const button = document.createElement('button');
  button.type = 'button'; button.title = label('dock.file'); button.setAttribute('aria-label', label('dock.file')); button.setAttribute('data-action', 'file-drawer');
  button.append(icon('folder-open'));
  button.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative';
  dock.bottomBase.append(button);
  let screenValue = actions.screenValue?.() ?? 'one';
  // tablet / phone: the panels and the settings are buttons of the bottom row (there is room, and they are reached in one touch); a computer reaches them through the drop-down menu
  const panelButton = (name, title, run, act) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.setAttribute('data-action', act);
    b.append(icon(name));
    b.style.cssText = 'min-width:var(--ui-target,44px);min-height:var(--ui-target,44px);flex:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;position:relative';
    b.addEventListener('click', () => { actions.beforeOpen?.(); run(); });
    dock.bottomBase.append(b);
    return b;
  };
  const tracksTitle = () => label(screenValue === 'two' ? 'tracks.titleScreen2' : 'tracks.titleScreen1');
  const tracksBtn = panelButton('layers', tracksTitle(), actions.tracks, 'file-tracks');
  const badge = document.createElement('span'); badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText = 'position:absolute;right:3px;bottom:2px;font:var(--w-bold,700) 11px var(--ui-font,sans-serif);line-height:1;background:#111;color:#fff;border-radius:6px;padding:1px 4px';
  tracksBtn.append(badge);
  const paintTracks = () => { badge.textContent = screenValue === 'two' ? '2' : '1'; tracksBtn.title = tracksTitle(); tracksBtn.setAttribute('aria-label', tracksBtn.title); };
  paintTracks();
  const panelButtons = [
    tracksBtn,
    ...(actions.workPanel ? [
      panelButton('file', label('headerTabs.work'), () => actions.workPanel('work'), 'file-work'),
      panelButton('columns-2', label('headerTabs.movement'), () => actions.workPanel('movement'), 'file-movement'),
    ] : []),
    panelButton('settings', label('settings.title'), actions.settings, 'file-settings'),
  ];
  const sync = () => {
    const mode = dock.bottomMode();
    button.style.display = mode && !dock.inHeader?.() ? 'none' : ''; // another drawer (note entry, views…) takes the bottom row
    for (const b of panelButtons) b.style.display = dock.inHeader?.() || mode ? 'none' : '';
  };
  const offMode = dock.onMode(sync); sync();
  const mq = window.matchMedia?.(SHEET_QUERY);
  mq?.addEventListener?.('change', sync);
  // computers (the button is in the page header): a traditional drop-down menu instead of the drawer
  const menu = createHeaderMenu({ button, onClose: () => { button.setAttribute('aria-pressed', 'false'); }, build: (m, close) => {
    const row = (name, text, run, act) => m.append(menuRow({ icon: icon(name), text, run, act }, close));
    if (actions.portal) { // portal mode: the score belongs to the portal's library: save there, keep a copy, go back (no Open / New / added audio)
      row('save', label('file.savePortal'), actions.save, 'file-save');
      row('download', label('file.saveCopy'), actions.portal.saveCopy, 'file-save-copy');
      if (actions.portal.canBack?.() ?? true) row('arrow-left', label('file.backPortal'), actions.portal.back, 'file-back-portal');
    } else {
    row('folder-open', label('file.open'), actions.open, 'file-open');
    row('save', label('file.save'), actions.save, 'file-save');
    row('file-plus', label('file.new'), actions.newScore, 'file-new');
    if (actions.newYouTube) row('play', label('file.youtube'), actions.newYouTube, 'file-youtube');
    if (actions.addParts && actions.canAddParts?.()) row('file-plus', label('file.addParts'), actions.addParts, 'file-add-parts');
    if (actions.addAudio && actions.canAddAudio?.()) row('file-plus', label('file.addAudio'), actions.addAudio, 'file-add-audio');
    if (actions.createSync && actions.canCreateSync?.()) row('play', label('file.createSync'), actions.createSync, 'file-create-sync');
    if (actions.redoSync && actions.canRedoSync?.()) row('play', label('file.redoSync'), actions.redoSync, 'file-redo-sync');
    if (actions.editSync && actions.canEditSync?.()) row('settings', label('file.editSync'), actions.editSync, 'file-edit-sync');
    if (actions.recueil) row('book-open', label('recueil.menu'), actions.recueil, 'file-recueil');
    if (actions.share) row('link', label('share.menu'), actions.share, 'file-share');
    if (actions.pupilLinks) row('link', label('pupilLinks.menu'), actions.pupilLinks, 'file-pupil-links');
    }
    m.append(menuSeparator());
    for (const [v, text] of actions.exportOptions) m.append(menuRow({ icon: icon('download'), text, run: () => actions.onExport(v), act: `export-${v}` }, close));
    m.append(menuSeparator());
    const two = screenValue === 'two';
    row('layers', label(two ? 'tracks.titleScreen2' : 'tracks.titleScreen1'), actions.tracks, 'file-tracks');
    if (actions.workPanel) { row('file', label('headerTabs.work'), () => actions.workPanel('work'), 'file-work'); row('columns-2', label('headerTabs.movement'), () => actions.workPanel('movement'), 'file-movement'); }
    row('settings', label('settings.title'), actions.settings, 'file-settings');
  } });
  // a tablet or a phone: the same actions as the menu of a computer, written out in a sheet from the bottom (the icons of the drawer had to be guessed)
  function openFileSheet() {
    const row = (name, text, run, act, hint) => ({ icon: icon(name), text, hint, run, act });
    const file = actions.portal ? [
      row('save', label('file.savePortal'), actions.save, 'file-save'),
      row('download', label('file.saveCopy'), actions.portal.saveCopy, 'file-save-copy'),
      ...(actions.portal.canBack?.() ?? true ? [row('arrow-left', label('file.backPortal'), actions.portal.back, 'file-back-portal')] : []),
    ] : [
      row('folder-open', label('file.open'), actions.open, 'file-open'),
      row('save', label('file.save'), actions.save, 'file-save'),
      row('file-plus', label('file.new'), actions.newScore, 'file-new'),
      ...(actions.newYouTube ? [row('play', label('file.youtube'), actions.newYouTube, 'file-youtube')] : []),
      ...(actions.addParts && actions.canAddParts?.() ? [row('file-plus', label('file.addParts'), actions.addParts, 'file-add-parts')] : []),
      ...(actions.addAudio && actions.canAddAudio?.() ? [row('file-plus', label('file.addAudio'), actions.addAudio, 'file-add-audio')] : []),
      ...(actions.createSync && actions.canCreateSync?.() ? [row('play', label('file.createSync'), actions.createSync, 'file-create-sync')] : []),
      ...(actions.redoSync && actions.canRedoSync?.() ? [row('play', label('file.redoSync'), actions.redoSync, 'file-redo-sync')] : []),
      ...(actions.editSync && actions.canEditSync?.() ? [row('settings', label('file.editSync'), actions.editSync, 'file-edit-sync')] : []),
      ...(actions.recueil ? [row('book-open', label('recueil.menu'), actions.recueil, 'file-recueil')] : []),
      ...(actions.share ? [row('link', label('share.menu'), actions.share, 'file-share')] : []),
      ...(actions.pupilLinks ? [row('link', label('pupilLinks.menu'), actions.pupilLinks, 'file-pupil-links')] : []),
    ];
    const exports = actions.exportOptions.map(([v, text]) => row('download', text, () => actions.onExport(v), `export-${v}`));
    button.setAttribute('aria-pressed', 'true');
    openBottomSheet({
      title: label('file.sheetTitle'), logo: actions.sheetLogo?.() ?? null, closeLabel: label('file.sheetClose'), anchor: button, onClose: () => button.setAttribute('aria-pressed', 'false'),
      sections: [{ items: file }, { heading: label('file.export').replace(/…$/, ''), items: exports }], // (the panels and the settings are buttons of the bottom row)
    });
  }
  button.addEventListener('click', () => {
    if (dock.inHeader?.()) { actions.beforeOpen?.(); menu.toggle(); button.setAttribute('aria-pressed', String(menu.isOpen())); return; }
    actions.beforeOpen?.(); // leaving the note entry before the file actions take the row
    openFileSheet();
  });
  return {
    button,
    setScreen(v) { screenValue = v; paintTracks(); },
    destroy() { menu.close(); offMode(); mq?.removeEventListener?.('change', sync); button.remove(); panelButtons.forEach((b) => b.remove()); },
  };
}
