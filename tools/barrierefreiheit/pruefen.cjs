#!/usr/bin/env node
/**
 * Automatische Prüfung der Konsole und der Website auf Barrierefreiheit mit axe-core,
 * Regeln der WCAG 2.1 Stufe A und AA (die Grundlage von EN 301 549 und BITV 2.0).
 *
 *   node tools/barrierefreiheit/pruefen.cjs console          Konsole: 15 Zustände, angemeldet als Leitung
 *   node tools/barrierefreiheit/pruefen.cjs site             Website: deutsch und englisch, breit und schmal
 *   node tools/barrierefreiheit/pruefen.cjs all --json aus.json
 *
 * Voraussetzungen: die Vorführung läuft (pnpm demo) im vorbereiteten Ausgangsstand; für die
 * Website ein Dateiserver auf dem Ordner site (SITE, Voreinstellung http://127.0.0.1:8090);
 * Playwright mit Chromium; axe-core. axe-core gehört nicht zu den Paketen von Sicht:
 *
 *   npm install --no-save --prefix <irgendein Ordner> axe-core
 *   AXE_CORE=<dieser Ordner>/node_modules/axe-core/axe.min.js node tools/barrierefreiheit/pruefen.cjs all
 *
 * Der Befehl endet mit Fehler, wenn eine Regel verletzt ist. Was er nicht sieht, steht in
 * docs/BARRIEREFREIHEIT.md: Eine automatische Prüfung findet nur einen Teil der Barrieren.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function findAxe() {
  if (process.env.AXE_CORE) return process.env.AXE_CORE;
  try {
    return require.resolve('axe-core/axe.min.js');
  } catch {
    console.error('axe-core wurde nicht gefunden. Einrichten und den Pfad in AXE_CORE nennen; die Schritte stehen am Kopf dieser Datei.');
    process.exit(2);
  }
}
const axePath = findAxe();
const base = process.env.BASE || 'http://127.0.0.1:8787';
const site = process.env.SITE || 'http://127.0.0.1:8090';
const what = process.argv[2] || 'all';
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : null;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const results = [];

async function check(page, name) {
  await page.addScriptTag({ path: axePath });
  const report = await page.evaluate(async (tags) => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const pack = (list) => list.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), why: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 260) })),
    }));
    return { violations: pack(r.violations), incomplete: pack(r.incomplete), passes: r.passes.length };
  }, TAGS);
  results.push({ name, ...report });
  const total = report.violations.reduce((sum, v) => sum + v.count, 0);
  console.log(`\n== ${name}: ${report.violations.length} Regeln verletzt, ${total} Elemente; ${report.incomplete.length} Regeln von Hand zu prüfen; ${report.passes} Regeln bestanden`);
  for (const v of report.violations) {
    console.log(`  [${v.impact}] ${v.id} x${v.count}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target}\n        ${n.why}`);
  }
  for (const v of report.incomplete) console.log(`  (von Hand) ${v.id} x${v.count}`);
}

async function login(page, user) {
  await page.goto(base + '/');
  await page.waitForSelector('tr.clickable, .login-user, button', { timeout: 30000 });
  await page.waitForTimeout(600);
}
const tab = async (page, name) => { await page.locator('.tab', { hasText: new RegExp('^' + name, 'i') }).first().click(); await page.waitForTimeout(1300); };

async function consoleWalk(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', bypassCSP: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await login(page);
  await check(page, 'Konsole · Anmeldung');
  const row = page.locator('[data-user="leitung"], tr.clickable', { hasText: 'leitung' }).first();
  await row.click();
  await page.waitForTimeout(400);
  await check(page, 'Konsole · Anmeldung mit Passwortfeld');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForSelector('.gate .incident, .shell', { timeout: 30000 });
  if (await page.locator('.gate').count()) {
    await check(page, 'Konsole · Mandat wählen');
    await page.locator('.gate .incident', { hasText: 'RHEIN-MOSEL' }).first().click();
  }
  await page.waitForSelector('.shell', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const end = page.getByRole('button', { name: 'Ende', exact: true });
  if (await end.count()) { await end.click(); await page.waitForTimeout(1200); }
  await page.locator('.control .segment', { hasText: '8×' }).first().click();
  await page.getByRole('button', { name: /Start|Übung starten/ }).first().click().catch(() => {});
  await page.waitForTimeout(42000);
  await check(page, 'Konsole · LAGE mit Meldungen');
  await tab(page, 'SUCHE');
  await check(page, 'Konsole · SUCHE leer');
  await page.locator('.query input').fill('Überflutete Wiese');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hit', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await check(page, 'Konsole · SUCHE mit Treffern');
  await page.locator('.hit').first().click();
  await page.waitForTimeout(1500);
  await check(page, 'Konsole · Trefferblatt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('.query input').fill('Mann mit roter Jacke im Gesicht erkennen');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await check(page, 'Konsole · SUCHE Ablehnung');
  for (const name of ['WACHEN', 'VORGÄNGE', 'VERBUND', 'PROTOKOLL', 'QUELLEN', 'WIRKUNG']) {
    await tab(page, name);
    await check(page, 'Konsole · ' + name);
  }
  await tab(page, 'LAGE');
  await page.locator('.lang button, button', { hasText: /^EN$/ }).first().click();
  await page.waitForTimeout(1200);
  await check(page, 'Konsole · LAGE englisch');
  await page.locator('.lang button, button', { hasText: /^DE$/ }).first().click();
  await ctx.close();
}

async function siteWalk(browser) {
  for (const [w, h, label] of [[1440, 900, 'breit'], [390, 844, 'schmal']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'de-DE', reducedMotion: 'reduce', bypassCSP: true });
    const page = await ctx.newPage();
    await page.goto(site + '/index.html');
    await page.waitForTimeout(2500);
    // let every lazily revealed section show itself
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(800);
    await check(page, `Website · deutsch · ${label}`);
    if (label === 'breit') {
      const en = page.locator('[data-lang="en"], button', { hasText: /^EN$/ }).first();
      if (await en.count()) { await en.click(); await page.waitForTimeout(800); await check(page, 'Website · englisch · breit'); }
    }
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (what === 'console' || what === 'all') await consoleWalk(browser);
    if (what === 'site' || what === 'all') await siteWalk(browser);
  } finally {
    await browser.close();
  }
  const rules = new Map();
  for (const r of results) for (const v of r.violations) rules.set(v.id, (rules.get(v.id) || 0) + v.count);
  console.log(`\n== ${results.length} Zustände geprüft. Verletzte Regeln: ${rules.size === 0 ? 'keine' : JSON.stringify(Object.fromEntries(rules))}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  process.exit(rules.size === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
