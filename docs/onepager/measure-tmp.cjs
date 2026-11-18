const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(__dirname + '/einseiter.html').href);
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const out = [];
    for (const sec of document.querySelectorAll('section.cols')) {
      const cols = [...sec.children].map((c) => {
        const kids = [...c.children];
        const top = kids[0].getBoundingClientRect().top;
        const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        return Math.round(bottom - top);
      });
      out.push(cols.join(' / '));
    }
    const sheet = document.querySelector('.page');
    out.push('overflow ' + (sheet.scrollHeight - sheet.clientHeight));
    return out;
  });
  console.log(r.join('\n'));
  await browser.close();
})();
