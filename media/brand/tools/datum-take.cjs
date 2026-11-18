// Records the DATUM console walk-through for the product film: one continuous take against the
// running node (pnpm datum), cut points written to media/product/datum-marks.json in seconds
// from the start of the recording.
//
//   node media/brand/tools/datum-take.cjs
//   ffmpeg -i media/product/raw-datum/<file>.webm -r 25 -c:v libx264 -crf 16 -pix_fmt yuv420p media/product/datum-take.mp4
//
// WebGL runs in software in a headless browser (SwiftShader), so the 3D views move at a lower
// frame rate than on a desktop with a graphics card.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const out = path.join(repo, 'media', 'product');
const base = process.env.BASE || 'http://127.0.0.1:8787';
const W = 1920;
const H = 1080;
const ZOOM = 4 / 3;
const marks = [];
let t0 = 0;
const mark = (name) => {
  marks.push({ name, t: Math.round((Date.now() - t0) / 100) / 10 });
  console.log(marks[marks.length - 1]);
};

(async () => {
  fs.mkdirSync(path.join(out, 'raw-datum'), { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    locale: 'de-DE',
    recordVideo: { dir: path.join(out, 'raw-datum'), size: { width: W, height: H } },
  });
  await ctx.addInitScript((zoom) => {
    window.addEventListener('DOMContentLoaded', () => {
      // Like a browser zoom of 133 %: the console is laid out for 1440 x 810 and fills 1920 x 1080.
      const style = document.createElement('style');
      style.textContent = `html{zoom:${zoom}} .gate{min-height:${1080 / zoom}px!important} .shell{height:${1080 / zoom}px!important}`;
      document.head.appendChild(style);
      // A visible pointer: recordings do not contain the system cursor.
      const dot = document.createElement('div');
      dot.style.cssText =
        'position:fixed;z-index:99999;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border:1.5px solid #ededed;border-radius:50%;pointer-events:none;mix-blend-mode:difference;transition:transform .08s;left:-50px;top:-50px';
      document.body.appendChild(dot);
      window.addEventListener('mousemove', (e) => { dot.style.left = e.clientX / zoom + 'px'; dot.style.top = e.clientY / zoom + 'px'; }, true);
      window.addEventListener('mousedown', () => { dot.style.transform = 'scale(0.6)'; }, true);
      window.addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
    });
  }, ZOOM);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t0 = Date.now();
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (locator, opts = {}) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('not visible: ' + locator);
    const x = box.x + box.width * (opts.fx ?? 0.5);
    const y = box.y + box.height * (opts.fy ?? 0.5);
    await page.mouse.move(x, y, { steps: opts.steps ?? 26 });
    await wait(opts.hold ?? 220);
    if (opts.click !== false) await page.mouse.click(x, y);
  };
  const drag = async (fromX, fromY, toX, toY, steps = 40) => {
    await page.mouse.move(fromX, fromY, { steps: 12 });
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps });
    await page.mouse.up();
  };
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    await wait(ms);
    await page.keyboard.up(key);
  };

  // ---- 1 sign in with a mandate
  await page.goto(base + '/');
  await page.waitForSelector('tr.clickable');
  await wait(1800);
  mark('login');
  await go(page.locator('tr.clickable', { hasText: 'leitung' }).first());
  await wait(400);
  await go(page.getByRole('button', { name: 'Anmelden' }));
  await page.waitForSelector('.gate .incident, .shell');
  await wait(800);
  const gate = page.locator('.gate .incident', { hasText: 'Erprobung' });
  if (await gate.count()) await go(gate.first(), { fx: 0.3 });
  await page.waitForSelector('.dt-row');
  await wait(600);

  // ---- 2 the world: every recording of the dataset located
  mark('welt');
  await wait(4200);

  // ---- 3 one recording: fly to it, clock, sun and shadow, terrain outline
  mark('turm');
  await go(page.locator('.dt-row', { hasText: 'Berliner Fernsehturm' }).first(), { fx: 0.35 });
  await wait(6500);

  // ---- 4 the finding with its evidence and the analysis sequence
  mark('befund');
  await go(page.locator('.tab', { hasText: /^Befund/i }));
  await wait(5200);

  // ---- 5 into the space built from one frame
  mark('raum');
  await go(page.locator('.tab', { hasText: /^Raum/i }));
  await wait(3800);
  const canvas = page.locator('canvas').first();
  const cb = await canvas.boundingBox();
  const cx = cb.x + cb.width / 2;
  const cy = cb.y + cb.height / 2;
  await page.mouse.move(cx, cy, { steps: 12 });
  await page.mouse.click(cx, cy);
  mark('gehen');
  // Small turns only: beyond the frame's field of view the camera saw nothing. Sideways steps
  // show the depth (near things move against far ones).
  await hold('w', 1600);
  await drag(cx, cy, cx - 90, cy, 40);
  await hold('d', 1400);
  await drag(cx, cy, cx + 160, cy + 10, 40);
  await hold('a', 1000);
  await hold('s', 800);
  await wait(1200);

  // ---- 6 mountains: the horizon gives the viewing direction
  mark('glen');
  await page.keyboard.press('Escape');
  await go(page.locator('.tab', { hasText: /^Ortung/i }));
  await wait(900);
  await go(page.locator('.dt-row', { hasText: 'Glenfinnan' }).first(), { fx: 0.35 });
  await wait(6500);

  // ---- 7 the terrain around the fix in 3D with the sun path
  mark('gelaende');
  await go(page.locator('.tab', { hasText: /^Raum/i }));
  await wait(1500);
  await go(page.getByRole('button', { name: /^Gelände$/ }));
  await wait(4500);
  const tb = await page.locator('canvas').first().boundingBox();
  const tx = tb.x + tb.width / 2;
  const ty = tb.y + tb.height / 2;
  await drag(tx + 150, ty, tx - 250, ty - 30, 70);
  await wait(2500);

  // ---- 8 measured against the ground truth
  mark('messung');
  await go(page.locator('.tab', { hasText: /^Messung/i }));
  await wait(5000);
  mark('ende');

  const video = page.video();
  await ctx.close();
  await browser.close();
  const file = video ? await video.path() : null;
  fs.writeFileSync(path.join(out, 'datum-marks.json'), JSON.stringify({ file, marks }, null, 1));
  console.log('video', file, 'errors', JSON.stringify(errors));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
