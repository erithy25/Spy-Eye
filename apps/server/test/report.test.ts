import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measurementReport } from '../src/intel/report.ts';
import type { Metrics, ScenarioInfo } from '../src/types.ts';

const scenario = {
  id: 'rhein-mosel',
  title: 'Übung RHEIN-MOSEL',
  titleEn: 'Exercise RHEIN-MOSEL',
  description: '',
  descriptionEn: '',
  durationSec: 600,
  status: 'finished',
  clipsTotal: 31,
  clipsReady: 31,
  elapsedSec: 600,
  speed: 1,
} as ScenarioInfo;

const metrics: Metrics = {
  retentionDays: 60,
  footageSec: 577,
  framesAnalysed: 571,
  vectors: 2268,
  sources: 12,
  facesMasked: 37,
  maskingActive: true,
  searches: { count: 4, blocked: 2, federated: 1, medianMs: 6, p95Ms: 160 },
  alerts: { total: 15, confirmed: 1, dismissed: 1, open: 13 },
  unmaskEvents: 0,
  ledgerEntries: 40,
  analysisSpeed: 3.3,
  evaluation: {
    events: [
      { label: 'Mosel tritt über die Ufer', sourceName: 'UAS 1 · Moselbogen', onsetSec: 80, detectedSec: 81.1, latencySec: 1.1, watchName: 'Überflutung' },
      { label: 'Baum auf <Fahrzeug> gestürzt', sourceName: 'Erkunder 2 · Lützel', onsetSec: 160, detectedSec: null, latencySec: null, watchName: null },
    ],
    total: 2,
    detected: 1,
    medianLatencySec: 1.1,
    falseAlarms: 1,
    alerts: 2,
    unexplained: [{ watchName: 'Umgestürzter Lastkraftwagen', watchNameEn: 'Overturned lorry', sourceName: 'Erkunder 1 · Güls', exerciseSec: 264, confidence: 0.95, status: 'dismissed' }],
  },
  hazardModel: null,
};

const base = {
  node: { id: 'koblenz', name: 'Lagezentrum Koblenz', operator: 'Untere Katastrophenschutzbehörde (Übung)', region: 'Koblenz', lat: 50.36, lon: 7.59, version: '0.5.0' },
  mandate: null,
  author: 'Einsatzleitung (Stab · S2 Lage)',
  recordings: { total: 31, analysed: 31 },
  machine: { cpu: 'Testprozessor', threads: 4, device: 'cpu', modelId: 'onnx-community/siglip2-base-patch32-256-ONNX' },
  ledgerHead: 'ab'.repeat(32),
  ledgerLength: 40,
};

test('the measurement report states result, events, unexplained alerts and the ledger state', () => {
  const html = measurementReport({ ...base, lang: 'de', scenario, metrics });
  assert.match(html, /<h1>Messbericht<\/h1>/);
  assert.match(html, /<strong>1 von 2<\/strong>/);
  assert.match(html, /<strong>1,1 s<\/strong>/);
  assert.match(html, /T\+01:20/);
  assert.match(html, /nicht erkannt/);
  assert.match(html, /Umgestürzter Lastkraftwagen/);
  assert.match(html, /verworfen/);
  assert.match(html, /Eintrag 40, Hash (ab){32}/);
  // Text from the script is escaped, and the document carries no script.
  assert.match(html, /Baum auf &lt;Fahrzeug&gt; gestürzt/);
  assert.doesNotMatch(html, /<script/i);
  // At real-time speed there is no remark about an accelerated clock.
  assert.doesNotMatch(html, /-facher Geschwindigkeit/);
});

test('an accelerated clock is pointed out, and the English version uses English terms', () => {
  const html = measurementReport({ ...base, lang: 'en', scenario: { ...scenario, speed: 8 }, metrics });
  assert.match(html, /<h1>Measurement report<\/h1>/);
  assert.match(html, /ran at 8 times real time/);
  assert.match(html, /Overturned lorry/);
  assert.match(html, /not detected/);
  assert.match(html, /<strong>1\.1 s<\/strong>/);
});

test('without an exercise run the report says so instead of showing empty tables', () => {
  const html = measurementReport({ ...base, lang: 'de', scenario: { ...scenario, status: 'ready', elapsedSec: 0 }, metrics: { ...metrics, evaluation: null } });
  assert.match(html, /Es liegt kein Übungslauf vor/);
  assert.doesNotMatch(html, /Ereignisse des Drehbuchs/);
});
