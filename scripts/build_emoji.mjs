// Builds static/emoji/emoji.json: the emojis captions can use, as flat-colour
// vector shapes (from Twemoji, graphics CC-BY 4.0), so the preview, the browser
// export, libass (which can't draw colour emoji fonts) and After Effects all draw
// the same picture. Each shape's outline is reduced to absolute M, L, C and Z
// commands in a 36 × 36 box.
//   curl -sSL https://registry.npmjs.org/@twemoji/svg/-/svg-15.0.0.tgz | tar xz -C /tmp
//   node scripts/build_emoji.mjs /tmp/package
// A layer is [colour, path] or [colour, path, opacity].
// The keywords (English, Hinglish and Hindi) let the server pick an emoji when the
// AI isn't available.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SET = [
  ['🔥', 'fire', 'fire hot trending viral lit aag garam best sale'],
  ['💯', 'hundred', '100 hundred percent guaranteed perfect pakka sau'],
  ['✅', 'check', 'yes done right correct ok okay verified sahi haan ready confirmed complete'],
  ['❌', 'cross', 'no wrong mistake never cancel cancelled galat nahi mat stop'],
  ['⚠️', 'warning', 'warning careful caution risk problem alert dhyan khatra'],
  ['🚀', 'rocket', 'fast launch growth grow boost scale rocket rapid tez jaldi badhao'],
  ['📦', 'package', 'order orders package parcel box product shipment packaging dabba'],
  ['🚚', 'truck', 'delivery deliver deliveries shipping ship courier truck logistics transport dispatch delivered'],
  ['✈️', 'plane', 'air flight international export travel plane'],
  ['💰', 'money bag', 'money paisa paise profit revenue earn earning income cash kamai'],
  ['💸', 'money flying', 'spend spending cost costs expense loss waste kharcha'],
  ['💵', 'cash', 'cash cod rupees dollar payment pay'],
  ['🤑', 'money face', 'rich profit profits jackpot'],
  ['📈', 'chart up', 'growth increase sales up rise higher more badha conversion'],
  ['📉', 'chart down', 'drop decrease down fall lower less ghata kam rto return'],
  ['🎯', 'target', 'target goal aim focus exactly lakshya'],
  ['⭐', 'star', 'star rating review reviews quality'],
  ['🌟', 'glowing star', 'amazing special premium'],
  ['✨', 'sparkles', 'new magic beautiful shine clean easy simple aasaan'],
  ['🎉', 'party', 'congratulations celebrate celebration party launch badhai'],
  ['🥳', 'party face', 'birthday fun party'],
  ['👏', 'clap', 'clap applause well done shabash great job'],
  ['🙌', 'raised hands', 'finally hooray yay thank'],
  ['👍', 'thumbs up', 'good nice like great accha badhiya'],
  ['👎', 'thumbs down', 'bad dislike bura kharab'],
  ['👉', 'point right', 'link here check click swipe yahan dekho'],
  ['👆', 'point up', 'above upar tap'],
  ['👇', 'point down', 'below comment comments neeche bio'],
  ['👀', 'eyes', 'look see watch notice dekho dekhiye secret'],
  ['🤯', 'mind blown', 'mind blown shocking crazy unbelievable insane'],
  ['😱', 'shocked', 'shock shocked omg wow scary dar'],
  ['😂', 'laughing', 'funny lol haha joke hasi mazak'],
  ['😍', 'heart eyes', 'love loved beautiful gorgeous pyaar'],
  ['🤓', 'nerd', 'cool smart pro geek study'],
  ['🤔', 'thinking', 'think thinking why question confused socho kyun kya'],
  ['😅', 'sweat smile', 'oops awkward phew'],
  ['😭', 'crying', 'sad cry crying dukh'],
  ['😡', 'angry', 'angry frustrated annoying gussa'],
  ['🙏', 'pray', 'please thanks thank you dhanyavad shukriya request namaste'],
  ['💪', 'strong', 'strong power strength powerful mazboot hard work'],
  ['❤️', 'heart', 'heart love care dil pyaar customers'],
  ['💔', 'broken heart', 'heartbreak broken lost'],
  ['💡', 'idea', 'idea tip tips hack hacks trick learn insight smart'],
  ['🔑', 'key', 'key secret unlock important main'],
  ['🔒', 'lock', 'secure security safe protected privacy'],
  ['📱', 'phone', 'phone mobile app whatsapp call sms'],
  ['💻', 'laptop', 'laptop computer online website dashboard software'],
  ['🛒', 'cart', 'cart checkout shopping buy kharido abandoned'],
  ['🛍️', 'shopping bags', 'shopping shop store brand d2c ecommerce'],
  ['🏷️', 'tag', 'price pricing discount offer deal label daam'],
  ['🎁', 'gift', 'gift free bonus surprise offer tohfa'],
  ['⏰', 'alarm', 'time hurry deadline late early samay waqt'],
  ['⏳', 'hourglass', 'wait waiting soon later intezaar'],
  ['📅', 'calendar', 'date day days week month schedule calendar'],
  ['📍', 'pin', 'location address pincode place city'],
  ['🌍', 'globe', 'world global everywhere country countries'],
  ['🇮🇳', 'india', 'india indian bharat desh'],
  ['🏠', 'home', 'home house ghar doorstep'],
  ['🏪', 'store', 'shop store dukaan retail offline'],
  ['🏭', 'factory', 'warehouse factory manufacturing inventory godown'],
  ['🤝', 'handshake', 'partner partnership deal trust together saath'],
  ['📊', 'bar chart', 'data analytics report numbers stats insights'],
  ['📢', 'loudspeaker', 'announcement announce news update attention'],
  ['🔔', 'bell', 'notification notify subscribe reminder'],
  ['💬', 'speech', 'chat message reply feedback baat'],
  ['👋', 'wave', 'hello hi bye welcome namaskar'],
  ['💥', 'boom', 'boom impact explode bang'],
  ['⚡', 'lightning', 'instant quick quickly speed energy power fast'],
  ['💳', 'card', 'card prepaid online payment upi'],
  ['🧾', 'receipt', 'invoice bill receipt gst tax'],
  ['📝', 'memo', 'note notes write list form'],
  ['📸', 'camera', 'photo photos picture camera'],
  ['🎬', 'clapper', 'video videos reel reels shoot content'],
  ['🎵', 'music', 'music song sound gaana'],
  ['☕', 'coffee', 'coffee chai morning break'],
  ['🏆', 'trophy', 'win winner winning champion award best number'],
  ['🥇', 'gold medal', 'first top rank'],
  ['🔄', 'refresh', 'return returns exchange repeat again refund wapas'],
  ['🆕', 'new', 'new latest naya feature'],
  ['🆓', 'free', 'free muft'],
  ['💎', 'gem', 'premium luxury valuable gem'],
  ['👑', 'crown', 'king queen best leader'],
  ['🧠', 'brain', 'brain smart ai intelligence learn dimag'],
  ['❓', 'question', 'question doubt faq'],
  ['❗', 'exclamation', 'important must attention zaroori'],
  ['🤫', 'shush', 'secret quiet hidden'],
  ['🤩', 'star struck', 'excited exciting amazing awesome wow kamaal'],
  ['😴', 'sleeping', 'sleep boring tired slow'],
  ['🤷', 'shrug', 'whatever maybe dunno pata'],
  ['🔍', 'search', 'search find track tracking look'],
  ['🛠️', 'tools', 'fix build setup tool tools'],
  ['⚙️', 'gear', 'settings automation automate process system'],
  ['🌱', 'seedling', 'start begin small grow organic'],
  ['☀️', 'sun', 'sun summer day sunny'],
  ['🌙', 'moon', 'night raat'],
  ['🐢', 'turtle', 'slow delay delayed late'],
  ['📞', 'telephone', 'call calls support helpline contact'],
  ['📬', 'mailbox', 'mail email inbox'],
  ['🎊', 'confetti', 'festival festive diwali sale'],
  ['🪔', 'diya', 'diwali festival deepavali'],
  ['⬆️', 'arrow up', 'up upgrade increase'],
  ['⬇️', 'arrow down', 'down reduce downgrade'],
  ['➡️', 'arrow right', 'next then step'],
  ['💼', 'briefcase', 'business work office job kaam'],
  ['🧑‍💻', 'technologist', 'developer coding tech team'],
  ['🛵', 'scooter', 'rider last mile quick commerce'],
  ['🌈', 'rainbow', 'colors colour happy'],
  ['🍕', 'pizza', 'food pizza khana'],
  ['🎂', 'cake', 'birthday cake'],
  ['😇', 'angel', 'honest innocent'],
  ['🥵', 'hot face', 'heat hot tough'],
  ['🫶', 'heart hands', 'love support community'],
  ['🙋', 'raising hand', 'me ask question volunteer'],
];

const codepoints = (ch) => [...ch].map((c) => c.codePointAt(0).toString(16));
function fileFor(dir, ch) {
  const cps = codepoints(ch);
  for (const name of [cps.join('-'), cps.filter((c) => c !== 'fe0f').join('-')]) {
    try { return readFileSync(join(dir, `${name}.svg`), 'utf8'); } catch { /* try the next spelling */ }
  }
  throw new Error(`no Twemoji file for ${ch} (${cps.join('-')})`);
}

// ---------------------------------------------------------------- SVG paths → M L C Z

function tokens(d) {
  return d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
}

// An elliptical arc as cubic beziers (SVG implementation notes, F.6).
function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const rad = (phi * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9);
  const out = [];
  const step = dth / n, t = (4 / 3) * Math.tan(step / 4);
  const pt = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const dpt = (a) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  for (let i = 0; i < n; i++) {
    const a1 = th1 + i * step, a2 = a1 + step;
    const p1 = pt(a1), p2 = pt(a2), d1 = dpt(a1), d2 = dpt(a2);
    out.push([p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], i === n - 1 ? x2 : p2[0], i === n - 1 ? y2 : p2[1]]);
  }
  return out;
}

export function normalizePath(d) {
  const tk = tokens(d);
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null; // last cubic/quad control
  const num = () => { const v = Number(tk[i++]); if (!Number.isFinite(v)) throw new Error(`bad path near ${tk.slice(i - 3, i + 2).join(' ')}`); return v; };
  const flag = () => {
    // arc flags may be written without separators ("011")
    const t = tk[i];
    if (t.length > 1 && /^[01]/.test(t)) { tk[i] = t.slice(1); return Number(t[0]); }
    i++; return Number(t);
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => { out.push(['C', x1, y1, x2, y2, x3, y3]); lc = [x2, y2]; lq = null; x = x3; y = y3; };
  while (i < tk.length) {
    if (/[a-zA-Z]/.test(tk[i])) cmd = tk[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') {
      x = num() + ox; y = num() + oy; sx = x; sy = y;
      out.push(['M', x, y]); lc = lq = null;
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') { x = num() + ox; y = num() + oy; out.push(['L', x, y]); lc = lq = null; }
    else if (C === 'H') { x = num() + ox; out.push(['L', x, y]); lc = lq = null; }
    else if (C === 'V') { y = num() + oy; out.push(['L', x, y]); lc = lq = null; }
    else if (C === 'C') { const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy]; cubic(...a); }
    else if (C === 'S') {
      const r = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y];
      const a = [num() + ox, num() + oy, num() + ox, num() + oy]; cubic(r[0], r[1], ...a);
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = num() + ox; qy = num() + oy; } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; }
      const ex = num() + ox, ey = num() + oy;
      const x0 = x, y0 = y;
      cubic(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey);
      lq = [qx, qy]; lc = null;
    } else if (C === 'A') {
      const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag(), ex = num() + ox, ey = num() + oy;
      for (const c of arcToCubics(x, y, rx, ry, phi, fa, fs, ex, ey)) cubic(...c);
      lc = null;
    } else if (C === 'Z') { out.push(['Z']); x = sx; y = sy; lc = lq = null; }
    else throw new Error(`unsupported path command ${cmd}`);
  }
  return out;
}

const K = 0.5522847498;
function ellipsePath(cx, cy, rx, ry) {
  const kx = rx * K, ky = ry * K;
  return [['M', cx + rx, cy], ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ['Z']];
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// transform="..." as a matrix [a b c d e f]
function matrix(t) {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (n) => { m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; };
  for (const [, fn, args] of (t || '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = tokens(args).map(Number);
    if (fn === 'matrix') mul(v);
    else if (fn === 'translate') mul([1, 0, 0, 1, v[0], v[1] || 0]);
    else if (fn === 'scale') mul([v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'rotate') {
      const a = (v[0] * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), cx = v[1] || 0, cy = v[2] || 0;
      mul([1, 0, 0, 1, cx, cy]); mul([c, sn, -sn, c, 0, 0]); mul([1, 0, 0, 1, -cx, -cy]);
    } else throw new Error(`transform ${fn}`);
  }
  return m;
}
const applyMatrix = (p, m) => p.map(([c, ...v]) => {
  const o = [c];
  for (let k = 0; k < v.length; k += 2) o.push(m[0] * v[k] + m[2] * v[k + 1] + m[4], m[1] * v[k] + m[3] * v[k + 1] + m[5]);
  return o;
});

function shapes(svg) {
  if (/<(linearGradient|radialGradient|mask|clipPath|use|image|text)\b/.test(svg)) throw new Error('uses gradients, masks or references');
  const out = [];
  const groups = [];
  for (const m of svg.matchAll(/<(\/?)(g|path|circle|ellipse|rect|polygon|polyline)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, rest, self] = m;
    if (name === 'g') {
      if (close) groups.pop(); else if (!self) groups.push(attrs(rest));
      continue;
    }
    const a = { ...Object.assign({}, ...groups), ...attrs(rest) };
    if (a.stroke || a['fill-rule'] === 'evenodd' || a['clip-rule'] || groups.some((g) => g.transform)) {
      throw new Error(`${name} uses a stroke, even-odd fill or a group transform`);
    }
    const alpha = (a.opacity ? +a.opacity : 1) * (a['fill-opacity'] ? +a['fill-opacity'] : 1);
    if (a.fill === 'none') continue;
    let p;
    if (name === 'path') p = normalizePath(a.d);
    else if (name === 'circle') p = ellipsePath(+a.cx || 0, +a.cy || 0, +a.r, +a.r);
    else if (name === 'ellipse') p = ellipsePath(+a.cx || 0, +a.cy || 0, +a.rx, +a.ry);
    else if (name === 'rect') {
      if (a.rx || a.ry) throw new Error('rounded rect');
      const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height;
      p = [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
    } else {
      const v = tokens(a.points).map(Number);
      p = [['M', v[0], v[1]]];
      for (let k = 2; k + 1 < v.length; k += 2) p.push(['L', v[k], v[k + 1]]);
      if (name === 'polygon') p.push(['Z']);
    }
    if (a.transform) p = applyMatrix(p, matrix(a.transform));
    out.push({ c: expand(a.fill || '#000000'), a: alpha, p });
  }
  return out;
}

const expand = (c) => (/^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c).toUpperCase();
const r2 = (v) => Math.round(v * 100) / 100;
const pathString = (p) => p.map(([c, ...v]) => c + v.map(r2).join(' ')).join('');

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build_emoji.mjs <twemoji svg folder>'); process.exit(1); }
const out = {};
let bad = 0;
for (const [ch, name, words] of SET) {
  try {
    const layers = shapes(fileFor(dir, ch));
    out[ch] = { name, keywords: [...new Set(words.split(/\s+/).filter(Boolean))], layers: layers.map((l) => (l.a < 1 ? [l.c, pathString(l.p), r2(l.a)] : [l.c, pathString(l.p)])) };
  } catch (e) { bad++; console.error(`skipped ${ch} ${name}: ${e.message}`); }
}
const root = new URL('../static/emoji/', import.meta.url).pathname;
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'emoji.json'), JSON.stringify(out));
console.log(`${Object.keys(out).length} emojis written, ${bad} skipped`);
