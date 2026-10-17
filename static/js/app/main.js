// App entry: loads configuration, fonts and the signed-in user, then routes
// between the Studio (your video) and the Demo (example videos).
import { setCatalogue } from '../engine/fonts.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { leaveProject } from './session.js';
import { set, state } from './store.js';
import { renderStudio } from './studio.js';
import { $, $$, toast } from './ui.js';

async function boot() {
  $('#brand-mark').innerHTML = icon('logo');
  const [config, fonts, me] = await Promise.all([api('/api/config'), api('/api/fonts'), api('/api/me').catch(() => null)]);
  setCatalogue(fonts, '/fonts/');
  set({ config, user: me });
  showUser(me);
  const r = config.retention;
  const chip = $('#privacy-chip');
  chip.innerHTML = `${icon('lock')}<span>Files auto-delete · nothing stored</span>`;
  chip.title = `Videos and captions are deleted ${r.downloadGraceMin} min after download, or ${Math.round(r.jobTtlMin / 6) / 10} h after your last activity.`;
  window.addEventListener('hashchange', route);
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

let demoModule = null;
async function route() {
  const [, name = 'studio', arg] = location.hash.match(/^#\/?([\w-]+)?\/?([\w-]+)?/) || [];
  const routeName = name === 'demo' ? 'demo' : 'studio';
  $$('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.route === routeName ? 'page' : 'false'));
  const view = $('#view');
  if (routeName === 'demo') {
    // Opening the demo never touches the user's own project.
    demoModule ||= await import('./demo.js');
    view.className = 'demo';
    demoModule.renderDemo(view, arg);
  } else {
    demoModule?.stopDemo?.();
    view.className = 'studio';
    renderStudio(view);
  }
  set({ route: routeName }, 'route');
}

window.addEventListener('pagehide', () => { if (state.project?.kind) leaveProject({ beacon: true }); });
window.addEventListener('beforeunload', (e) => {
  if (state.project && state.captions.length && !state.project.exported) { e.preventDefault(); e.returnValue = ''; }
});

boot().catch((e) => toast(`Caption Studio couldn't start: ${e.message}`, 'error', 15000));
