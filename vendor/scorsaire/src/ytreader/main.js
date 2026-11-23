/*
 * The YOUTUBE READER (read only): a video with the fragments of score (movements) that the author placed on its timeline in mode B of screen 4. It opens a `.scorsaire`
 * ZIP with `source: 'youtube'` from a file the person picks or from an address (`?file=` or `#file=`). The video plays in its frame (the sound is YouTube's); under it the
 * score shows the fragment that is on the video at that moment and its playhead moves in proportion. The score itself is silent in this version. The page must be served
 * over http(s): YouTube refuses to show its player in a file opened from the disk (error 153).
 */
import { createYouTubePlayer } from '../audio/youtubeplayer.js';
import { readWorkBytes, bootReader, embeddedBytes } from '../reader/core.js';
import { mountYoutubeView, cleanData } from './view.js';
import { createI18n } from '../i18n/index.js';
import { mountThemeToggle } from '../reader/theme-toggle.js';
import { mountPortalButtonSize } from '../reader/portal-prefs.js';
import { applyWho } from '../reader/pupils.js';
import { parseStartParams } from '../reader/startparams.js';
import { pageParams } from '../reader/access.js';

const lang = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2);
const t = createI18n(['fr', 'en'].includes(lang) ? lang : 'fr');

/** Plays the video `info.youtube.videoId` of `sync.info` with the placements, the banner and the display options it holds, showing `work`. Returns { destroy }. */
export async function mountYoutube(host, { work, sync, player = createYouTubePlayer(), start = null }) {
  applyWho(work, start?.who ?? null); // the names of the players (`who=` of the address)
  const data = cleanData(work, sync.info);
  if (!data.placements.length || data.problems.length) throw new Error(t('ytreader.noPlacements'));
  return mountYoutubeView(host, { work, data, player, pupils: start && (start.tracks || start.trackShifts || start.who || start.lyrics) ? start : null });
}

function boot() {
  const host = document.getElementById('app');
  mountPortalButtonSize({ storage: (() => { try { return window.localStorage; } catch { return null; } })() }); // the size of the buttons chosen on the school portal (same domain)
  mountThemeToggle({ storage: (() => { try { return window.localStorage; } catch { return null; } })(), label: (next) => t(next === 'dark' ? 'reader.themeDark' : next === 'hc' ? 'reader.themeHc' : 'reader.themeLight') });
  let current = null;
  bootReader(host, {
    t, pickerKey: 'ytreader.openFile', embedded: () => embeddedBytes('scorsaire-file'),
    open: async (bytes) => {
      const r = await readWorkBytes(bytes);
      if (!r.sync || r.sync.info.source !== 'youtube') throw new Error(t('ytreader.notYoutube'));
      if (location.protocol === 'file:') throw new Error(t('youtube.needsHttp'));
      current?.destroy();
      current = await mountYoutube(host, { work: r.work, sync: r.sync, start: parseStartParams(pageParams()) });
    },
  });
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
