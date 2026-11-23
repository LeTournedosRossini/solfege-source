/*
 * « Publish on GitHub », WITHOUT any token (12/11/2026, decision of Jean): the page that holds a YouTube link (never the audio files: they are far too heavy) is downloaded, then the person drops it on
 * the upload page of THEIR repository — GitHub Pages serves it. This module is PURE (names, addresses and texts); the window is `ui/github-publish-dialog.js`.
 * The upload address is `https://github.com/<owner>/<repo>/upload/main/<folder>` (the web page of GitHub that takes a file dragged on it); the page then lives at
 * `https://<owner>.github.io/<repo>/<folder>/<file>` — or `https://<owner>.github.io/<file>` for the repository named `<owner>.github.io`.
 */
export const TEMPLATE_OWNER = 'LeTournedosRossini';
export const TEMPLATE_REPO = 'scorsaire-publication-modele';
/** The pages GitHub's browser upload takes: 25 MB at most per file. */
export const WEB_UPLOAD_LIMIT = 25 * 1024 * 1024;

export const templateUrl = () => `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}`;
/** The GitHub page that creates a new repository from the template (the person chooses the name there). */
export const useTemplateUrl = () => `https://github.com/new?template_owner=${TEMPLATE_OWNER}&template_name=${TEMPLATE_REPO}`;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * The repository a person typed or pasted: `owner/repo`, `github.com/owner/repo/...`, `https://github.com/owner/repo.git`, or the address of their page
 * (`https://owner.github.io/repo/...`, `https://owner.github.io/`). Returns { owner, repo } or null.
 */
export function parseRepo(text) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  let owner; let repo;
  const site = /^([A-Za-z0-9-]+)\.github\.io(?:\/([^/]+))?/i.exec(s);
  if (site) { owner = site[1]; repo = site[2] ?? `${site[1]}.github.io`; } else {
    const parts = s.replace(/^(?:www\.)?github\.com\//i, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    [owner, repo] = parts;
  }
  repo = repo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** A folder inside the repository: '' (the root) or `a/b` — letters, digits, dot, dash, underscore. Returns the cleaned folder, or null when it is not usable. */
export function cleanFolder(text) {
  const parts = String(text ?? '').trim().split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => !/^[A-Za-z0-9._-]+$/.test(p) || p === '.' || p === '..')) return null;
  return parts.join('/');
}

/** A file name that makes a clean web address: no accent, no space, `.html` at the end. */
export function pageFileName(name) {
  const base = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.html?$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return `${base || 'partition'}.html`;
}

const inFolder = (folder) => (folder ? `${folder}/` : '');
/** The upload page of the repository (branch `main`, the folder in the address). */
export const uploadUrl = ({ owner, repo, folder = '' }) => `https://github.com/${owner}/${repo}/upload/main${folder ? `/${folder}` : ''}`;
/** Where the page will be once GitHub Pages has built the site. */
export function pageUrl({ owner, repo, folder = '', file }) {
  const host = `https://${owner.toLowerCase()}.github.io`;
  return `${host}/${repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `${repo}/`}${inFolder(folder)}${file}`;
}

/**
 * The text a person pastes into an AI assistant to be guided step by step. It names what they want, what they already have, the steps, and forbids passwords and tokens in the conversation.
 * `lang` 'fr' | 'en'. `repo` ({ owner, repo } or null), `folder`, `file` (the downloaded file name).
 */
export function helpPrompt({ lang = 'fr', repo = null, folder = '', file = 'partition.html' } = {}) {
  const fr = lang !== 'en';
  const target = repo ? pageUrl({ ...repo, folder, file }) : null;
  const upload = repo ? uploadUrl({ ...repo, folder }) : null;
  const mine = repo ? `${repo.owner}/${repo.repo}${folder ? ` (${fr ? 'dossier' : 'folder'} ${folder})` : ''}` : null;
  if (fr) {
    return [
      'Je veux mettre une page web sur Internet avec GitHub Pages, gratuitement. Je n\'y connais rien : guide-moi pas à pas, UNE étape à la fois, en français simple, et attends ma réponse avant de passer à la suivante.',
      '',
      `Contexte : la page vient de mon logiciel Scorsaire (un éditeur de partitions). C'est un seul fichier HTML, « ${file} », qui montre ma partition avec une vidéo YouTube. Il ne contient aucun fichier audio. Je l'ai déjà téléchargé sur mon ordinateur.`,
      mine ? `Mon dépôt GitHub : ${mine}.` : 'Je n\'ai peut-être pas encore de compte ni de dépôt GitHub : demande-moi où j\'en suis.',
      target ? `Mon objectif : que la page soit visible à l'adresse ${target}` : 'Mon objectif : que la page soit visible par n\'importe qui avec un lien.',
      '',
      'Ce que je dois faire, à m\'expliquer :',
      '1. Créer un compte GitHub gratuit si je n\'en ai pas.',
      `2. Créer un dépôt PUBLIC (le plus simple : à partir du modèle ${templateUrl()}, bouton « Use this template » puis « Create a new repository »).`,
      '3. Activer GitHub Pages : Settings > Pages > « Deploy from a branch », branche main, dossier « / (root) », puis Save.',
      `4. Déposer mon fichier : ${upload ?? 'page « Add file > Upload files » de mon dépôt'} (glisser le fichier, puis « Commit changes »).`,
      '5. Attendre quelques minutes (parfois jusqu\'à une demi-heure), puis ouvrir l\'adresse de la page.',
      '6. Si la page ne s\'affiche pas : m\'indiquer quoi vérifier.',
      '',
      'Règles : ne me demande JAMAIS mon mot de passe ni un « token » (jeton) : je ne dois pas les écrire dans cette conversation. Rappelle-moi aussi que tout ce que je mets dans un dépôt public est visible par tout le monde.',
    ].join('\n');
  }
  return [
    'I want to put a web page on the Internet with GitHub Pages, for free. I know nothing about it: guide me step by step, ONE step at a time, in plain English, and wait for my answer before the next one.',
    '',
    `Context: the page comes from my software Scorsaire (a music score editor). It is a single HTML file, "${file}", that shows my score with a YouTube video. It contains no audio file. I have already downloaded it to my computer.`,
    mine ? `My GitHub repository: ${mine}.` : 'I may not have a GitHub account or repository yet: ask me where I stand.',
    target ? `My goal: the page should be visible at ${target}` : 'My goal: the page should be visible to anyone with a link.',
    '',
    'What I have to do, to be explained to me:',
    '1. Create a free GitHub account if I do not have one.',
    `2. Create a PUBLIC repository (the easiest: from the template ${templateUrl()}, "Use this template" then "Create a new repository").`,
    '3. Turn on GitHub Pages: Settings > Pages > "Deploy from a branch", branch main, folder "/ (root)", then Save.',
    `4. Upload my file: ${upload ?? '"Add file > Upload files" page of my repository'} (drag the file, then "Commit changes").`,
    '5. Wait a few minutes (sometimes up to half an hour), then open the address of the page.',
    '6. If the page does not show: tell me what to check.',
    '',
    'Rules: NEVER ask me for my password or a "token": I must not type them in this conversation. Also remind me that anything I put in a public repository is visible to everyone.',
  ].join('\n');
}
