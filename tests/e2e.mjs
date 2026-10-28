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
    // renamed after resuming: the server's file downloads under the new name
    await page.fill('#file-name', 'Renamed reel'); await page.press('#file-name', 'Enter');
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="soft"]');
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 120000 });
    const dlName = await page.getAttribute('#export-status a.btn', 'download');
    if (!/^Renamed reel\.\w+$/.test(dlName || '')) throw new Error(`server export named ${dlName}`);
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

// Emojis and keywords: added for every caption by the (stand-in) AI in one undo
// step, then one caption's emoji changed with the picker, drawn in the preview and
// in the export script, and all removed.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const store = () => page.evaluate(async () => {
    const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
    return { emoji: state.style.emoji, emphasis: state.style.emphasis,
      caps: state.captions.map((c) => ({ id: c.id, start: c.start, emoji: c.words.find((w) => w.emoji)?.emoji || null, emoji_at: c.words.findIndex((w) => w.emoji),
        stars: c.words.filter((w) => w.emph).length, words: c.words.map((w) => w.text) })) };
  });
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 120000 });
    await page.click('.tpl[data-id="hormozi"]');
    await page.click('.rail button[data-tool="captions"]');
    const before = await store();
    await page.click('button:has-text("Add emojis & keywords")');
    await page.waitForSelector('.toast.ok:has-text("Added")', { timeout: 20000 });
    const after = await store();
    const diffs = [];
    const withEmoji = after.caps.filter((c) => c.emoji);
    // the stand-in picks 👋 for "welcome" and 🎬 for "video"
    const welcome = after.caps.find((c) => c.words.some((w) => /^welcome/i.test(w)));
    if (welcome?.emoji !== '👋' || !/^welcome/i.test(welcome.words[welcome.emoji_at])) diffs.push(`welcome caption: ${JSON.stringify(welcome)}`);
    if (!after.caps.some((c) => c.emoji === '🎬')) diffs.push('no 🎬 for "video"');
    if (after.caps.some((c) => c.stars !== 1)) diffs.push('not one keyword per caption');
    if (after.emoji !== 'above' || after.emphasis !== 'marked') diffs.push(`style emoji ${after.emoji}, emphasis ${after.emphasis}`);
    // drawn in the preview: the emoji's shapes are in the stage while its word is spoken
    const c0 = welcome;
    await page.evaluate((t) => { document.querySelector('.frame video').currentTime = t; }, c0.start + 0.6);
    await page.waitForTimeout(600);
    const drawn = await page.evaluate(() => [...document.querySelectorAll('.frame svg path[fill="#EF9645"], .frame svg path[fill="#FFDC5D"]')]
      .filter((p) => p.closest('g[display="none"]') === null).length);
    if (!drawn) diffs.push('emoji not drawn in the preview');
    // and in the export script, as drawings
    const assDrawings = await page.evaluate(async () => {
      const base = document.querySelector('script[type=module]').src.replace('app/main.js', '');
      const { state } = await import(base + 'app/store.js');
      const { toASS } = await import(base + 'engine/index.js');
      const ass = toASS(state.captions, state.style, 1080, 1920, {});
      // 👋's skin colour, #EF9645, is &H4596EF& in ASS
      return ass.split('\n').filter((l) => l.includes('\\p1') && l.includes('\\1c&H4596EF&')).length;
    });
    if (!assDrawings) diffs.push('no emoji drawings in the export script');
    // one undo puts captions and style back together
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await store();
    if (undone.caps.some((c) => c.emoji) || undone.emoji !== before.emoji || undone.emphasis !== before.emphasis) diffs.push('one undo did not restore captions and style');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    // the picker: a rocket for a caption without an emoji
    const plain = (await store()).caps.findIndex((c) => !c.emoji);
    await page.locator('.cap').nth(plain).locator('.emoji-btn').click();
    await page.fill('.emoji-pop input[type=search]', 'rocket');
    await page.click('.emoji-pop .emoji-opt[title="rocket"]');
    if ((await store()).caps[plain].emoji !== '🚀') diffs.push('picker did not set the emoji');
    if (await page.locator('.emoji-pop').count()) diffs.push('picker still open');
    // remove all
    await page.click('button:has-text("Remove all emojis")');
    if ((await store()).caps.some((c) => c.emoji)) diffs.push('emojis not removed');
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ emojis & keywords: ${withEmoji.length} emojis and a keyword per caption in one undo step, drawn in the preview and the export script, picker, remove all`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-emoji.png') }).catch(() => {});
    fail('emojis & keywords', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The video editor (/edit): media placed on the main track, music, a title and a
// shape; dragging, trimming, the razor, split, delete and undo with the mouse and
// keys; a look, keyframes, a blend mode and transitions; real-time playback; and
// an export whose frames match the preview's and whose sound follows the fades.
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const music = join(OUT, 'music.wav');
  // a steady tone (ffmpeg's sine is at 1/8 volume: about 0.044 RMS after this)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-af', 'volume=0.5', music]);
  const clips = () => page.evaluate(() => window.__editor.ed.project.clips.map((c) => ({ type: c.type, start: +c.start.toFixed(3), dur: +c.dur.toFixed(3), in: +c.in.toFixed(3),
    track: window.__editor.ed.project.tracks.find((t) => t.id === c.track).name })));
  try {
    await page.addInitScript(() => { window.__exportCodecs = ['vp9']; window.__exportAudioCodecs = ['opus']; });
    await page.goto(`${BASE}/edit`);
    await page.click('.es-tpl[data-id="blank"]');
    await page.setInputFiles('.ed-lib input[type=file]', [MEDIA + 'vert_vp9.mp4', MEDIA + 'land_vp9.mp4', music]);
    await page.waitForFunction(() => document.querySelectorAll('.lib-card').length === 3, null, { timeout: 30000 });
    for (const name of ['vert_vp9.mp4', 'land_vp9.mp4', 'music.wav']) await page.locator(`.lib-card[title^="${name}"] .lib-add`).click({ force: true });
    const diffs = [];
    let cs = await clips();
    if (cs[0].track !== 'V1' || cs[1].track !== 'V1' || cs[1].start !== 8 || cs[2].track !== 'A1') diffs.push(`placement ${JSON.stringify(cs)}`);
    // mouse: drag the music 1 s right, trim 1 s off the second video's start, razor the first at 3 s
    const mb = await page.locator('.et-clip.t-audio').boundingBox();
    await page.mouse.move(mb.x + 100, mb.y + 20); await page.mouse.down(); await page.mouse.move(mb.x + 180, mb.y + 20, { steps: 8 }); await page.mouse.up();
    const vb = await page.locator('.et-clip.t-video').nth(1).boundingBox();
    await page.mouse.move(vb.x + 2, vb.y + 20); await page.mouse.down(); await page.mouse.move(vb.x + 82, vb.y + 20, { steps: 8 }); await page.mouse.up();
    await page.keyboard.press('c');
    const fb = await page.locator('.et-clip.t-video').first().boundingBox();
    await page.mouse.click(fb.x + 240, fb.y + 20);
    await page.keyboard.press('v');
    cs = await clips();
    const vids = cs.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start);
    if (cs.find((c) => c.type === 'audio').start !== 1) diffs.push('music not dragged to 0:01');
    if (vids.length !== 3 || vids[0].dur !== 3 || vids[1].start !== 3 || vids[1].in !== 3 || vids[2].start !== 9 || vids[2].in !== 1) diffs.push(`trim/razor ${JSON.stringify(vids)}`);
    // keys: split the music at 5 s, delete the right part, undo
    await page.evaluate(() => { const { ed, select, setPlayhead } = window.__editor; select([ed.project.clips.find((c) => c.type === 'audio').id]); setPlayhead(5); });
    await page.keyboard.press('s');
    await page.keyboard.press('Delete');
    const afterDelete = (await clips()).filter((c) => c.type === 'audio').length;
    await page.keyboard.press('Control+z');
    if (afterDelete !== 1 || (await clips()).filter((c) => c.type === 'audio').length !== 2) diffs.push('split/delete/undo');
    // a title (lower third) and a circle from the library, then looks, keyframes, a blend and transitions
    await page.click('.lib-tabs [data-tab=text]');
    await page.evaluate(() => window.__editor.setPlayhead(0.5));
    await page.click('.lib-tile.text >> nth=2');
    await page.click('.lib-tabs [data-tab=shapes]');
    await page.evaluate(() => window.__editor.setPlayhead(6));
    await page.click('.lib-tile >> nth=2');
    await page.evaluate(() => {
      const { ed, edit } = window.__editor;
      const vids = ed.project.clips.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start);
      const text = ed.project.clips.find((c) => c.type === 'text'), circle = ed.project.clips.find((c) => c.type === 'shape');
      const music = ed.project.clips.filter((c) => c.type === 'audio').sort((a, b) => a.start - b.start);
      edit((p) => {
        const f = (id) => p.clips.find((c) => c.id === id);
        f(vids[0].id).look = 'film';
        f(vids[1].id).keys.scale = [{ t: 0, v: 1, ease: 'linear' }, { t: 5, v: 1.3, ease: 'linear' }];
        f(vids[1].id).transIn = { type: 'whip-left', dur: 0.6 };
        f(vids[0].id).fx = { vhs: 60 };
        f(vids[1].id).anim = { loop: 'kenburns', loopAmt: 60, in: 'none', out: 'none' };
        f(vids[2].id).transIn = { type: 'dissolve', dur: 1 };
        f(text.id).keys.rotation = [{ t: 0, v: -10, ease: 'inout' }, { t: 3, v: 10, ease: 'inout' }];
        f(circle.id).keys.x = [{ t: 0, v: -300, ease: 'linear' }, { t: 5, v: 300, ease: 'linear' }];
        f(circle.id).blend = 'screen';
        f(circle.id).transOut = { type: 'zoom', dur: 0.6 };
        // an adjustment layer over everything: film grain and cinema bars
        const top = { id: 'tadj', type: 'video', name: 'V3', muted: false, hidden: false, locked: false };
        p.tracks.unshift(top);
        p.clips.push({ id: 'adj1', type: 'adjust', name: 'Adjustment layer', track: 'tadj', start: 0, dur: 20, in: 0, speed: 1,
          props: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 }, keys: {}, fit: 'contain', blend: 'source-over', fx: { grain: 25, bars: 50 },
          look: 'none', audio: { fadeIn: 0, fadeOut: 0, mute: false }, transIn: null, transOut: null });
        Object.assign(f(music[0].id).audio, { fadeIn: 1 });
        Object.assign(f(music[1].id).audio, { fadeOut: 2 });
      });
    });
    // playback runs in real time
    await page.evaluate(() => window.__editor.setPlayhead(2));
    await page.keyboard.press(' ');
    await page.waitForTimeout(1500);
    await page.keyboard.press(' ');
    const played = await page.evaluate(() => window.__editor.ed.playhead) - 2;
    if (played < 1.2 || played > 1.8) diffs.push(`played ${played.toFixed(2)} s in 1.5 s`);
    // export, then compare its frames with the preview's
    await page.click('.ed-top .btn.brand');
    await page.click('#ed-dialog .btn.brand.lg');
    await page.waitForSelector('#ed-export-status .result.ok a', { timeout: 300000 });
    await page.keyboard.press('Escape');
    const times = [1.0, 3.1, 4.4, 6.5, 9.0, 11.2];
    const res = await page.evaluate(async (times) => {
      const { player, setPlayhead } = window.__editor;
      player.setQuality('full'); // every pixel, like the export
      const blob = await (await fetch(document.querySelector('#ed-export-status .result.ok a').href)).blob();
      const mbx = await import('/vendor/mediabunny-1.61.0.min.js');
      const input = new mbx.Input({ source: new mbx.BlobSource(blob), formats: mbx.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
      const sink = new mbx.CanvasSink(vt, { poolSize: 0 });
      const out = { psnr: [], dur: await input.computeDuration(), w: vt.displayWidth, h: vt.displayHeight, audio: !!at, rms: [] };
      for (const t of times) {
        const exp = (await sink.getCanvas(t + 0.001)).canvas.getContext('2d').getImageData(0, 0, 1080, 1920).data;
        setPlayhead(t);
        for (let i = 0; i < 100; i++) {
          await new Promise((ok) => setTimeout(ok, 50));
          if ([...player.els.values()].every((e) => e.el.readyState >= 2 && !e.el.seeking)) break;
        }
        player.invalidate();
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const pre = player.canvas.getContext('2d').getImageData(0, 0, 1080, 1920).data;
        let se = 0;
        for (let i = 0; i < pre.length; i += 4) for (let c = 0; c < 3; c++) { const d = pre[i + c] - exp[i + c]; se += d * d; }
        const mse = se / (1080 * 1920 * 3);
        out.psnr.push(+(mse ? 10 * Math.log10(255 * 255 / mse) : 99).toFixed(1));
      }
      // loudness in the fade-in, the middle and the fade-out of the music
      const as = new mbx.AudioBufferSink(at);
      for (const [a, b] of [[1.05, 1.25], [3, 3.2], [12.6, 12.8]]) {
        let s = 0, n = 0;
        for await (const w of as.buffers(a, b)) { const d = w.buffer.getChannelData(0); for (const v of d) { s += v * v; n++; } }
        out.rms.push(+Math.sqrt(s / Math.max(1, n)).toFixed(4));
      }
      return out;
    }, times);
    if (res.w !== 1080 || res.h !== 1920 || Math.abs(res.dur - 20) > 0.2 || !res.audio) diffs.push(`export ${res.w}x${res.h} ${res.dur}s audio ${res.audio}`);
    // the same picture scores 30+ dB after compression; a missing or misplaced layer scores well under 20
    if (res.psnr.some((x) => x < 26)) diffs.push(`preview vs export ${res.psnr.join(', ')} dB`);
    if (!(res.rms[0] < res.rms[1] * 0.4 && res.rms[2] < res.rms[1] * 0.6 && res.rms[1] > 0.03)) diffs.push(`sound ${res.rms.join(', ')}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ editor: placement, drag, trim, razor, split/delete/undo, real-time playback, looks, keyframes, blend, transitions (whip, dissolve), VHS, Ken Burns, adjustment layer (grain, bars); export matches the preview (${Math.min(...res.psnr)} dB lowest) with faded sound`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-editor.png') }).catch(() => {});
    fail('editor', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// From Capstudio to the editor: a captioned video opens there with its captions,
// and the editor can caption its own edit.
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => { window.__exportCodecs = ['vp9']; });
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForSelector('#to-editor:not([disabled])', { timeout: 120000 });
    const n = await page.evaluate(async () => (await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'))).state.captions.length);
    await page.click('#to-editor');
    await page.waitForURL(/\/edit\?project=/, { timeout: 20000 });
    await page.waitForFunction(() => window.__editor?.ed.project.clips.length >= 2, null, { timeout: 30000 });
    const st = await page.evaluate(() => { const p = window.__editor.ed.project; return { W: p.W, H: p.H, types: p.clips.map((c) => c.type), caps: p.clips.find((c) => c.type === 'captions')?.captions.length }; });
    const diffs = [];
    if (st.W !== 1080 || st.H !== 1920 || !st.types.includes('video') || st.caps !== n) diffs.push(`handoff ${JSON.stringify(st)} (expected ${n} captions)`);
    await page.evaluate(() => { const { edit } = window.__editor; edit((p) => { p.clips = p.clips.filter((c) => c.type !== 'captions'); }); });
    await page.click('.lib-tabs [data-tab=captions]');
    await page.click('button:has-text("Caption this edit")');
    await page.waitForFunction(() => window.__editor.ed.project.clips.some((c) => c.type === 'captions'), null, { timeout: 120000 });
    const auto = await page.evaluate(() => window.__editor.ed.project.clips.find((c) => c.type === 'captions').captions);
    if (!auto.length || !/Hey/.test(auto[0].words.map((w) => w.text).join(' '))) diffs.push('auto captions missing');
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log(`✓ Capstudio → editor: video and ${n} captions carried over; the edit captioned in the editor (${auto.length} captions)`);
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-editor-handoff.png') }).catch(() => {});
    fail('Capstudio → editor', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// Between Captions and the Editor: the header switch takes a captioned video
// (with the style changed in the type bar) into the editor, comes back to the same
// video, and going again reopens the same edit. Then the editor's start screen:
// a format and a starter layout, a custom size, and "Import a video" matching it.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const projects = () => page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('capstudio-editor');
    q.onsuccess = () => { const t = q.result.transaction('projects').objectStore('projects').getAll(); t.onsuccess = () => res(t.result.map((p) => ({ source: p.source, W: p.W, H: p.H }))); };
  }));
  try {
    const diffs = [];
    await page.goto(BASE);
    await page.waitForSelector('.tester-name:not(:empty)', { timeout: 15000 });
    // first page: the editor and the Adobe panel as cards; the hero phone's tester
    if (await page.locator('.more-tools .tool-card').count() !== 2) diffs.push('tool cards missing');
    const name0 = await page.textContent('.tester-name');
    await page.click('.tester-arrow[aria-label="Next style"]');
    const name1 = await page.textContent('.tester-name');
    const startWith = await page.textContent('.start-with');
    if (name0 === name1 || !startWith.includes(name1)) diffs.push(`tester: ${name0} → ${name1}, "${startWith}"`);
    await page.fill('.tester-input', 'Free delivery today');
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => document.querySelector('.hero-phone .live-captions').textContent);
    if (!/Free|FREE|free/.test(shown)) diffs.push(`typed line not shown on the phone ("${shown.slice(0, 40)}")`);

    await page.setInputFiles('#file-input', MEDIA + 'vert.webm');
    await page.waitForFunction(() => !document.querySelector('#export-btn')?.disabled, null, { timeout: 120000 });
    // the type bar changes the captions live
    const size0 = Number(await page.inputValue('.tb-num'));
    await page.click('.tb-size [aria-label="Bigger"]');
    await page.click('.typebar [aria-label="lower case"]');
    await page.click('.typebar [aria-label="Near the top"]');
    const size1 = Number(await page.inputValue('.tb-num'));
    if (size1 !== size0 + 4) diffs.push(`type bar size ${size0} → ${size1}`);
    // phone view: an iPhone screen (393 × 852 points) with Reels' interface; the video
    // fills the space above the bottom navigation, as in the app
    await page.click('.view-seg [data-view="phone"]');
    const ph = await page.evaluate(() => { const d = document.querySelector('.device-screen').getBoundingClientRect(), f = document.querySelector('.frame').getBoundingClientRect(),
      nav = document.querySelector('.ph-nav').getBoundingClientRect();
      return { ratio: d.height / d.width, fills: f.left <= d.left + 1 && f.right >= d.right - 1, aboveNav: Math.abs(f.bottom - nav.top) < 2 || f.bottom <= nav.top + 1,
        ui: !!document.querySelector('.ph-ui.ph-reels .ph-side') && !!document.querySelector('.ph-status') }; });
    if (Math.abs(ph.ratio - 852 / 393) > 0.02 || !ph.fills || !ph.aboveNav || !ph.ui) diffs.push(`phone view ${JSON.stringify(ph)}`);

    // renaming: in the top bar, then in the export dialog; downloads take the name
    await page.fill('#file-name', 'Launch teaser'); await page.press('#file-name', 'Enter');
    await page.click('#export-btn');
    if (await page.inputValue('#export-name') !== 'Launch teaser') diffs.push(`export dialog name ${await page.inputValue('#export-name')}`);
    await page.check('input[name="export-kind"][value="files"]');
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ex-file:has-text("SRT")')]);
    if (dl.suggestedFilename() !== 'Launch teaser.srt') diffs.push(`caption file named ${dl.suggestedFilename()}`);
    await page.fill('#export-name', 'Final cut'); await page.press('#export-name', 'Enter');
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ex-file:has-text("SRT")')]);
    if (dl.suggestedFilename() !== 'Final cut.srt' || await page.inputValue('#file-name') !== 'Final cut') diffs.push(`renamed in the dialog: ${dl.suggestedFilename()}`);
    if (await page.getAttribute('label.ex-type:has(input[value="files"])', 'class') !== 'ex-type on') diffs.push('chosen kind not marked');
    await page.click('#export-dialog [aria-label="Close"]');

    await page.click('.app-switch [data-app="editor"]');
    await page.waitForURL(/\/edit\?project=/, { timeout: 30000 });
    await page.waitForFunction(() => window.__editor?.ed.project?.clips.some((c) => c.type === 'captions'), null, { timeout: 60000 });
    const carried = await page.evaluate(() => { const c = window.__editor.ed.project.clips.find((x) => x.type === 'captions'); return { size: c.style.size, textCase: c.style.textCase, vPos: c.style.vPos }; });
    if (carried.size !== size1 || carried.textCase !== 'lower' || carried.vPos !== 'top') diffs.push(`style not carried ${JSON.stringify(carried)}`);
    // the editor's caption settings
    await page.evaluate(() => { const c = window.__editor.ed.project.clips.find((x) => x.type === 'captions'); window.__editor.select([c.id]); });
    const capsBefore = await page.evaluate(() => window.__editor.ed.project.clips.find((x) => x.type === 'captions').captions.length);
    const words = page.locator('.ins-row:has(label:text-is("Max words")) input[type=number]');
    await words.fill('2'); await words.press('Enter');
    const capsAfter = await page.evaluate(() => window.__editor.ed.project.clips.find((x) => x.type === 'captions').captions.length);
    if (capsAfter <= capsBefore) diffs.push(`max words didn't re-split (${capsBefore} → ${capsAfter})`);
    // the editor's export names the file after the project, renamed there
    await page.click('.ed-top .btn.brand');
    if (await page.inputValue('#ed-export-name') !== 'Final cut') diffs.push(`editor export name ${await page.inputValue('#ed-export-name')}`);
    await page.fill('#ed-export-name', 'Edit v2'); await page.press('#ed-export-name', 'Enter');
    if (await page.evaluate(() => window.__editor.ed.project.name) !== 'Edit v2') diffs.push('editor export rename');
    await page.click('#ed-dialog [aria-label="Close"]');
    // keyboard shortcuts and the play button's shape
    await page.keyboard.press('?');
    if (!(await page.locator('.ed-keys').isVisible())) diffs.push('shortcuts dialog');
    await page.keyboard.press('Escape');
    const pb = await page.evaluate(() => { const r = document.querySelector('.vw-play').getBoundingClientRect(); return [r.width, r.height]; });
    if (pb[0] !== pb[1]) diffs.push(`play button ${pb}`);

    await page.click('.app-switch [data-app="captions"]');
    await page.waitForFunction(() => document.querySelector('#file-name')?.value === 'Final cut' && !document.querySelector('#export-btn')?.disabled, null, { timeout: 60000 });
    await page.click('.app-switch [data-app="editor"]');
    await page.waitForFunction(() => window.__editor?.ed.project?.clips.some((c) => c.type === 'captions'), null, { timeout: 60000 });
    const ps = await projects();
    if (ps.length !== 1 || !ps[0].source) diffs.push(`expected the same edit reopened, got ${JSON.stringify(ps)}`);

    // start screen: Landscape 16:9 + "Product launch"
    await page.click('.ed-top a[aria-label="All projects"]');
    await page.waitForSelector('.es-tpl');
    await page.click('.es-format[data-id="16x9"]');
    await page.click('.es-tpl[data-id="launch"]');
    await page.waitForFunction(() => window.__editor?.ed.project?.W === 1920, null, { timeout: 10000 });
    const launch = await page.evaluate(() => { const p = window.__editor.ed.project; return { W: p.W, H: p.H, bg: p.bg, texts: p.clips.filter((c) => c.type === 'text').length, onV1: p.clips.some((c) => c.track === p.tracks.filter((t) => t.type === 'video').at(-1).id) }; });
    if (launch.H !== 1080 || launch.bg !== '#6037D7' || launch.texts < 3 || launch.onV1) diffs.push(`starter ${JSON.stringify(launch)}`);
    // custom size
    await page.click('.ed-top a[aria-label="All projects"]');
    await page.waitForSelector('.es-tpl');
    await page.fill('.es-size input >> nth=0', '1234'); await page.press('.es-size input >> nth=0', 'Tab');
    await page.fill('.es-size input >> nth=1', '701'); await page.press('.es-size input >> nth=1', 'Tab');
    if (await page.getAttribute('.es-format[data-id="custom"]', 'aria-checked') !== 'true') diffs.push('typing a size didn\'t pick Custom');
    await page.click('.es-tpl[data-id="blank"]');
    await page.waitForFunction(() => window.__editor?.ed.project?.W === 1234, null, { timeout: 10000 });
    const custom = await page.evaluate(() => [window.__editor.ed.project.W, window.__editor.ed.project.H, window.__editor.ed.project.clips.length]);
    if (custom[1] !== 702 || custom[2] !== 0) diffs.push(`custom size ${custom}`);
    // import a video: the canvas matches it
    await page.click('.ed-top a[aria-label="All projects"]');
    await page.waitForSelector('.es-picker', { state: 'attached' });
    await page.setInputFiles('.es-picker', MEDIA + 'land_vp9.mp4');
    await page.waitForFunction(() => window.__editor?.ed.project?.clips.some((c) => c.type === 'video'), null, { timeout: 30000 });
    const imp = await page.evaluate(() => { const p = window.__editor.ed.project; return [p.W, p.H, p.clips[0].start]; });
    if (imp[0] !== 1920 || imp[1] !== 1080 || imp[2] !== 0) diffs.push(`import a video ${imp}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ Captions ⇄ Editor: type bar and phone view, style carried into the editor and back, the same edit reopened; start screen: format + starter, custom size, import matches the video; caption settings and shortcuts in the editor');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-switch.png') }).catch(() => {});
    fail('Captions ⇄ Editor', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// When Premiere didn't load the panel's host script (installed or updated while it
// was open), the panel loads it itself and captions as usual.
{
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/?nohost=1`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the selected clip")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 120000 });
    const loaded = await page.evaluate(() => ({ host: typeof window.Capstudio, files: window.__evalFiles || [] }));
    if (loaded.host !== 'object' || loaded.files[0] !== 'C:/Users/me/AppData/Roaming/Adobe/CEP/extensions/com.fastrr.capstudio/host/host.jsx') throw new Error(`host script ${JSON.stringify(loaded)}`);
    if (await app.locator('.panel-update').count()) throw new Error('update notice shown for a current panel');
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log('✓ panel without its host script: loads it itself, then captions the clip');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-panel-nohost.png') }).catch(() => {});
    fail('panel host script recovery', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// A panel installed before versions were reported: the first screen says how to
// update it, and "Caption the whole sequence" explains instead of waiting forever.
{
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  try {
    await page.goto(`${BASE}/__panel/?scene=timeline&old=1`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('.panel-update:not([hidden])').waitFor({ timeout: 8000 });
    await app.locator('button:has-text("Caption the whole sequence")').click();
    await app.locator('.toast:has-text("needs a quick update")').waitFor({ timeout: 8000 });
    await app.locator('.panel-update button').click();
    await app.locator('#export-dialog .cmd-block').first().waitFor({ timeout: 5000 });
    console.log('✓ older panel install: an update notice with the install steps; whole sequences explain the update');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-panel-old.png') }).catch(() => {});
    fail('older panel install', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The Adobe panel's own layout, in a narrow docked panel: the page never scrolls,
// the preview, every tool tab and the main action stay on screen, only the
// settings scroll, and each tool keeps its scroll position and folded sections.
{
  const page = await browser.newPage({ viewport: { width: 380, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the selected clip")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 120000 });
    const frame = page.frames().find((f) => f.url().includes('host=premiere'));
    const diffs = [];
    for (const tool of ['templates', 'text', 'effects', 'motion', 'position', 'watermark', 'captions']) {
      await frame.click(`.rail button[data-tool="${tool}"]`);
      const m = await frame.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const tabs = [...document.querySelectorAll('.rail button')].map((b) => b.getBoundingClientRect());
        return { pageScroll: document.documentElement.scrollHeight - innerHeight, tabsInside: tabs.every((r) => r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight),
          action: box('#export-btn').bottom <= innerHeight && box('#export-btn').top >= 0, preview: box('.stage-wrap').height > 120,
          body: (() => { const b = document.querySelector('#panel .panel-body'); return getComputedStyle(b).overflowY; })() };
      });
      if (m.pageScroll > 1 || !m.tabsInside || !m.action || !m.preview || m.body !== 'auto') diffs.push(`${tool}: ${JSON.stringify(m)}`);
    }
    await frame.click('.rail button[data-tool="templates"]');
    await frame.evaluate(() => { document.querySelector('#panel .panel-body').scrollTop = 900; });
    await frame.click('.rail button[data-tool="text"]');
    await frame.click('.section > h3 >> nth=0');
    await frame.click('.rail button[data-tool="templates"]');
    await page.waitForTimeout(150);
    const back = await frame.evaluate(() => document.querySelector('#panel .panel-body').scrollTop);
    await frame.click('.rail button[data-tool="text"]');
    const folded = await frame.evaluate(() => document.querySelector('#panel .section').classList.contains('folded'));
    await frame.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('3');
    const third = await frame.evaluate(() => document.querySelector('.rail button[aria-selected=true]').dataset.tool);
    if (Math.abs(back - 900) > 2) diffs.push(`styles scroll not kept (${back})`);
    if (!folded) diffs.push('folded section not kept');
    if (third !== 'effects') diffs.push(`key 3 opened ${third}`);
    if (await frame.locator('#to-editor').count()) diffs.push('the editor link shows in the panel');
    if (await frame.locator('.app-switch, .tool-card').count()) diffs.push('the Captions/Editor switch shows in the panel');
    if (await frame.locator('.typebar').isVisible()) diffs.push('the type bar shows in the panel');
    // the phone view works in the panel too: the whole phone on screen, nothing pushed off
    await frame.click('.view-seg [data-view="phone"]');
    await page.waitForTimeout(300);
    const pv = await frame.evaluate(() => { const d = document.querySelector('.device').getBoundingClientRect(), s = document.querySelector('.device-screen').getBoundingClientRect();
      return { ratio: s.height / s.width, onScreen: d.top >= 0 && d.bottom <= innerHeight, pageScroll: document.documentElement.scrollHeight - innerHeight,
        ui: !!document.querySelector('.ph-ui .ph-nav'), action: document.querySelector('#export-btn').getBoundingClientRect().bottom <= innerHeight }; });
    if (Math.abs(pv.ratio - 852 / 393) > 0.02 || !pv.onScreen || pv.pageScroll > 1 || !pv.ui || !pv.action) diffs.push(`phone view in the panel ${JSON.stringify(pv)}`);
    await frame.click('.view-seg [data-view="frame"]');
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ Adobe panel layout (380×860): no page scroll, preview, all tabs and "Add to timeline" always on screen; scroll and folds kept per tool; keys 1–7; phone view');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-panel-layout.png') }).catch(() => {});
    fail('Adobe panel layout', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The Premiere Pro panel, end to end: the real panel bridge and host script with
// Premiere replaced by a stand-in (tests/panel/). A clip used from 0:03 of its
// file sits at 0:02–0:08 on V1 of a 1080×1920, 25 fps sequence; V2 is busy there.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/`);
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

// The same panel in After Effects, with After Effects replaced by a stand-in
// (tests/ae/fake-ae.js). The selected layer plays 0:03–0:09 of its file at 0:02–0:08
// of a 1080×1920, 25 fps comp. Editable layers first, then the transparent video.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/ae.html`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the selected layer")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 120000 });
    const frame = page.frames().find((f) => f.url().includes('host=aftereffects'));
    const st = await frame.evaluate(async () => {
      const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      state.watermark = { ...state.watermark, on: true };
      return { w: state.project.info.width, h: state.project.info.height, caps: state.captions.map((c) => [c.start, c.end]) };
    });
    const diffs = [];
    if (st.w !== 1080 || st.h !== 1920) diffs.push(`laid out at ${st.w}x${st.h}, expected the comp's 1080x1920`);
    if (!st.caps.length || st.caps.some(([a, b]) => b <= 3 || a >= 9)) diffs.push('captions outside the used part (0:03–0:09) of the file');
    await app.locator('#export-btn').click();
    await app.locator('#export-dialog .btn.brand').click();
    await app.locator('#export-status .result.ok').waitFor({ timeout: 120000 });
    const built = await page.evaluate(() => {
      const f = window.__fake, pre = f.comps[0], list = f.active.list.map((l) => ({ kind: l.kind, name: l.name, startTime: l.startTime,
        stretch: l.stretch, inPoint: l.inPoint, outPoint: l.outPoint }));
      return { list, pre: pre && { w: pre.width, h: pre.height, fps: pre.frameRate, n: pre.list.length, kinds: pre.list.map((l) => l.kind) },
        imported: f.imported, written: Object.keys(window.__written), alerts: f.alerts };
    });
    if (!built.pre || built.pre.w !== 1080 || built.pre.h !== 1920 || built.pre.fps !== 25 || built.pre.n < st.caps.length) {
      diffs.push(`precomp ${JSON.stringify(built.pre)}`);
    }
    if (!built.pre?.kinds.includes('text')) diffs.push('no text layers in the precomp');
    const pl = built.list[1];
    if (built.list[0].name !== 'Logo' || pl?.kind !== 'precomp' || built.list[2].name !== 'vert.webm') diffs.push(`layer order ${built.list.map((l) => l.name).join(', ')}`);
    else if (pl.startTime !== -1 || pl.stretch !== 100 || pl.inPoint !== 2 || pl.outPoint !== 8) diffs.push(`precomp timing ${JSON.stringify(pl)}`);
    if (!built.written.some((p) => p.startsWith('/work/Capstudio/Capstudio ') && p.endsWith('.png'))) diffs.push(`watermark not saved: ${built.written}`);
    if (!built.pre?.kinds.includes('footage')) diffs.push('watermark not in the precomp');
    if (built.alerts.length) diffs.push(`alerts: ${built.alerts.join(' | ')}`);
    // the transparent video
    await app.locator('#export-dialog label:has-text("Transparent video")').click();
    await app.locator('#export-dialog .btn.brand').click();
    await app.locator('#export-status .result.ok:has-text("Added above the layer")').waitFor({ timeout: 120000 });
    const out = await page.evaluate(() => ({
      list: window.__fake.active.list.map((l) => ({ kind: l.kind, name: l.name, startTime: l.startTime, inPoint: l.inPoint, outPoint: l.outPoint })),
      files: Object.fromEntries(Object.entries(window.__written).filter(([k]) => k.endsWith('.mov')).map(([k, v]) => [k, Array.from(new Uint8Array(v))])) }));
    const movPath = Object.keys(out.files)[0];
    if (movPath !== '/work/Capstudio/vert captions.mov') diffs.push(`saved as ${movPath}`);
    const mov = join(OUT, 'panel-ae.mov');
    writeFileSync(mov, Buffer.from(out.files[movPath] || []));
    const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,nb_read_frames', '-of', 'json', mov])).streams[0];
    if (v.codec_name !== 'qtrle' || v.width !== 1080 || v.height !== 1920 || v.r_frame_rate !== '25/1' || Number(v.nb_read_frames) !== 150) {
      diffs.push(`captions video ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} ${v.nb_read_frames} frames, expected qtrle 1080x1920 25/1 150`);
    }
    // directly above the captioned layer (under the precomp added before)
    const at = out.list.findIndex((l) => l.name === 'vert.webm'), fl = out.list[at - 1];
    if (fl?.kind !== 'footage' || fl.name !== 'vert captions.mov' || fl.startTime !== 2 || fl.inPoint !== 2 || fl.outPoint !== 8) diffs.push(`video layer ${JSON.stringify(fl)}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ After Effects panel: selected layer captioned for its used part, editable layers in a synced precomp above it (with the watermark), transparent video option');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-ae-panel.png') }).catch(() => {});
    fail('After Effects panel', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The whole sequence in Premiere Pro: two videos cut together on V1, a nested
// sequence on V2, the videos' sound and a voice-over on A1–A2, music on a muted A3.
// Every playing clip is sent, the edit rebuilt (muted music left out) and captioned
// over its full 10 s; the captions land on V3 from 0:00.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/?scene=timeline`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the whole sequence")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 180000 });
    const frame = page.frames().find((f) => f.url().includes('host=premiere'));
    const st = await frame.evaluate(async () => {
      const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      return { info: state.project.info, used: state.premiere.used, skipped: state.premiere.skipped, name: state.project.name,
        caps: state.captions.map((c) => [c.start, c.end]) };
    });
    const diffs = [];
    if (st.info.width !== 1080 || st.info.height !== 1920 || Math.abs(st.info.duration - 10) > 0.1) diffs.push(`timeline ${st.info.width}x${st.info.height} ${st.info.duration}s`);
    if (st.used?.video !== 2 || st.used?.audio !== 3 || st.skipped !== 1) diffs.push(`used ${JSON.stringify(st.used)}, skipped ${st.skipped} (expected 2 pictures, 3 sounds without the muted music, 1 nested sequence)`);
    if (!st.caps.length || Math.max(...st.caps.map((c) => c[1])) < 8.5 || Math.min(...st.caps.map((c) => c[0])) > 1) diffs.push(`captions don't cover the whole edit: ${JSON.stringify(st.caps.slice(0, 2))}…`);
    await app.locator('#export-btn').click();
    await app.locator('#export-dialog .btn.brand').click();
    await app.locator('#export-status .result.ok').waitFor({ timeout: 120000 });
    const out = await page.evaluate(() => ({ log: window.__fake.log,
      files: Object.fromEntries(Object.entries(window.__written).map(([k, v]) => [k, Array.from(new Uint8Array(v))])) }));
    const movPath = Object.keys(out.files).find((k) => k.endsWith('.mov'));
    if (movPath !== '/work/Capstudio/Launch reel captions.mov') diffs.push(`saved as ${movPath}`);
    const mov = join(OUT, 'panel-seq.mov');
    writeFileSync(mov, Buffer.from(out.files[movPath] || []));
    const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', mov])).streams[0];
    if (v.width !== 1080 || v.height !== 1920 || Number(v.nb_read_frames) !== 250) diffs.push(`captions video ${v.width}x${v.height} ${v.nb_read_frames} frames, expected 1080x1920 250`);
    const placed = out.log.find((l) => l[0] === 'overwriteClip');
    if (!placed || placed[1] !== 2 || placed[3] !== 0) diffs.push(`placed ${JSON.stringify(placed)}, expected V3 at 0:00`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ Premiere whole sequence: two cuts, voice-over and video sound mixed (muted music left out, nested sequence counted), captioned over the full 10 s, placed on V3 from 0:00');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-premiere-seq.png') }).catch(() => {});
    fail('Premiere whole sequence', e.message.split('\n')[0]);
  } finally {
    await page.close();
  }
}

// The whole composition in After Effects: two footage layers (one with its sound
// off) and a voice-over layer (picture off). Captioned over the comp's 12 s and added
// as editable layers in a precomp at the top, over the full length.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/__panel/ae.html?scene=timeline`);
    await page.waitForSelector('#loading.done', { state: 'attached', timeout: 30000 });
    const app = page.frameLocator('iframe');
    await app.locator('button:has-text("Caption the whole composition")').click();
    await app.locator('#export-btn:not([disabled])').waitFor({ timeout: 180000 });
    const frame = page.frames().find((f) => f.url().includes('host=aftereffects'));
    const st = await frame.evaluate(async () => {
      const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      return { info: state.project.info, used: state.premiere.used, caps: state.captions.map((c) => [c.start, c.end]) };
    });
    const diffs = [];
    if (Math.abs(st.info.duration - 12) > 0.1) diffs.push(`timeline ${st.info.duration}s`);
    if (st.used?.video !== 2 || st.used?.audio !== 2) diffs.push(`used ${JSON.stringify(st.used)} (expected 2 pictures, 2 sounds)`);
    if (!st.caps.length || Math.max(...st.caps.map((c) => c[1])) < 10.5) diffs.push('captions don\'t reach the end of the comp');
    await app.locator('#export-btn').click();
    await app.locator('#export-dialog .btn.brand').click();
    await app.locator('#export-status .result.ok').waitFor({ timeout: 120000 });
    const built = await page.evaluate(() => window.__fake.active.list.map((l) => ({ kind: l.kind, name: l.name, startTime: l.startTime, inPoint: l.inPoint, outPoint: l.outPoint, stretch: l.stretch })));
    const top = built[0];
    if (top.kind !== 'precomp' || top.startTime !== 0 || top.inPoint !== 0 || top.outPoint !== 12 || top.stretch !== 100) diffs.push(`precomp ${JSON.stringify(top)}`);
    if (errors.length) diffs.push(`page errors: ${errors.join('; ')}`);
    if (diffs.length) throw new Error(diffs.join(', '));
    console.log('✓ After Effects whole composition: every footage layer\'s sound mixed (switched-off sound left out), captioned over 12 s, editable layers in a precomp at the top over the full length');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-ae-comp.png') }).catch(() => {});
    fail('After Effects whole composition', e.message.split('\n')[0]);
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
  words[1].emoji = '🚀'; // an emoji too: drawn from the After Effects shapes below
  const captions = [{ id: 'a', start: 0.2, end: 1.6, words: words.slice(0, 4) }, { id: 'b', start: 1.6, end: 3.2, words: words.slice(4) }];
  const shapePath = (paths) => {
    const p = new Path2D();
    for (const q of paths) {
      const n = q.v.length;
      p.moveTo(...q.v[0]);
      for (let k = 1; k <= n; k++) {
        const a = q.v[k - 1], b = q.v[k % n];
        p.bezierCurveTo(a[0] + q.o[k - 1][0], a[1] + q.o[k - 1][1], b[0] + q.i[k % n][0], b[1] + q.i[k % n][1], b[0], b[1]);
      }
      p.closePath();
    }
    return p;
  };
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
        if (L.type === 'emoji') {
          for (const sh of L.shapes) { cb.fillStyle = sh.color; cb.globalAlpha = (op / 100) * (sh.opacity / 100); cb.fill(shapePath(sh.paths)); }
        } else if (L.type === 'box') {
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
    out[id] = { scores, layers: data.layers.length, emoji: data.layers.some((l) => l.type === 'emoji') };
  }
  return out;
}, ['hormozi', 'karaoke', 'fastrr-pill', 'fastrr-marker', 'two-tier', 'popstar', 'serif-stack', 'big-word']);
    const low = Object.entries(res).filter(([, v]) => Math.min(...v.scores) < 28).map(([k, v]) => `${k} ${Math.min(...v.scores)} dB`);
    const noEmoji = Object.entries(res).filter(([, v]) => !v.emoji).map(([k]) => k);
    if (noEmoji.length) throw new Error(`no emoji layer for ${noEmoji.join(', ')}`);
    if (low.length) throw new Error(`layers drift from the preview: ${low.join(', ')}`);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log(`✓ After Effects: zip with script, font and watermark; the script builds every layer; layers (with an emoji) match the preview (lowest ${Math.min(...Object.values(res).flatMap((v) => v.scores))} dB)`);
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

// Batch queue: three videos at once are captioned one by one; a reload part-way
// carries on; a ready one opens with its captions; "Next video" moves on; an
// exported one is marked as such.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const list = async () => (await page.locator('.recent').innerText()).replace(/\n+/g, ' | ');
  const st = () => page.evaluate(async () => {
    const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
    return { name: state.project.name, caps: state.captions.length, tpl: state.templateId, job: !!state.project.job };
  });
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', [MEDIA + 'vert.webm', MEDIA + 'land.webm', MEDIA + 'vert_vp9.mp4']);
    await page.waitForSelector('.recent-item');
    if (!/Queue/i.test(await list())) throw new Error(`no queue: ${await list()}`);
    await page.waitForTimeout(1200);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.recent-item .q-ready').length === 3, null, { timeout: 240000 });
    await page.locator('.recent-open').first().click();
    await page.waitForSelector('#export-btn:not([disabled])', { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('next-video')?.hidden, null, { timeout: 10000 });
    const a = await st();
    if (a.name !== 'vert.webm' || !a.caps || a.tpl !== 'hormozi') throw new Error(`opened ${JSON.stringify(a)}`);
    await page.click('#next-video');
    await page.waitForFunction(() => document.querySelector('#file-name')?.value === 'land', null, { timeout: 30000 });
    await page.waitForFunction(async () => {
      const { state } = await import(document.querySelector('script[type=module]').src.replace('main.js', 'store.js'));
      return !!state.project.job;
    }, null, { timeout: 10000 });
    await page.click('#export-btn');
    await page.check('input[name="export-kind"][value="overlay"]');
    await page.click('#export-dialog .btn.brand');
    await page.waitForSelector('#export-status a.btn', { timeout: 60000 });
    await Promise.all([page.waitForEvent('download'), page.click('#export-status a.btn')]);
    await page.waitForTimeout(500);
    await page.click('#export-dialog [aria-label="Close"]');
    await page.click('#new-video');
    await page.waitForSelector('.recent-item');
    await page.waitForTimeout(600);
    const home = await list();
    if (!/land\.webm \| Exported/.test(home) || !/vert\.webm \| In progress/.test(home) || !/vert_vp9\.mp4 \| Ready to review/.test(home)) throw new Error(`list: ${home}`);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    console.log('✓ batch queue: three videos captioned one by one (through a reload), opened with their captions, "Next video", exported marked');
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'failure-queue.png') }).catch(() => {});
    fail('batch queue', e.message.split('\n')[0]);
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
