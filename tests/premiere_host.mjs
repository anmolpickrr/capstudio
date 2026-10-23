// The Premiere-side script (premiere/host/host.jsx): it must be plain ES3 (Premiere's
// ExtendScript), and it's run here against a stand-in for Premiere's DOM.
//   node tests/premiere_host.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';

// the stand-in is a plain browser script; load it the same way here
const fakeCtx = vm.createContext({});
vm.runInContext(readFileSync(new URL('./premiere/fake-premiere.js', import.meta.url), 'utf8'), fakeCtx);
const makeFake = fakeCtx.makeFakePremiere;
const src = readFileSync(new URL('../premiere/host/host.jsx', import.meta.url), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`); };

try { acorn.parse(src, { ecmaVersion: 3 }); check('host.jsx is plain ES3', true); }
catch (e) { check('host.jsx is plain ES3', false, e.message); }
check('host.jsx is ASCII (ExtendScript reads files in the system encoding)', /^[\x00-\x7F]*$/.test(src));

function run(opts, code) {
  const fake = makeFake(opts);
  const ctx = vm.createContext({ app: fake.app, ProjectItemType: fake.ProjectItemType, Sequence: fake.Sequence });
  vm.runInContext(src, ctx);
  return { out: JSON.parse(vm.runInContext(code, ctx)), log: fake.log };
}

const scene = {
  width: 1080, height: 1920, fps: 25, projectPath: '/work/Reel.prproj',
  tracks: [
    [{ name: 'talk.mp4', path: '/media/talk.mp4', start: 2, end: 8, inPoint: 3, selected: true }],
    [{ name: 'logo.png', path: '/media/logo.png', start: 0, end: 4 }],
    [],
  ],
};

{
  const { out } = run(scene, 'Capstudio.selection()');
  check('selection: clip, timing and track', out.ok && out.clip.path === '/media/talk.mp4' && out.clip.start === 2 && out.clip.end === 8
    && out.clip.inPoint === 3 && out.clip.speed === 1 && out.clip.track === 0, JSON.stringify(out.clip));
  check('selection: sequence size and frame rate', out.sequence.width === 1080 && out.sequence.height === 1920 && Math.abs(out.sequence.fps - 25) < 1e-9);
  check('selection: project path', out.project === '/work/Reel.prproj');
}
{
  const { out } = run({ ...scene, tracks: [[{ name: 'a', path: '/a.mp4', start: 0, end: 1 }]] }, 'Capstudio.selection()');
  check('nothing selected: a clear message', !out.ok && /Select the clip/.test(out.error));
  const r2 = run({ ...scene, noSequence: true }, 'Capstudio.selection()');
  check('no sequence: a clear message', !r2.out.ok && /sequence/.test(r2.out.error));
  const r3 = run({ ...scene, tracks: [[{ name: 'Title', path: '', start: 0, end: 1, selected: true }]] }, 'Capstudio.selection()');
  check('a title has no media: a clear message', !r3.out.ok && /no media file/.test(r3.out.error));
}
{
  // V2 is busy over the clip's span, so the captions go on V3
  const { out, log } = run(scene, 'Capstudio.place("/work/Capstudio/talk captions.mov", "/work/Capstudio/talk captions.srt", 2, 8, 0)');
  check('place: on the first free track above the clip', out.ok && out.track === 3, JSON.stringify(out));
  check('place: imported into a Capstudio bin', log.some((l) => l[0] === 'createBin' && l[1] === 'Capstudio')
    && log.some((l) => l[0] === 'importFiles' && l[1].endsWith('.mov') && l[2] === 'Capstudio'));
  check('place: at the clip start', log.some((l) => l[0] === 'overwriteClip' && l[1] === 2 && l[3] === 2));
  check('place: editable caption track at the clip start', out.captions && log.some((l) => l[0] === 'createCaptionTrack' && l[1].endsWith('.srt') && l[2] === 2 && l[3] === 4));
}
{
  const full = { ...scene, tracks: [scene.tracks[0], [{ name: 'x', path: '/x', start: 0, end: 10 }]] };
  const { out } = run(full, 'Capstudio.place("/c.mov", "", 2, 8, 0)');
  check('no free track: a clear message', !out.ok && /no empty video track/.test(out.error));
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
