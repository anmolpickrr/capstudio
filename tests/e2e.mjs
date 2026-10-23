// End-to-end browser test of the Studio: upload → captions generated → style
// chosen → export → download, then checks the export kept the source's
// resolution, frame rate, codec and bit depth and the original file name. Also
// checks the style showcase on the first page and undo.
// Needs tests/stub_server.py running (see tests/README.md).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  ['vert.webm', 'two-tier', 'mp4'],
  ['vert.webm', 'serif-stack', 'mp4'],
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

// Export in the browser (WebCodecs): the frames are drawn and encoded on the
// user's computer instead of the server. Playwright's Chromium has no H.264
// encoder, so the test asks for VP9; the pipeline is the same.
for (const [file, tpl] of [['vert_vp9.mp4', 'two-tier'], ['rotated_vp9.mp4', 'hormozi']]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const watermark = file === 'vert_vp9.mp4';
  await page.addInitScript((wm) => {
    window.__exportCodecs = ['vp9'];
    if (wm) localStorage.setItem('capstudio-watermark', JSON.stringify({ on: true, tone: 'light', format: 'auto', size: 100, opacity: 100 }));
  }, watermark);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Browser export unavailable/.test(m.text())) errors.push(m.text().split('\n')[0]); });
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + file);
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    await page.click(`.tpl[data-id="${tpl}"]`);
    const wmSrc = await page.evaluate(() => { const i = document.querySelector('.frame .watermark'); return i && !i.hidden ? i.getAttribute('src') : null; });
    if (watermark && wmSrc !== '/watermarks/fastrr-light-9x16.png') throw new Error(`preview watermark: ${wmSrc}`);
    if (!watermark && wmSrc) throw new Error('watermark shown while off');
    await page.click('#export-btn');
    const t0 = Date.now();
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 300000 });
    const secs = (Date.now() - t0) / 1000;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-status a.btn')]);
    const out = join(OUT, `browser-${dl.suggestedFilename()}`);
    await dl.saveAs(out);
    const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
      'stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'json', out])).streams;
    const v = streams.find((x) => x.codec_type === 'video'), a = streams.find((x) => x.codec_type === 'audio');
    const srcV = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height,nb_read_frames', '-of', 'json', MEDIA + file])).streams[0];
    const [w, hgt] = file.startsWith('rotated') ? [srcV.height, srcV.width] : [srcV.width, srcV.height];
    const diffs = [];
    if (v.width !== w || v.height !== hgt) diffs.push(`size ${v.width}x${v.height}, expected ${w}x${hgt}`);
    if (v.nb_read_frames !== srcV.nb_read_frames) diffs.push(`${v.nb_read_frames} frames, expected ${srcV.nb_read_frames}`);
    if (a?.codec_name !== 'aac') diffs.push(`audio ${a?.codec_name}, expected aac`);
    if (dl.suggestedFilename() !== file) diffs.push(`file name ${dl.suggestedFilename()}`);
    // captions are in the picture: the frame differs from the source's
    const log = execFileSync('sh', ['-c', `ffmpeg -ss 3 -i "${MEDIA + file}" -ss 3 -i "${out}" -lavfi "[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr" -frames:v 1 -f null - 2>&1`]).toString();
    const psnr = Number((log.match(/average:([\d.]+)/) || [])[1]);
    if (!(psnr < 35)) diffs.push(`no captions in the picture (PSNR ${psnr})`);
    // the watermark: frame 90 of each (the test pattern moves, so match frames by number),
    // brightness change inside the light overlay's shape vs outside it, above the captions
    const frame = (src, png) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', "select='eq(n\\,90)'", '-frames:v', '1', png]);
    frame(MEDIA + file, join(OUT, 'wm-src.png'));
    frame(out, join(OUT, 'wm-out.png'));
    const [inside, outside] = execFileSync('python3', [new URL('./wm_check.py', import.meta.url).pathname, join(OUT, 'wm-src.png'),
      join(OUT, 'wm-out.png'), new URL('../static/watermarks/fastrr-light-9x16.png', import.meta.url).pathname]).toString().trim().split(' ').map(Number);
    if (watermark && !(inside > 6 && Math.abs(outside) < 3)) diffs.push(`watermark not in the picture (inside ${inside}, outside ${outside})`);
    if (!watermark && !(Math.abs(inside) < 3)) diffs.push(`unexpected watermark (inside ${inside})`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ in-browser export ${file} + ${tpl}${watermark ? ' + watermark' : ''} → ${v.width}x${v.height}, ${v.nb_read_frames} frames, ${a.codec_name} audio, ${secs.toFixed(1)}s`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, `failure-browser-${tpl}.png`) }).catch(() => {});
    fail(`in-browser export ${file} + ${tpl}`, e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// "Captions only, transparent": a QuickTime Animation .mov with alpha, for Premiere Pro
// and After Effects, the same size, frame rate and length as the video.
{
  const file = 'vert.webm', tpl = 'two-tier';
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + file);
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    await page.click(`.tpl[data-id="${tpl}"]`);
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="overlay"]');
    const t0 = Date.now();
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 300000 });
    const secs = (Date.now() - t0) / 1000;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-status a.btn')]);
    const out = join(OUT, 'overlay.mov');
    await dl.saveAs(out);
    const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', out])).streams[0];
    const src = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height,r_frame_rate,nb_read_frames', '-of', 'json', MEDIA + file])).streams[0];
    const diffs = [];
    if (v.codec_name !== 'qtrle' || v.pix_fmt !== 'argb') diffs.push(`format ${v.codec_name} ${v.pix_fmt}, expected qtrle argb`);
    for (const k of ['width', 'height', 'r_frame_rate', 'nb_read_frames']) if (v[k] !== src[k]) diffs.push(`${k} ${v[k]}, expected ${src[k]}`);
    if (dl.suggestedFilename() !== 'vert captions.mov') diffs.push(`file name ${dl.suggestedFilename()}`);
    // a frame with a caption: mostly see-through, with solid caption pixels
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out, '-vf', "select='eq(n\\,90)'", '-frames:v', '1', join(OUT, 'overlay-90.png')]);
    const [clear, solid] = execFileSync('python3', ['-c', `from PIL import Image
a = Image.open('${join(OUT, 'overlay-90.png')}').convert('RGBA').getchannel('A').histogram()
n = sum(a)
print(a[0] / n, sum(a[250:]) / n)`]).toString().trim().split(/\s+/).map(Number);
    if (!(clear > 0.8 && solid > 0.002)) diffs.push(`alpha: ${(clear * 100).toFixed(1)}% clear, ${(solid * 100).toFixed(2)}% solid`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ captions-only export: ${v.width}x${v.height} ${v.codec_name} ${v.pix_fmt}, ${v.nb_read_frames} frames, ${(clear * 100).toFixed(0)}% clear, ${secs.toFixed(1)}s`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-overlay.png') }).catch(() => {});
    fail('captions-only export', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The Fastrr brand kit, checking doubtful words, changing the script, and
// autosave: reload the page and continue where you left off.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [], missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // a saved project's server copy may have expired: that 404 is expected
  page.on('response', (r) => { if (r.status() === 404 && !/\/api\/jobs\//.test(r.url())) missing.push(r.url()); });
  const store = () => page.evaluate(async () => (await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'))).state);
  const text = async () => (await store()).captions.map((c) => c.words.map((w) => w.text).join(' ')).join(' | ');
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 120000 });
    await page.click('.rail button[data-tool="templates"]');
    const firstStyle = await page.locator('.tpl').first().getAttribute('data-id');
    if (firstStyle !== 'fastrr-bold') throw new Error(`brand kit not first (${firstStyle})`);
    await page.click('.tpl[data-id="fastrr-marker"]');

    // two unsure words (the stand-in transcriber flags them): one checked, the rest "All good"
    await page.click('.rail button[data-tool="captions"]');
    if (!/2 words to check/.test(await page.locator('.review').innerText())) throw new Error('review bar missing');
    await page.click('.review .btn.primary');
    if (!/1 word to check/.test(await page.locator('.review').innerText())) throw new Error('"Looks right" did not clear the word');
    // glossary near misses, one word and two
    const box = page.locator('.cap textarea').first();
    await box.fill('Hey faster everyone, ship rocket');
    await box.press('Enter');
    if (!/Fastrr/.test(await page.locator('.review-q').innerText())) throw new Error('no Fastrr suggestion');
    await page.click('.review .btn.primary');
    if (!/Shiprocket/.test(await page.locator('.review-q').innerText())) throw new Error('no Shiprocket suggestion');
    await page.click('.review .btn.primary');
    await page.click('.review button:has-text("All good")');
    if (await page.locator('.review').count()) throw new Error('review bar still shown');
    if (!(await text()).startsWith('Hey Fastrr everyone, Shiprocket')) throw new Error(`suggestions not applied: ${(await text()).slice(0, 60)}`);

    // script: Roman, then Devanagari and English (stand-in text model), then undo
    await page.click('[aria-label="Caption script"] button[data-mode="roman"]');
    await page.waitForTimeout(600);
    if (!/bahut aasaan/.test(await text())) throw new Error(`roman: ${await text()}`);
    await page.click('[aria-label="Caption script"] button[data-mode="devanagari"]');
    await page.waitForTimeout(600);
    if (!/बहुत/.test(await text())) throw new Error('devanagari not applied');
    await page.click('[aria-label="Caption script"] button[data-mode="english"]');
    await page.waitForTimeout(600);
    if (!(await text()).startsWith('EN ')) throw new Error('english not applied');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    if ((await text()).includes('EN ')) throw new Error('undo did not restore');

    // autosave: reload, continue, same captions and style; a server export still works
    await page.waitForTimeout(1500);
    const before = await text();
    await page.reload();
    await page.waitForSelector('.recent-item', { timeout: 10000 });
    await page.click('.recent-open');
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 30000 });
    const s = await store();
    if ((await text()) !== before) throw new Error('captions not restored');
    if (s.templateId !== 'fastrr-marker') throw new Error(`style not restored (${s.templateId})`);
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="soft"]');
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 120000 });
    if (missing.length) throw new Error(`missing files: ${[...new Set(missing)].slice(0, 3).join(', ')}`);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log('✓ brand kit first, words to check and glossary suggestions, script switch with undo, autosave and resume (server export re-sends the video)');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-autosave.png') }).catch(() => {});
    fail('brand kit / review / script / autosave', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The Premiere Pro panel, end to end: the real panel bridge and host script with
// Premiere replaced by a stand-in (tests/premiere/). A clip used from 0:03 of its
// file sits at 0:02–0:08 on V1 of a 1080×1920, 25 fps sequence; V2 is busy there.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__premiere/`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the selected clip")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 120000 });
    const frame = page.frames().find((f) => f.url().includes('host=premiere'));
    const st = await frame.evaluate(async () => {
      const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      return { w: state.project.info.width, h: state.project.info.height, caps: state.captions.map((c) => [c.start, c.end]) };
    });
    const diffs = [];
    if (st.w !== 1080 || st.h !== 1920) diffs.push(`laid out at ${st.w}x${st.h}, expected the sequence's 1080x1920`);
    if (!st.caps.length || st.caps.some(([a, b]) => b <= 3 || a >= 9)) diffs.push('captions outside the used part (0:03–0:09) of the file');
    await app.locator('#export-btn').click();
    await app.locator('#export-dialog .btn.brand').click();
    await app.locator('#export-status .result.ok').waitFor({ timeout: 120000 });
    const out = await page.evaluate(() => ({ log: window.__fake.log,
      files: Object.fromEntries(Object.entries(window.__written).map(([k, v]) => [k, Array.from(new Uint8Array(v))])) }));
    const movPath = Object.keys(out.files).find((k) => k.endsWith('.mov'));
    if (movPath !== '/work/Capstudio/vert captions.mov') diffs.push(`saved as ${movPath}`);
    const mov = join(OUT, 'panel.mov');
    writeFileSync(mov, Buffer.from(out.files[movPath] || []));
    const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
      'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', mov])).streams[0];
    if (v.codec_name !== 'qtrle' || v.width !== 1080 || v.height !== 1920 || v.r_frame_rate !== '25/1' || Number(v.nb_read_frames) !== 150) {
      diffs.push(`captions video ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} ${v.nb_read_frames} frames, expected qtrle 1080x1920 25/1 150`);
    }
    const srt = Buffer.from(out.files['/work/Capstudio/vert captions.srt'] || []).toString();
    if (!srt.startsWith('1\n00:00:00,000')) diffs.push('caption track not timed from the clip start');
    const placed = out.log.find((l) => l[0] === 'overwriteClip');
    if (!placed || placed[1] !== 2 || placed[3] !== 2) diffs.push(`placed ${JSON.stringify(placed)}, expected V3 at 0:02`);
    if (!out.log.some((l) => l[0] === 'createCaptionTrack' && l[2] === 2)) diffs.push('no editable caption track');
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ Premiere panel: selected clip captioned for its used part, transparent captions at the sequence size and rate on V3, editable caption track');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-premiere.png') }).catch(() => {});
    fail('Premiere panel', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// After Effects, editable layers: the zip from the Export dialog, and its script run
// against a stand-in for After Effects (tests/ae_script.mjs).
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => localStorage.setItem('capstudio-watermark', JSON.stringify({ on: true, tone: 'light', format: 'auto', size: 100, opacity: 80 })));
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 120000 });
    await page.click('.tpl[data-id="karaoke"]');
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="ae"]');
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 60000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-status a.btn')]);
    const zipPath = join(OUT, 'ae.zip'), dir = join(OUT, 'ae');
    await dl.saveAs(zipPath);
    execFileSync('python3', ['-c', `import zipfile; zipfile.ZipFile('${zipPath}').extractall('${dir}')`]);
    const files = execFileSync('sh', ['-c', `cd "${dir}" && find . -type f | sort`]).toString().trim().split('\n');
    const want = ['./README.txt', './fonts/Poppins-Black.ttf', './vert captions.jsx', './watermark.png'];
    if (want.some((f) => !files.includes(f))) throw new Error(`zip has ${files.join(', ')}`);
    if (dl.suggestedFilename() !== 'vert After Effects captions.zip') throw new Error(`file name ${dl.suggestedFilename()}`);
    const run = execFileSync('node', [new URL('./ae_script.mjs', import.meta.url).pathname, join(dir, 'vert captions.jsx')]).toString();
    if (!/all passed/.test(run)) throw new Error(run.split('\n').filter((l) => l.startsWith('✗')).join('; '));

    // the layer data, drawn the way After Effects composites it, against the preview
    await page.goto(`${BASE}/__parity/`);
    await page.waitForFunction(() => window.ready === true);
    const res = await page.evaluate(async (tpls) => {
  const { CaptionEngine } = await import('/js/engine/index.js');
  const { CanvasRenderer } = await import('/js/engine/canvas.js');
  const { toAE } = await import('/js/engine/ae.js');
  const { cssFamily, fontById } = await import('/js/engine/fonts.js');
  const { roundedRect } = await import('/js/engine/svg.js');
  const { templateById } = await import('/js/templates/library.js');
  const W = 1080, H = 1920, out = {};
  const words = 'Make every single video count for your brand today'.split(' ').map((t, i) => ({ text: t, start: 0.2 + i * 0.32, end: 0.2 + i * 0.32 + 0.3 }));
  const captions = [{ id: 'a', start: 0.2, end: 1.6, words: words.slice(0, 4) }, { id: 'b', start: 1.6, end: 3.2, words: words.slice(4) }];
  const val = (keys, t) => {
    if (!keys) return null;
    if (keys.length === 1 || t <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
      const a = keys[i - 1], c = keys[i], k = (t - a[0]) / (c[0] - a[0]);
      return a.slice(1).map((v, j) => v + (c[j + 1] - v) * k);
    }
    return keys[keys.length - 1].slice(1);
  };
  const hold = (keys, t) => { let s = keys[0]; for (const k of keys) if (k[0] <= t + 1e-6) s = k; return s; };
  for (const id of tpls) {
    const style = templateById(id).style;
    const engine = new CaptionEngine(); await engine.set({ captions, style, W, H }); await engine.set({ captions, style, W, H });
    const data = toAE(captions, style, W, H, { fps: 30, duration: 3.4 });
    const scores = [];
    for (const t of [11 / 30, 27 / 30, 52 / 30, 78 / 30]) {
      const a = new OffscreenCanvas(W, H), ca = a.getContext('2d'); ca.fillStyle = '#3a4a5a'; ca.fillRect(0, 0, W, H);
      new CanvasRenderer(W, H).render(ca, engine.scenesAt(t), t);
      const bcv = new OffscreenCanvas(W, H), cb = bcv.getContext('2d'); cb.fillStyle = '#3a4a5a'; cb.fillRect(0, 0, W, H);
      for (const L of data.layers) {
        if (t < L.in || t >= L.out) continue;
        const [x, y] = val(L.keys.position, t), [s] = val(L.keys.scale, t), [rot] = val(L.keys.rotation, t), [op] = val(L.keys.opacity, t);
        const [blur] = val(L.keys.blur, t);
        cb.save(); cb.globalAlpha = op / 100; cb.translate(x, y); cb.rotate(rot * Math.PI / 180); cb.scale(s / 100, s / 100);
        if (blur > 0.05) cb.filter = `blur(${(blur / 2.4 * s / 100).toFixed(2)}px)`;
        if (L.type === 'box') {
          const [w, h] = val(L.keys.size, t), [r] = val(L.keys.radius, t);
          cb.fillStyle = L.color; cb.fill(new Path2D(roundedRect(w, h, r)));
        } else {
          cb.translate(0, -L.desc);
          if (L.keys.mask) { const [mx, my, mw, mh] = val(L.keys.mask, t); cb.beginPath(); cb.rect(mx, my, mw, mh); cb.clip(); }
          const st = hold(L.style, t);
          cb.font = `${L.size}px "cp-${L.fontFile.replace(/\.[ot]tf$/, '')}"`;
          cb.letterSpacing = `${(L.tracking / 1000) * L.size}px`;
          cb.textAlign = 'center'; cb.lineJoin = 'round';
          if (st[2] > 0) { cb.strokeStyle = L.stroke; cb.lineWidth = st[2]; cb.strokeText(L.text, 0, 0); }
          if (st[1]) { cb.fillStyle = st[1]; cb.fillText(L.text, 0, 0); }
        }
        cb.restore();
      }
      const da = ca.getImageData(0, 0, W, H).data, db = cb.getImageData(0, 0, W, H).data;
      let se = 0; for (let i = 0; i < da.length; i += 4) for (let c = 0; c < 3; c++) { const d = da[i + c] - db[i + c]; se += d * d; }
      const mse = se / (W * H * 3);
      scores.push(+(mse ? 10 * Math.log10(255 * 255 / mse) : 99).toFixed(1));
    }
    out[id] = { scores, layers: data.layers.length };
  }
  return out;
}, ['hormozi', 'karaoke', 'fastrr-pill', 'fastrr-marker', 'two-tier', 'popstar', 'serif-stack', 'big-word']);
    const low = Object.entries(res).filter(([, v]) => Math.min(...v.scores) < 28).map(([k, v]) => `${k} ${Math.min(...v.scores)} dB`);
    if (low.length) throw new Error(`layers drift from the preview: ${low.join(', ')}`);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log(`✓ After Effects: zip with script, font and watermark; the script builds every layer; layers match the preview (lowest ${Math.min(...Object.values(res).flatMap((v) => v.scores))} dB)`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-ae.png') }).catch(() => {});
    fail('After Effects export', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// Every format at once: a landscape video as 9:16 (fitted over a blurred copy),
// 1:1 (cropped) and 16:9, with captions placed low enough to cross the Instagram
// Reels safe zone so they're moved inside for 9:16 only.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.addInitScript(() => { window.__exportCodecs = ['vp9']; localStorage.removeItem('capstudio-formats'); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'land_vp9.mp4');
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 120000 });
    await page.click('.tpl[data-id="fastrr-pill"]');
    // captions right at the bottom: fine for 16:9, inside Instagram's caption area for 9:16
    await page.evaluate(async () => {
      const { setStyle } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      setStyle({ vPos: 'bottom', vOffset: 12 });
    });
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="formats"]');
    const rows = page.locator('.fmt-row');
    await page.waitForFunction(() => document.querySelectorAll('.fmt-status').length === 4 && [...document.querySelectorAll('.fmt-status')].every((s) => s.textContent));
    const status = await page.locator('.fmt-status').allInnerTexts();
    const diffs = [];
    if (!/Moved inside the Instagram Reels safe zone/.test(status[0])) diffs.push(`9:16: ${status[0]}`);
    if (!/Inside the title-safe area/.test(status[3])) diffs.push(`16:9: ${status[3]}`);
    // "Keep my layout" undoes the move for that format only
    await rows.nth(0).locator('button.linkish').click();
    if (!/cross the Instagram Reels safe zone/.test(await rows.nth(0).locator('.fmt-status').innerText())) diffs.push('"Keep my layout" did not apply');
    await rows.nth(0).locator('button.linkish').click();
    await page.click('#export-dialog .btn.brand.lg');
    await page.waitForSelector('.fmt-results a', { timeout: 600000 });
    const links = page.locator('.fmt-results a');
    const got = {};
    for (let i = 0; i < await links.count(); i++) {
      const [dl] = await Promise.all([page.waitForEvent('download'), links.nth(i).click()]);
      const out = join(OUT, `fmt-${i}.mp4`);
      await dl.saveAs(out);
      const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', out])).streams[0];
      got[dl.suggestedFilename()] = `${v.width}x${v.height}`;
    }
    const want = { 'land_vp9 9x16.mp4': '1080x1920', 'land_vp9 1x1.mp4': '1080x1080', 'land_vp9 16x9.mp4': '1920x1080' };
    if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`made ${JSON.stringify(got)}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ every format: 9:16, 1:1 and 16:9 from one edit; 9:16 captions moved inside the Instagram Reels safe zone, "Keep my layout" works');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-formats.png') }).catch(() => {});
    fail('every format', e.message.split('\n')[0]);
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
    const store = () => page.evaluate(async () => { const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js')); return { id: state.templateId, font: state.style.font }; });
    const s0 = await store();
    if (s0.id !== 'karaoke') throw new Error(`the picked style wasn't used (got ${s0.id})`);
    console.log('✓ first page: the hero phone and the style specimens play with captions, and the picked style is used for the upload');
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
    const caps = () => page.evaluate(async () => (await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'))).state.captions);
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
    for (const zone of ['ig-reels', 'ig-stories', 'fb-reels', 'fb-stories', 'yt-shorts', 'whatsapp', 'tiktok']) {
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
    console.log('✓ safe zones: overlays for 7 platforms, and "Move inside" brings every caption into the safe area');
  } catch (e) {
    fail('safe zones', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} failed — screenshots in ${OUT}` : 'all passed');
process.exit(failed ? 1 : 0);
