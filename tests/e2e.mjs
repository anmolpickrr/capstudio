// End-to-end browser test: upload → generate → template → render → download,
// then checks the export kept the source's resolution, frame rate, codec and
// bit depth. Needs tests/stub_server.py running (see tests/README.md).
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
  ['land.webm', 'bold-pop', 'mp4'],
  ['land.webm', 'typewriter', 'mp4'],
  ['vert_hevc10.mp4', 'one-word', 'mp4'],
  ['prores.mov', 'boxed', 'mov'],
  ['rotated.mp4', 'clean', 'mp4'],
];

const probe = (file) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,profile,width,height,r_frame_rate,pix_fmt', '-of', 'json', file]);
  return JSON.parse(out).streams[0];
};

const browser = await chromium.launch();
let failed = 0;
for (const [file, tpl, ext] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.setInputFiles('#file-input', MEDIA + file);
    await page.selectOption('#language', 'en-US');
    await page.click('#generate');
    await page.waitForSelector('#screen-editor:not([hidden])', { timeout: 60000 });
    await page.click(`.tpl[data-id="${tpl}"]`);
    await page.click('[data-tab="export"]');
    await page.click('#render-burn');
    await page.waitForSelector('#download:not([hidden])', { timeout: 300000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const out = join(OUT, `${tpl}-${dl.suggestedFilename()}`);
    await dl.saveAs(out);

    let src = probe(MEDIA + file);
    if (file === 'rotated.mp4') src = { ...src, width: src.height, height: src.width };
    const got = probe(out);
    const expect = { width: src.width, height: src.height, r_frame_rate: src.r_frame_rate, pix_fmt: src.pix_fmt };
    if (src.codec_name !== 'vp9') Object.assign(expect, { codec_name: src.codec_name, profile: src.profile });
    const diffs = Object.entries(expect).filter(([k, v]) => got[k] !== v);
    if (!out.endsWith(`.${ext}`)) diffs.push(['extension', ext]);
    if (errors.length) diffs.push(['page errors', errors.join('; ')]);
    if (diffs.length) throw new Error(diffs.map(([k, v]) => `${k}: expected ${v}, got ${got[k]}`).join(', '));
    console.log(`✓ ${file} + ${tpl} → ${got.width}x${got.height} ${got.codec_name} ${got.pix_fmt} ${got.r_frame_rate}`);
  } catch (e) {
    failed++;
    const shot = join(OUT, `failure-${tpl}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    console.log(`✗ ${file} + ${tpl}: ${e.message}\n  screenshot: ${shot}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
