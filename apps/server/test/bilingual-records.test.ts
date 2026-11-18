import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ledger, entryHash, type LedgerBody, type LedgerEntry } from '../src/core/ledger.js';
import { Mandates } from '../src/core/mandates.js';
import { Sources } from '../src/intel/sources.js';
import { ledgerSummary } from '../src/node.js';

/**
 * English twins of what the node writes itself: ledger summaries (summaryEn), seeded mandates
 * (legalBasisEn, purposeEn) and sources (descriptionEn). All optional: data written before they
 * existed stays valid and unchanged.
 */

const nodeVerifier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'pruefen', 'ledger-verify.mjs');

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'bilingual-'));
}

test('ledger entries carry an English twin that is hashed with them; older entries hash as before', async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, 'ledger.jsonl');
    const ledger = new Ledger(file);
    await ledger.open();
    const old = await ledger.append({ actor: 'system', role: 'system', mandateId: null, action: 'node.start', summary: 'Knoten gestartet', data: {} });
    assert.equal('summaryEn' in old, false);
    const both = await ledger.append({ actor: 'a', role: 'supervisor', mandateId: null, action: 'x', ...ledgerSummary({ de: 'Mandat angelegt', en: 'Mandate created' }), data: {} });
    assert.equal(both.summary, 'Mandat angelegt');
    assert.equal(both.summaryEn, 'Mandate created');
    // An entry without the twin hashes exactly as it did before the field existed.
    const body: LedgerBody = { seq: old.seq, ts: old.ts, actor: old.actor, role: old.role, mandateId: old.mandateId, action: old.action, summary: old.summary, data: old.data };
    assert.equal(entryHash(old.prev, body), old.hash);
    assert.equal((await ledger.verify()).ok, true);
    // A restart reads and verifies the file, and the stand-alone verifier accepts it.
    const reopened = new Ledger(file);
    await reopened.open();
    assert.equal(reopened.list({ limit: 1 })[0]?.summaryEn, 'Mandate created');
    const run = spawnSync(process.execPath, [nodeVerifier, file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    // The twin is protected like the rest: changing it breaks the chain.
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    const tampered = JSON.parse(lines[1] as string) as LedgerEntry;
    tampered.summaryEn = 'Nothing happened';
    await fs.writeFile(file, `${lines[0]}\n${JSON.stringify(tampered)}\n`);
    const broken = new Ledger(file);
    await assert.rejects(broken.open(), /failed verification at entry 2/);
    assert.deepEqual(ledgerSummary('nur deutsch'), { summary: 'nur deutsch' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('seeded sources and mandates get their English texts, without touching what an operator changed', async () => {
  const dir = await tempDir();
  try {
    // A sources file from before the English description existed.
    const sourcesFile = path.join(dir, 'sources.json');
    await fs.writeFile(
      sourcesFile,
      JSON.stringify([
        { id: 'eingang', name: 'Eingang', nameEn: 'Inbox', kind: 'upload', owner: '', description: 'Hochgeladenes Material ohne Zuordnung zu einem Sensor.', lat: null, lon: null, mode: 'archive', shared: false, createdAt: 1 },
        { id: 'uas-1', name: 'UAS 1', kind: 'drone', owner: '', description: 'Erkundungsflug.', lat: 1, lon: 2, mode: 'archive', shared: false, createdAt: 2 },
        { id: 'uas-2', name: 'UAS 2', kind: 'drone', owner: '', description: 'Vom Betreiber neu beschrieben.', lat: 1, lon: 2, mode: 'archive', shared: false, createdAt: 3 },
      ]),
    );
    const sources = new Sources(sourcesFile);
    await sources.open();
    assert.equal(sources.get('eingang')?.descriptionEn, 'Uploaded footage not assigned to a sensor.');
    sources.addEnglish('uas-1', { name: 'UAS 1', nameEn: 'UAS 1 (en)', description: 'Erkundungsflug.', descriptionEn: 'Reconnaissance flight.' });
    sources.addEnglish('uas-2', { name: 'UAS 2', description: 'Erkundungsflug.', descriptionEn: 'Reconnaissance flight.' });
    assert.equal(sources.get('uas-1')?.descriptionEn, 'Reconnaissance flight.');
    assert.equal(sources.get('uas-1')?.nameEn, 'UAS 1 (en)');
    assert.equal(sources.get('uas-2')?.descriptionEn, undefined, 'a description the operator changed gets no foreign twin');
    const created = sources.create({ name: 'Neu', kind: 'fixed', owner: '', description: 'd', descriptionEn: 'e', lat: null, lon: null, mode: 'archive', shared: false });
    assert.equal(created.descriptionEn, 'e');
    await sources.flush();
    const onDisk = JSON.parse(await fs.readFile(sourcesFile, 'utf8')) as { id: string; descriptionEn?: string }[];
    assert.equal(onDisk.find((s) => s.id === 'eingang')?.descriptionEn, 'Uploaded footage not assigned to a sensor.');

    const mandates = new Mandates(path.join(dir, 'mandates.json'));
    await mandates.open();
    const seeded = { title: 'Erprobung', titleEn: 'Evaluation', legalBasis: 'L', legalBasisEn: 'L (en)', purpose: 'P', purposeEn: 'P (en)' };
    mandates.create({ title: 'Erprobung', legalBasis: 'L', purpose: 'P', issuedBy: 'System', validFrom: 0, validTo: null, exercise: true, personDescriptions: false }, 'md_a');
    mandates.create({ title: 'Erprobung', legalBasis: 'L', purpose: 'geändert', issuedBy: 'System', validFrom: 0, validTo: null, exercise: true, personDescriptions: false }, 'md_b');
    mandates.addEnglish('md_a', seeded);
    mandates.addEnglish('md_b', seeded);
    mandates.addEnglish('md_missing', seeded);
    assert.deepEqual([mandates.get('md_a')?.legalBasisEn, mandates.get('md_a')?.purposeEn, mandates.get('md_a')?.titleEn], ['L (en)', 'P (en)', 'Evaluation']);
    assert.equal(mandates.get('md_b')?.purposeEn, undefined);
    assert.equal(mandates.get('md_b')?.legalBasisEn, 'L (en)');
    await mandates.flush();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('every seeded source and the exercise mandate have English twins', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  for (const file of ['seeds/mainz/seed.json', 'seeds/trier/seed.json', 'datasets/datum/seed.json', 'scenarios/rhein-mosel/scenario.json']) {
    const data = JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as {
      sources: { id: string; nameEn?: string; descriptionEn?: string }[];
      mandate?: { legalBasisEn?: string; purposeEn?: string };
    };
    for (const s of data.sources) {
      assert.ok(s.descriptionEn && s.descriptionEn.trim() !== '', `${file}: ${s.id} has no descriptionEn`);
      assert.ok(s.nameEn && s.nameEn.trim() !== '', `${file}: ${s.id} has no nameEn`);
    }
    if (data.mandate) assert.ok(data.mandate.legalBasisEn && data.mandate.purposeEn, `${file}: mandate without English texts`);
  }
});
