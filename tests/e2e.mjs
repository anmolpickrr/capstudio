// End-to-end browser test of the Studio: upload → captions generated → style
// chosen → export → download, then checks the export kept the source's
// resolution, frame rate, codec and bit depth. Also checks the Demo section.
// Needs tests/stub_server.py running (see tests/README.md).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const MEDIA = new URL('./media/', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'caption-e2e-'));
const CASES = [
  // [file, template, expected output container]
  ['land.webm', 'hormozi', 'mp4'],
  ['land.webm', 'typewriter', 'mp4'],
  ['vert_hevc10.mp4', 'punch', 'mp4'],
  ['prores.mov', 'magazine', 'mov'],
  ['rotated.mp4', 'aurora', 'mp4'],
];

const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=codec_name,profile,width,height,r_frame_rate,pix_fmt', '-of', 'json', file])).streams[0];

const browser = await chromium.launch();
let failed = 0;
const fail = (name, msg) => { failed++; console.log(`✗ ${name}: ${msg}`); };

for (const [file, tpl, ext] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + file);
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    await page.click(`.tpl[data-id="${tpl}"]`);
    await page.click('#export-btn');
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 300000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-status a.btn')]);
    const out = join(OUT, `${tpl}-${dl.suggestedFilename()}`);
    await dl.saveAs(out);

    let src = probe(MEDIA + file);
    if (file === 'rotated.mp4') src = { ...src, width: src.height, height: src.width };
    const got = probe(out);
    const expect = { width: src.width, height: src.height, r_frame_rate: src.r_frame_rate, pix_fmt: src.pix_fmt };
    if (src.codec_name !== 'vp9') Object.assign(expect, { codec_name: src.codec_name, profile: src.profile });
    const diffs = Object.entries(expect).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: expected ${v}, got ${got[k]}`);
    if (!out.endsWith(`.${ext}`)) diffs.push(`extension: expected .${ext}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ ${file} + ${tpl} → ${got.width}x${got.height} ${got.codec_name} ${got.pix_fmt} ${got.r_frame_rate}`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, `failure-${tpl}.png`) }).catch(() => {});
    fail(`${file} + ${tpl}`, e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// Undo/redo, and the Demo section with an example opened in the Studio.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'land.webm');
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    const font = () => page.evaluate(async () => (await import('/js/app/store.js')).state.style.font);
    const f0 = await font();
    await page.click('.tpl[data-id="aurora"]');
    const f1 = await font();
    await page.keyboard.press('Control+z');
    const f2 = await font();
    if (f1 === f0 || f2 !== f0) throw new Error(`undo didn't restore the style (${f0} → ${f1} → ${f2})`);
    console.log('✓ undo restores the previous style');

    await page.goto(`${BASE}/#/demo`);
    await page.waitForSelector('.demo-card', { timeout: 15000 });
    const cards = await page.locator('.demo-card').count();
    if (cards < 3) throw new Error(`expected 3 examples, found ${cards}`);
    await page.click('.demo-side .btn.primary');
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 30000 });
    if (await page.locator('#demo-tag').isHidden()) throw new Error('example project is not labelled');
    if (errors.length) throw new Error(errors.join('; '));
    console.log('✓ demo: examples listed, example opens in the Studio labelled as an example');
  } catch (e) {
    fail('undo / demo', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} failed — screenshots in ${OUT}` : 'all passed');
process.exit(failed ? 1 : 0);
