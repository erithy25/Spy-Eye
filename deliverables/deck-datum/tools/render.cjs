// Draws the deck from its local files, without network and without scripts in the page.
//
//   NODE_PATH= NODE_OPTIONS= NODE_DISABLE_COMPILE_CACHE=1 node deliverables/deck-datum/tools/render.cjs \
//       --shots <folder for one PNG per slide> --pdf deliverables/DATUM-Praesentation.pdf
//
// A copy of deliverables/deck/tools/render.cjs (the Sicht deck); the DATUM deck has one edition
// (project -> blobs.json).
//
// The page is what the Slides type describes for a preview: its base rules, the deck's CSS and
// each slide's <section> in order. Two additions make the result usable as a hand-out: the
// typeface is loaded from the font files of the console, and the uploaded pictures are taken
// from the repository (tools/blobs.json). A browser preview approximates the Slides viewer;
// line breaks can differ a little. --loose lets hyphens break as a plain browser would,
// --tight lists lines that nearly fill their box, --stress <px> draws every letter that much
// wider: a slide that still ends inside its limit then has room for a viewer that measures
// text a little differently (0.25 is about 1.5 % at the size of running text).
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const repo = path.resolve(__dirname, '..', '..', '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
// One folder per language edition, beside this one: project (German), project-en (English).
const edition = /^project(-[a-z]{2})?$/.exec(arg('--project') || 'project');
if (!edition) throw new Error('--project takes the name of an edition folder: project or project-en');
const project = path.resolve(__dirname, '..', edition[0]);
const lang = edition[1] ? edition[1].slice(1) : 'de';
const fonts = path.join(repo, 'apps', 'web', 'public', 'fonts');
const blobs = JSON.parse(fs.readFileSync(path.join(__dirname, `blobs${edition[1] || ''}.json`), 'utf8'));
const shotsDir = arg('--shots');
const pdfFile = arg('--pdf');
const stress = Number(arg('--stress') || 0);
if (!Number.isFinite(stress) || stress < 0) throw new Error('--stress takes a width in pixels, for example 0.25');
if (stress && pdfFile) throw new Error('--stress is for checking the layout, not for the hand-out: leave out --pdf');

const base = `
* { margin: 0 }
body { font: 32px/1.2 sans-serif }
body > section { width: 1920px !important; height: 1080px !important; overflow: hidden !important; box-sizing: border-box !important; position: relative; isolation: isolate }
section[hidden], aside, noscript { display: none !important }
h1 { font-size: 96px; font-weight: 600 }
h2 { font-size: 64px; font-weight: 600 }
h3 { font-size: 44px; font-weight: 600 }
p, li, h1, h2, h3, td, th { overflow-wrap: break-word; text-wrap: pretty }
table { width: 100%; border-collapse: separate; border-spacing: 0; border: solid #0003; border-width: 2px 0 0 2px }
th, td { padding: .35em .6em; text-align: left; border: solid #0003; border-width: 0 2px 2px 0 }
x-shape, x-icon, x-embed { display: block }
x-embed { background: #8884 !important }
`;
const faces = [['Regular', 400], ['Medium', 500], ['Bold', 700]]
  .map(([file, weight]) => `@font-face { font-family: 'JetBrains Mono'; font-weight: ${weight}; src: url(/fonts/JetBrainsMono-${file}.woff2) format('woff2') }`)
  .join('\n');
const print = '@page { size: 1920px 1080px; margin: 0 } html, body { background: #050505 } body > section { break-after: page; break-inside: avoid }';

const index = JSON.parse(fs.readFileSync(path.join(project, 'deck.json'), 'utf8'));
const sections = index.order.map((id) => fs.readFileSync(path.join(project, 'slides', `${id}.html`), 'utf8'));
const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${index.title}</title><style>${base}</style>`
  + `<link rel="stylesheet" href="/project/deck.css"><style>${faces}\n${print}</style></head><body>${sections.join('\n')}</body></html>`;

const types = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const inside = (root, file) => path.resolve(file).startsWith(path.resolve(root) + path.sep);

(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ^NOTFOUND'] });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  let opened = false;
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest()) {
      if (opened || url.pathname !== '/') return route.abort('aborted');
      opened = true;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    let file;
    if (url.pathname.startsWith('/project/')) {
      file = path.join(project, url.pathname.slice('/project/'.length));
      if (!inside(project, file)) return route.abort('aborted');
    } else if (url.pathname.startsWith('/fonts/')) {
      file = path.join(fonts, path.basename(url.pathname));
    } else if (url.pathname.startsWith('/_blob/') && blobs[path.basename(url.pathname)]) {
      file = path.join(repo, blobs[path.basename(url.pathname)]);
    }
    if (!file || !fs.existsSync(file)) return route.abort('aborted');
    return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto('http://deck.invalid/');
  await page.evaluate(async ({ keepHyphens, widen }) => {
    for (const fragment of document.querySelectorAll('.fragment')) fragment.classList.add('visible');
    if (widen) {
      // Read every spacing before one is changed: the value is inherited.
      const texts = [...document.querySelectorAll('body > section *')]
        .filter((el) => !el.closest('aside') && [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()))
        .map((el) => [el, parseFloat(getComputedStyle(el).letterSpacing) || 0]);
      for (const [el, spacing] of texts) el.style.letterSpacing = `${spacing + widen}px`;
    }
    // Slides breaks lines at spaces only. A browser also breaks after a hyphen, so hyphens inside
    // words are drawn as non-breaking ones here; the typeface has the glyph.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (keepHyphens && !node.parentElement.closest('aside')) node.nodeValue = node.nodeValue.replace(/(?<=\S)-(?=\S)/g, '\u2011');
    }
    for (const section of document.querySelectorAll('body > section')) {
      for (const child of section.children) {
        const style = getComputedStyle(child);
        if (style.position !== 'absolute') break;
        child.style.zIndex = '-1';
      }
    }
    for (const box of document.querySelectorAll('section, div')) {
      const style = getComputedStyle(box);
      if (style.display !== 'flex' || !style.flexDirection.startsWith('column')) continue;
      for (const child of box.children) if (parseFloat(getComputedStyle(child).flexGrow) > 0) child.style.minHeight = '0';
    }
    await document.fonts.ready;
  }, { keepHyphens: !process.argv.includes('--loose'), widen: stress });
  await page.waitForLoadState('networkidle');

  // What a reader of the pictures cannot measure by eye: where the content of each slide ends,
  // what leaves the margins, which one-line elements wrapped and whether the typeface loaded.
  const report = await page.evaluate(() => {
    const out = [];
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`);
    out.push(`faces loaded: ${loaded.join(', ') || 'none'}`);
    for (const section of document.querySelectorAll('body > section')) {
      const frame = section.getBoundingClientRect();
      const notes = [];
      let bottom = 0;
      let right = 0;
      for (const el of section.querySelectorAll('p, h1, h2, h3, img')) {
        if (el.closest('.foot') || el.closest('aside')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        bottom = Math.max(bottom, r.bottom - frame.top);
        right = Math.max(right, r.right - frame.left);
        if (el.scrollWidth > el.clientWidth + 1) notes.push(`wider than its box: ${el.className}`);
        const one = ['title', 'cap', 'label', 'pt-k', 'cell-k', 'num', 'num-k', 'val', 'fig', 'mark'].some((c) => el.classList.contains(c));
        const cs = getComputedStyle(el);
        const lines = Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight));
        if (one && lines > 1) notes.push(`${lines} lines: ${el.className}`);
        if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth > 0)) notes.push('picture missing');
        if (el.classList.contains('src') && lines > 1) notes.push(`source on ${lines} lines`);
      }
      const spare = [...section.children].filter((c) => c.classList.contains('grow')).reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
      notes.unshift(`spare ${Math.round(spare)}`);
      const limit = section.querySelector('.foot') ? 920 : 952;
      out.push(`${section.id.padEnd(11)} ends ${Math.round(bottom).toString().padStart(4)} of ${limit}, right ${Math.round(right)}${bottom > limit + 0.5 ? '  OVER' : ''}${right > 1792.5 ? '  WIDE' : ''}${notes.length ? '  ' + notes.join('; ') : ''}`);
    }
    return out;
  });
  console.log(report.join('\n'));

  // Lines that nearly fill their box: a small difference in text measurement would wrap them.
  if (process.argv.includes('--tight')) {
    const tight = await page.evaluate(() => {
      const out = [];
      for (const section of document.querySelectorAll('body > section')) {
        for (const el of section.querySelectorAll('p, h1, h2, h3')) {
          if (el.closest('aside')) continue;
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const room = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const range = document.createRange();
          range.selectNodeContents(el);
          const rows = new Map();
          for (const rect of range.getClientRects()) {
            const key = Math.round(rect.top);
            const row = rows.get(key) || { left: rect.left, right: rect.right };
            row.left = Math.min(row.left, rect.left);
            row.right = Math.max(row.right, rect.right);
            rows.set(key, row);
          }
          const spacing = parseFloat(cs.letterSpacing) || 0;
          const step = parseFloat(cs.fontSize) * 0.6 + spacing;
          for (const row of rows.values()) {
            const width = row.right - row.left - Math.max(spacing, 0);
            const free = room - width;
            if (free < step * 1.5) out.push(`${section.id}: ${el.className || el.tagName} has ${free.toFixed(1)}px free (${(free / step).toFixed(1)} characters)`);
          }
        }
      }
      return out;
    });
    console.log(tight.join('\n') || 'no tight lines');
  }

  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    const all = await page.$$('body > section');
    for (let i = 0; i < all.length; i += 1) {
      await all[i].scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await all[i].screenshot({ path: path.join(shotsDir, `${String(i + 1).padStart(2, '0')}-${index.order[i]}.png`), animations: 'disabled' });
    }
  }
  if (pdfFile) {
    await page.emulateMedia({ media: 'screen' });
    await page.pdf({ path: pdfFile, width: '1920px', height: '1080px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
  }
  await browser.close();
})();
