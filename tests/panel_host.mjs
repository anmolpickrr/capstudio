// The Premiere-side script (panel/host/host.jsx): it must be plain ES3 (Premiere's
// and After Effects' ExtendScript), and it's run here against stand-ins for their DOMs.
//   node tests/panel_host.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';

// the stand-in is a plain browser script; load it the same way here
const fakeCtx = vm.createContext({});
vm.runInContext(readFileSync(new URL('./panel/fake-premiere.js', import.meta.url), 'utf8'), fakeCtx);
vm.runInContext(readFileSync(new URL('./ae/fake-ae.js', import.meta.url), 'utf8'), fakeCtx);
const makeFake = fakeCtx.makeFakePremiere;
const makeFakeAE = fakeCtx.makeFakeAE;
const builder = readFileSync(new URL('../static/ae/capstudio-ae.jsx', import.meta.url), 'utf8');
const src = readFileSync(new URL('../panel/host/host.jsx', import.meta.url), 'utf8');
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

// After Effects: CapstudioAE in the same file
function runAE(scene, code, withBuilder) {
  const fake = makeFakeAE(['Poppins-Bold'], scene);
  const ctx = vm.createContext({ ...fake.globals });
  vm.runInContext(src, ctx);
  if (withBuilder) vm.runInContext(builder.replace('/*CAPSTUDIO_DATA*/null', 'false'), ctx);
  return { out: JSON.parse(vm.runInContext(code, ctx)), fake };
}
const comp = {
  name: 'Reel', width: 1080, height: 1920, fps: 25, projectPath: '/work/Reel.aep',
  layers: [
    { name: 'Logo', inPoint: 0, outPoint: 10 },
    { name: 'talk.mp4', path: '/media/talk.mp4', startTime: 1, inPoint: 2, outPoint: 7, stretch: 200, selected: true },
  ],
};
{
  const { out } = runAE(comp, 'CapstudioAE.selection()');
  check('AE selection: layer, timing and stretch', out.ok && out.layer.path === '/media/talk.mp4' && out.layer.index === 2
    && out.layer.startTime === 1 && out.layer.inPoint === 2 && out.layer.outPoint === 7 && out.layer.stretch === 200, JSON.stringify(out.layer));
  check('AE selection: composition and project', out.comp.width === 1080 && out.comp.height === 1920 && out.comp.fps === 25 && out.project === '/work/Reel.aep');
  const none = runAE({ ...comp, layers: [comp.layers[0], { ...comp.layers[1], selected: false }] }, 'CapstudioAE.selection()');
  check('AE nothing selected: a clear message', !none.out.ok && /Select the footage layer/.test(none.out.error));
  const remap = runAE({ ...comp, layers: [{ ...comp.layers[1], timeRemap: true }] }, 'CapstudioAE.selection()');
  check('AE time remapping: a clear message', !remap.out.ok && /time remapping/.test(remap.out.error));
  const fake = makeFakeAE([], null);
  const ctx = vm.createContext({ ...fake.globals });
  vm.runInContext(src, ctx);
  check('AE no composition: a clear message', /composition/.test(JSON.parse(vm.runInContext('CapstudioAE.selection()', ctx)).error));
}
{
  const D = {
    name: 'talk captions', width: 1080, height: 1920, fps: 25, duration: 12, fonts: [],
    layers: [{ type: 'text', role: 'main', text: 'Hi', font: 'Poppins-Bold', fontFile: 'Poppins-Bold.ttf', fontName: 'Poppins Bold', size: 72, tracking: 0, desc: 18,
      stroke: '#000000', style: [[0, '#FFFFFF', 0]], in: 1, out: 2, name: 'Hi',
      keys: { position: [[1, 540, 960]], scale: [[1, 100]], rotation: [[1, 0]], opacity: [[1, 100]], blur: [[1, 0]] } },
    { type: 'text', role: 'main', text: 'there', font: 'Anton-Regular', fontFile: 'Anton-Regular.ttf', fontName: 'Anton Regular', size: 72, tracking: 0, desc: 18,
      stroke: '#000000', style: [[0, '#FFFFFF', 0]], in: 2, out: 3, name: 'there',
      keys: { position: [[2, 540, 960]], scale: [[2, 100]], rotation: [[2, 0]], opacity: [[2, 100]], blur: [[2, 0]] } }],
  };
  const { out, fake } = runAE(comp, `CapstudioAE.build(${JSON.stringify(D)}, 2, "talk.mp4")`, true);
  const list = fake.active.list;
  const pre = list[1];
  check('AE build: a precomp of the caption layers', out.ok && out.layers === 2 && fake.comps.length === 1 && fake.comps[0].list.length === 2
    && fake.comps[0].width === 1080 && fake.comps[0].frameRate === 25, JSON.stringify(out));
  check('AE build: just above the captioned layer', pre && pre.kind === 'precomp' && list[2].name === 'talk.mp4' && list[0].name === 'Logo');
  check('AE build: in sync with the layer (start, stretch, in, out)', pre.startTime === 1 && pre.stretch === 200 && pre.inPoint === 2 && pre.outPoint === 7);
  check('AE build: missing fonts named', out.missing.length === 1 && out.missing[0] === 'Anton Regular', JSON.stringify(out.missing));
  check('AE build: one undo step, closed', fake.undoDepth() === 0);
  check('AE build: no alert in the panel', fake.alerts.length === 0, fake.alerts.join(' | '));
  const moved = runAE(comp, `CapstudioAE.build(${JSON.stringify(D)}, 1, "talk.mp4")`, true);
  check('AE build: finds the layer by name when its index changed', moved.out.ok && moved.fake.active.list[1].kind === 'precomp');
  const lib = runAE(comp, 'CapstudioAE.build({}, 9, "gone")');
  check('AE build: a clear message without the layer', !lib.out.ok && /isn't in the open composition/.test(lib.out.error));
}
{
  const { out, fake } = runAE(comp, 'CapstudioAE.placeFootage("/work/Capstudio/talk captions.mov", 2, "talk.mp4")');
  const l = fake.active.list[1];
  check('AE transparent video: imported and placed above the layer', out.ok && fake.imported[0] === '/work/Capstudio/talk captions.mov'
    && l.kind === 'footage' && l.name === 'talk captions.mov' && fake.active.list[2].name === 'talk.mp4');
  check('AE transparent video: over the layer\'s span in comp time', l.startTime === 2 && l.inPoint === 2 && l.outPoint === 7 && l.stretch === 100);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
