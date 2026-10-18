// Preview vs export comparison. For each case, draws a caption frame with the
// live-preview renderer (SVG in Chromium) and burns the same frame with
// ffmpeg/libass from the exported ASS, then measures how alike they are.
//   node tests/parity.mjs [case-name-filter]      (needs tests/stub_server.py)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { CASES } from './parity_cases.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const FONTS = new URL('../fonts', import.meta.url).pathname;
const OUT = process.env.PARITY_OUT || join(tmpdir(), 'caption-parity');
const MIN_PSNR = Number(process.env.MIN_PSNR || 20);
const MIN_PSNR_BROWSER = Number(process.env.MIN_PSNR_BROWSER || 22);
mkdirSync(OUT, { recursive: true });

const filter = process.argv[2] || '';
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto(`${BASE}/__parity/`);
await page.waitForFunction(() => window.ready === true);
let failed = 0;
for (const c of CASES.filter((x) => x.name.includes(filter))) {
  const { W, H, t } = c;
  const bg = c.bg || '#3a4a5a';
  await page.setViewportSize({ width: W, height: H });
  const { ass, box, png } = await page.evaluate((arg) => window.renderCase(arg), { ...c, bg });
  await page.waitForTimeout(150);
  const preview = join(OUT, `${c.name}-preview.png`);
  await page.locator('#stage').screenshot({ path: preview });
  const assPath = join(OUT, `${c.name}.ass`);
  writeFileSync(assPath, ass);
  const exported = join(OUT, `${c.name}-export.png`);
  // A still frame at exactly time t: start the colour source at 0, seek in output.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${bg.replace('#', '0x')}:s=${W}x${H}:r=100:d=${t + 1}`,
    '-vf', `ass=${assPath}:fontsdir=${FONTS}`, '-ss', String(t), '-frames:v', '1', exported]);
  // Score only the area around the caption, so empty background can't hide differences.
  const crop = `crop=${box.w}:${box.h}:${box.x}:${box.y}`;
  const score = (a, b) => {
    try {
      const log = execFileSync('sh', ['-c', `ffmpeg -i "${a}" -i "${b}" -lavfi "[0:v]format=rgb24,${crop}[a];[1:v]format=rgb24,${crop}[b];[a][b]psnr" -f null - 2>&1`]).toString();
      return Number((log.match(/average:([\d.]+|inf)/) || [])[1]?.replace('inf', '99'));
    } catch { return 0; }
  };
  const psnr = score(preview, exported);
  // the in-browser export draws with canvas: it should match the preview closely
  const browserPng = join(OUT, `${c.name}-browser.png`);
  writeFileSync(browserPng, Buffer.from(png, 'base64'));
  const psnrBrowser = score(preview, browserPng);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', preview, '-i', exported, '-filter_complex',
    `[0]${crop}[a];[1]${crop}[b];[a][b]vstack`, join(OUT, `${c.name}-compare.png`)]);
  const ok = psnr >= (c.minPsnr || MIN_PSNR) && psnrBrowser >= MIN_PSNR_BROWSER;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${c.name.padEnd(28)} PSNR ${psnr.toFixed(1)} dB · browser export ${psnrBrowser.toFixed(1)} dB`);
}
await browser.close();
console.log(failed ? `${failed} case(s) below threshold — see ${OUT}` : `all match — images in ${OUT}`);
process.exit(failed ? 1 : 0);
