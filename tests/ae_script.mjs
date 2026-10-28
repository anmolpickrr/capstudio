// The After Effects script (static/ae/capstudio-ae.jsx): it must be plain ES3
// (ExtendScript), and it's run against a stand-in for After Effects' DOM.
//   node tests/ae_script.mjs [exported.jsx]
// Without an argument a small built-in set of layers is used; the browser test
// passes the script it exported from the app.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';

const fakeCtx = vm.createContext({});
vm.runInContext(readFileSync(new URL('./ae/fake-ae.js', import.meta.url), 'utf8'), fakeCtx);
const makeFakeAE = fakeCtx.makeFakeAE;

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`); };

const SAMPLE = {
  name: 'clip captions', width: 1080, height: 1920, fps: 30, duration: 4,
  watermark: { file: 'watermark.png', x: 0, y: 0, w: 1080, h: 1920, opacity: 0.6 },
  fonts: [{ file: 'Poppins-Bold.ttf', ps: 'Poppins-Bold', name: 'Poppins Bold' }],
  layers: [
    { type: 'box', role: 'active', color: '#6037D7', in: 0, out: 2, name: 'pill',
      keys: { position: [[0, 100, 900], [1, 200, 900]], scale: [[0, 100]], rotation: [[0, 0]], opacity: [[0, 0], [0.5, 100]], blur: [[0, 0]],
        size: [[0, 120, 80]], radius: [[0, 20]] } },
    { type: 'text', role: 'main', text: 'Hello', font: 'Poppins-Bold', fontFile: 'Poppins-Bold.ttf', fontName: 'Poppins Bold', size: 72, tracking: 0, desc: 18,
      stroke: '#000000', style: [[0, '#FFFFFF', 4], [1, '#FFE14D', 0]], in: 0, out: 2, name: 'Hello',
      keys: { position: [[0, 540, 960], [0.3, 540, 940]], scale: [[0, 80], [0.3, 100]], rotation: [[0, 0]], opacity: [[0, 100]], blur: [[0, 6], [0.3, 0]],
        mask: [[0, -50, -90, 0, 120], [1, -50, -90, 100, 120]] } },
    { type: 'emoji', char: '🔥', in: 0.5, out: 2, name: 'emoji',
      shapes: [{ color: '#F4900C', opacity: 100, paths: [{ v: [[0, 0], [36, 0], [18, 36]], i: [[0, 0], [0, 0], [6, 0]], o: [[0, 0], [0, 0], [-6, 0]], closed: true }] },
        { color: '#FFCC4D', opacity: 50, paths: [{ v: [[10, 10], [26, 10], [18, 30]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], closed: true }] }],
      keys: { position: [[0.5, 500, 700]], scale: [[0.5, 120], [0.7, 480]], rotation: [[0.5, 0]], opacity: [[0.5, 0], [0.6, 100]], blur: [[0.5, 0]] } },
  ],
};

const path = process.argv[2];
const src = readFileSync(path || new URL('../static/ae/capstudio-ae.jsx', import.meta.url), 'utf8');
const template = path ? null : src;
try { acorn.parse(src, { ecmaVersion: 3 }); check('the script is plain ES3', true); }
catch (e) { check('the script is plain ES3', false, e.message); }
if (template) check('the template is ASCII', /^[\x00-\x7F]*$/.test(template));

function run(code, installed) {
  const fake = makeFakeAE(installed);
  const ctx = vm.createContext({ ...fake.globals });
  // ExtendScript is ES3: take away what it doesn't have, so using it fails here too
  vm.runInContext(`(function (lists) { for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i][1].length; j++) delete lists[i][0][lists[i][1][j]]; }(
    [[Array.prototype, ['indexOf', 'forEach', 'map', 'filter', 'some', 'every', 'reduce', 'find', 'includes', 'at']],
     [String.prototype, ['trim', 'padStart', 'includes', 'startsWith', 'endsWith', 'repeat']], [Object, ['keys', 'assign', 'create']],
     [Array, ['isArray']], [Date, ['now']], [this, ['JSON', 'Promise', 'Map', 'Set']]]))`, ctx);
  vm.runInContext(code, ctx);
  return fake;
}

const code = template ? template.replace('/*CAPSTUDIO_DATA*/null', JSON.stringify(SAMPLE)) : src;
const data = template ? SAMPLE : JSON.parse(src.slice(src.lastIndexOf('}(') + 2, src.lastIndexOf('));')));

{
  const fake = run(code, data.fonts.map((f) => f.ps));
  const comp = fake.comps[0];
  check('a composition the size, rate and length of the video', comp && comp.width === data.width && comp.height === data.height
    && comp.frameRate === data.fps && comp.duration === data.duration && comp.opened);
  const expected = data.layers.length + (data.watermark ? 1 : 0);
  check('one layer per element (plus the watermark)', comp.list.length === expected, `${comp.list.length} of ${expected}`);
  // list[0] is the top layer: the last element drawn
  const texts = comp.list.filter((l) => l.kind === 'text');
  check('text layers keep their words', texts.length === data.layers.filter((l) => l.type === 'text').length
    && texts.every((l, i) => l.text === [...data.layers].reverse().filter((d) => d.type === 'text')[i].text));
  const animated = comp.list.filter((l) => l.property('ADBE Transform Group').property('ADBE Position').keys.length > 1);
  check('motion is keyframed', animated.length === data.layers.filter((l) => l.keys.position.length > 1).length, `${animated.length} layers move`);
  check('timing: each layer from its caption\'s start to end', comp.list.filter((l) => l.kind !== 'footage')
    .every((l, i) => { const d = [...data.layers].reverse()[i]; return l.inPoint === d.in && l.outPoint === d.out; }));
  check('fonts set when installed', texts.every((l) => l.property('ADBE Text Properties').property('ADBE Text Document').value.font !== 'ArialMT'));
  check('the undo group is closed', fake.undoDepth() === 0);
  if (data.watermark) check('the watermark is imported from the script\'s folder', fake.imported[0] === `/work/export/${data.watermark.file}` && comp.list[comp.list.length - 1].kind === 'footage');
  if (data.layers.some((l) => l.type === 'emoji')) {
    // shape layers: one group per coloured shape, the front-most first
    const shaped = comp.list.filter((l) => l.kind === 'shape' && l.property('ADBE Root Vectors Group').added.length
      && l.property('ADBE Root Vectors Group').added[0].property('ADBE Vectors Group').added.some((p) => p.name === 'ADBE Vector Shape - Group'));
    const want = data.layers.filter((l) => l.type === 'emoji');
    const ok = shaped.length === want.length && shaped.every((l, i) => {
      const d = [...want].reverse()[i], groups = l.property('ADBE Root Vectors Group').added;
      const front = groups[0].property('ADBE Vectors Group').added;
      const shape = front[0].property('ADBE Vector Shape')._value;
      return groups.length === d.shapes.length && shape.vertices.length === d.shapes[d.shapes.length - 1].paths[0].v.length && shape.closed
        && front[front.length - 1].property('ADBE Vector Fill Color')._value.length === 3;
    });
    check('emojis are shape layers with their coloured shapes', ok, `${shaped.length} of ${want.length}`);
  }
  if (data.layers.some((l) => l.keys.mask)) {
    check('karaoke sweeps get an animated mask', comp.list.some((l) => l.property('ADBE Mask Parade').added.length
      && l.property('ADBE Mask Parade').added[0].property('ADBE Mask Shape').keys.length > 1));
  }
  if (data.layers.some((l) => l.style && l.style.length > 1)) {
    check('colour changes are Source Text keyframes', texts.some((l) => l.property('ADBE Text Properties').property('ADBE Text Document').keys.length > 0));
  }
  check('a summary for the editor', /layers in/.test(fake.alerts[0] || '') && !/aren't installed/.test(fake.alerts[0]));
}
{
  const fake = run(code, []);
  check('missing fonts are named in the summary', /aren't installed/.test(fake.alerts[0]) && data.fonts.every((f) => fake.alerts[0].includes(f.name)));
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
