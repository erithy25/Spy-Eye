#!/usr/bin/env node
/**
 * Gang durch die Konsole nur mit der Tastatur: anmelden, Mandat wählen, Reiter wechseln, Zeilen
 * wählen, suchen, ein Trefferblatt öffnen und schließen. Keine Maus.
 *
 *   node tools/barrierefreiheit/tastatur.cjs
 *
 * Voraussetzungen: die Vorführung läuft (pnpm demo) im vorbereiteten Ausgangsstand; Playwright
 * mit Chromium. Der Befehl endet mit Fehler, wenn ein Schritt nicht ohne Maus gelingt oder der
 * Fokus dabei nicht sichtbar ist.
 */
const { chromium } = require('playwright');
const base = process.env.BASE || 'http://127.0.0.1:8787';
const steps = [];
const note = (name, ok, detail = '') => { steps.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

/** Presses Tab until the focused element matches; returns a description of it or null. */
async function tabTo(page, test, limit = 60) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((source) => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const match = new Function('el', `return (${source})(el)`)(el);
      if (!match) return null;
      const style = getComputedStyle(el);
      return { tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 60), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 };
    }, test.toString());
    if (hit) return { ...hit, presses: i + 1 };
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.waitForSelector('tr.clickable', { timeout: 30000 });
  await page.waitForTimeout(500);

  let hit = await tabTo(page, (el) => el.matches('tr.clickable') && /leitung/.test(el.innerText));
  note('Zugang »leitung« mit Tab erreichbar, Fokus sichtbar', !!hit && hit.outline, hit ? `${hit.presses} Tastendrücke` : '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const filled = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).filter(Boolean).length);
  note('Eingabetaste übernimmt Zugang und Passwort', filled >= 2, `${filled} Felder gefüllt`);
  hit = await tabTo(page, (el) => el.matches('button[type=submit]'));
  note('»Anmelden« erreichbar', !!hit && hit.outline);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.gate .incident, .shell', { timeout: 30000 });
  await page.waitForTimeout(600);
  if (await page.locator('.gate .incident').count()) {
    hit = await tabTo(page, (el) => el.matches('button.incident') && /RHEIN-MOSEL/.test(el.innerText));
    note('Mandat mit Tab erreichbar', !!hit && hit.outline, hit ? hit.text : '');
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('.shell', { timeout: 30000 });
  await page.waitForTimeout(1200);
  note('Angemeldet ohne Maus', await page.locator('.shell').count() === 1);

  // Die Übung liefert das Material, in dem später gesucht wird.
  hit = await tabTo(page, (el) => el.matches('.control .segment') && /8×/.test(el.innerText), 200);
  note('Geschwindigkeit der Übung erreichbar', !!hit && hit.outline);
  await page.keyboard.press('Enter');
  hit = await tabTo(page, (el) => el.matches('button') && /übung starten/iu.test(el.innerText), 200);
  note('»Übung starten« erreichbar', !!hit && hit.outline);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60000);
  note('Übung läuft, Meldungen sind da', (await page.locator('.alert').count()) > 0, `${await page.locator('.alert').count()} Meldungen`);
  hit = await tabTo(page, (el) => el.matches('li.incident'), 200);
  note('Lage in der Liste erreichbar', !!hit && hit.outline, hit ? hit.text : '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  note('Eingabetaste wählt die Lage', (await page.locator('li.incident[aria-current="true"]').count()) === 1);

  hit = await tabTo(page, (el) => el.matches('.tab') && /^WACHEN/i.test(el.innerText.trim()));
  note('Reiter WACHEN erreichbar', !!hit && hit.outline);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  hit = await tabTo(page, (el) => el.matches('tr.clickable') && /Brand/.test(el.innerText));
  note('Zeile »Brand« erreichbar', !!hit && hit.outline, hit ? `${hit.presses} Tastendrücke` : '');
  await page.keyboard.press(' ');
  await page.waitForTimeout(600);
  const selected = await page.evaluate(() => document.querySelector('tr.clickable[aria-current="true"]')?.innerText.replace(/\s+/g, ' ').slice(0, 40) ?? null);
  note('Leertaste wählt die Zeile', !!selected && /Brand/.test(selected), selected ?? '');

  await page.keyboard.press('Shift+Tab');
  hit = await tabTo(page, (el) => el.matches('.tab') && /^PROTOKOLL/i.test(el.innerText.trim()), 200);
  if (!hit) { await page.locator('body').press('Home'); hit = await tabTo(page, (el) => el.matches('.tab') && /^PROTOKOLL/i.test(el.innerText.trim()), 200); }
  note('Reiter PROTOKOLL erreichbar', !!hit);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  hit = await tabTo(page, (el) => el.matches('tr.clickable'));
  note('Protokollzeile erreichbar', !!hit && hit.outline);
  const before = await page.locator('tr').count();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = await page.locator('tr').count();
  note('Eingabetaste klappt den Eintrag auf', after > before, `${before} → ${after} Zeilen`);

  hit = await tabTo(page, (el) => el.matches('.tab') && /^SUCHE/i.test(el.innerText.trim()), 400);
  note('Reiter SUCHE erreichbar', !!hit);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  hit = await tabTo(page, (el) => el.matches('.query input'));
  note('Suchfeld erreichbar', !!hit);
  await page.keyboard.type('Rauch über Gebäuden');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hit', { timeout: 20000 }).catch(() => {});
  hit = await tabTo(page, (el) => el.matches('.hit'));
  note('Treffer erreichbar', !!hit, hit ? hit.tag : '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  note('Eingabetaste öffnet das Trefferblatt', await page.locator('.sheet[role=dialog]').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  note('Escape schließt es', await page.locator('.sheet[role=dialog]').count() === 0);

  await browser.close();
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length} von ${steps.length} Schritten ohne Maus`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
