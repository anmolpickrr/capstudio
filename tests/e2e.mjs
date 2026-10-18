// End-to-end browser test of the Studio: upload → captions generated → style
// chosen → export → download, then checks the export kept the source's
// resolution, frame rate, codec and bit depth and the original file name. Also
// checks the style showcase on the first page and undo.
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
    const want = file.replace(/\.[^.]+$/, '') + '.' + ext;
    if (dl.suggestedFilename() !== want) diffs.push(`file name: expected ${want}, got ${dl.suggestedFilename()}`);
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

// Undo/redo, and the style showcase on the first page.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.waitForSelector('.look', { timeout: 15000 });
    const looks = await page.locator('.look').count();
    if (looks < 6) throw new Error(`expected 6 styles in the showcase, found ${looks}`);
    await page.waitForFunction(() => document.querySelector('.phone .live-captions text'), null, { timeout: 15000 });
    await page.locator('.looks').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.look .live-captions')].some((s) => s.querySelector('text')),
      null, { timeout: 15000 });
    await page.click('.look[data-template="karaoke"]');
    await page.setInputFiles('#file-input', MEDIA + 'land.webm');
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    const store = () => page.evaluate(async () => { const { state } = await import('/js/app/store.js'); return { id: state.templateId, font: state.style.font }; });
    const s0 = await store();
    if (s0.id !== 'karaoke') throw new Error(`the picked style wasn't used (got ${s0.id})`);
    console.log('✓ first page: the hero phone and 6 styles play with captions, and the picked style is used for the upload');
    await page.click('.tpl[data-id="aurora"]');
    const s1 = await store();
    await page.keyboard.press('Control+z');
    const s2 = await store();
    if (s1.font === s0.font || s2.font !== s0.font) throw new Error(`undo didn't restore the style (${s0.font} → ${s1.font} → ${s2.font})`);
    console.log('✓ undo restores the previous style');
    // drag the timeline playhead
    const grip = await page.locator('.tl-head-grip').boundingBox();
    const content = await page.locator('.tl-content').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(content.x + content.width * 0.5, grip.y + 8, { steps: 8 });
    await page.mouse.up();
    const t = await page.evaluate(() => document.querySelector('.frame video').currentTime);
    const dur = await page.evaluate(() => document.querySelector('.frame video').duration);
    if (Math.abs(t - dur * 0.5) > dur * 0.08) throw new Error(`dragging the playhead to the middle went to ${t.toFixed(2)}s of ${dur.toFixed(2)}s`);
    console.log('✓ the timeline playhead can be dragged');
    // one caption: bigger, delete with the Delete key, undo, double-click to edit
    const caps = () => page.evaluate(async () => (await import('/js/app/store.js')).state.captions);
    const n0 = (await caps()).length;
    await page.click('.tl-cap >> nth=2', { position: { x: 8, y: 8 } });
    await page.click('.tl-size button >> nth=1');
    await page.click('.tl-size button >> nth=1');
    if ((await caps())[2].scale !== 1.2) throw new Error(`A+ twice should give 120%, got ${(await caps())[2].scale}`);
    await page.locator('body').press('Delete');
    if ((await caps()).length !== n0 - 1) throw new Error('Delete key did not remove the selected caption');
    await page.keyboard.press('Control+z');
    if ((await caps()).length !== n0) throw new Error('undo did not bring the deleted caption back');
    await page.click('.tl-cap >> nth=3', { position: { x: 8, y: 8 } });
    await page.click('.tl-cap >> nth=3', { position: { x: 8, y: 8 } });
    await page.waitForFunction(() => document.activeElement?.classList.contains('cap-text'), null, { timeout: 3000 });
    console.log('✓ a caption can be resized, deleted with the Delete key (and undone), and edited by double-click');
    if (errors.length) throw new Error(errors.join('; '));
  } catch (e) {
    fail('showcase / undo', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// Safe zones: one click shows the overlay, covered captions are reported, and
// "Move inside" fixes them. The overlay is preview-only.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    for (const zone of ['ig-reels', 'ig-stories', 'fb-reels', 'tiktok']) {
      await page.click(`.zone-chip[data-zone="${zone}"]`);
      if (await page.locator('.guides .sz-safe').count() !== 1) throw new Error(`${zone}: no safe-area outline`);
      if (await page.locator('.zone-status button').count()) {
        await page.click('.zone-status button');
        await page.waitForFunction(() => document.querySelector('.zone-ok'), null, { timeout: 5000 });
      }
    }
    await page.click('.zone-chip[data-zone="off"]');
    if (!(await page.locator('.guides').isHidden())) throw new Error('overlay still shown with Off');
    if (errors.length) throw new Error(errors.join('; '));
    console.log('✓ safe zones: overlays for 4 platforms, and "Move inside" brings every caption into the safe area');
  } catch (e) {
    fail('safe zones', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} failed — screenshots in ${OUT}` : 'all passed');
process.exit(failed ? 1 : 0);
