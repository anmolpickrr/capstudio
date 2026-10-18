// App entry: loads configuration, fonts and the signed-in user, then shows the Studio.
import { setCatalogue } from '../engine/fonts.js';
import { api } from './api.js';
import { leaveProject } from './session.js';
import { set, state } from './store.js';
import { renderStudio } from './studio.js';
import { $, toast } from './ui.js';

async function boot() {
  const [config, fonts, me] = await Promise.all([api('/api/config'), api('/api/fonts'), api('/api/me').catch(() => null)]);
  setCatalogue(fonts, '/fonts/');
  set({ config, user: me });
  showUser(me);
  const r = config.retention;
  const chip = $('#privacy-chip');
  chip.textContent = 'Your files are deleted after you download';
  chip.title = `Videos and captions are deleted ${r.downloadGraceMin} min after download, or ${Math.round(r.jobTtlMin / 6) / 10} h after your last activity.`;
  route();
}

function showUser(me) {
  if (!me || me.email === 'local@localhost') return;
  $('#user').hidden = false;
  $('#user-name').textContent = me.name || me.email;
  $('#user').title = me.email;
  const av = $('#user-avatar');
  if (me.picture) av.style.backgroundImage = `url("${me.picture}")`;
  else av.textContent = (me.name || me.email).trim()[0].toUpperCase();
}

function route() {
  // One page: the Studio. Old links (e.g. #/demo) land here too.
  const view = $('#view');
  view.className = 'studio';
  renderStudio(view);
  set({ route: 'studio' }, 'route');
  // the github.io address shows this page in a frame, behind its own loading screen
  if (window.parent !== window) window.parent.postMessage('capstudio-ready', '*');
}

window.addEventListener('pagehide', () => { if (state.project?.kind) leaveProject({ beacon: true }); });
window.addEventListener('beforeunload', (e) => {
  if (state.project && state.captions.length && !state.project.exported) { e.preventDefault(); e.returnValue = ''; }
});

// The address the team uses. GitHub Pages only hosts these files, without the server
// that makes captions, so a copy opened there points people to the live site instead.
const LIVE_SITE = 'https://caption-studio-ujgd.onrender.com';

function showFilesOnlyCopy() {
  $('#view').className = 'welcome';
  $('#view').innerHTML = `<div class="moved">
    <img src="logo.svg" alt="Capstudio by Fastrr" width="163" height="48">
    <h1>Capstudio lives at a new address</h1>
    <p>This page only holds the app's files, so it can't make captions or export videos.</p>
    <a class="btn brand lg" href="${LIVE_SITE}">Open Capstudio</a>
    <small>${LIVE_SITE.replace('https://', '')}</small></div>`;
}

boot().catch((e) => {
  if (location.hostname.endsWith('github.io')) showFilesOnlyCopy();
  else toast(`Capstudio couldn't start: ${e.message}`, 'error', 15000);
});
