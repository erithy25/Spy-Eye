import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foreignRequest } from '../src/core/origin.ts';

test('the console itself, typed addresses and programs pass', () => {
  // fetch() from the console
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }, '/api/search?q=flut'), null);
  // a report opened in a new tab from the console
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' }, '/api/cases/vg_1/report'), null);
  // an export opened from a bookmark
  assert.equal(foreignRequest({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, '/api/ledger/export'), null);
  // peer nodes, scripts and the checks of this repository send no such headers
  assert.equal(foreignRequest({}, '/api/federation/search'), null);
  assert.equal(foreignRequest({}, '/api/search?q=flut'), null);
  // an image of the console
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors' }, '/media/072f0bcf12104e01/frames/0000001.jpg'), null);
});

test('a request started by another site is refused for interface and imagery', () => {
  assert.equal(foreignRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, '/api/search?q=Gesicht%20von%20Herrn%20M'), 'cross-site');
  assert.equal(foreignRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }, '/media/072f0bcf12104e01/frames/0000001.jpg'), 'cross-site');
  // another port of the same machine is another origin, though the same site
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' }, '/api/state'), 'cross-site');
  assert.equal(foreignRequest({ 'sec-fetch-site': ['cross-site'] }, '/api/ledger/export'), 'cross-site');
  assert.equal(foreignRequest({ 'sec-fetch-site': 'Cross-Site' }, '/api/cases'), 'cross-site');
});

test('a query cannot be started by following a link, wherever the link was', () => {
  // A link in a mail: the browser reports no site, but it does report that a page is being opened.
  assert.equal(foreignRequest({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, '/api/search?q=Kennzeichen%20KO%20AB%20123'), 'navigation');
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' }, '/api/explain?q=x'), 'navigation');
  // Pages that are meant to be opened stay reachable.
  assert.equal(foreignRequest({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, '/api/report/measurement'), null);
});

test('the console and its static files are never refused', () => {
  assert.equal(foreignRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, '/'), null);
  assert.equal(foreignRequest({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }, '/assets/index.js'), null);
});

test('a query cannot be loaded as a picture, the way a planted preview address would', () => {
  // <img src="api/search?q=…"> inside the console: same origin, but not a fetch.
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }, '/api/search?q=angela%20merkel&federated=1'), 'navigation');
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' }, '/api/explain?q=x'), 'navigation');
  // The console's own fetch says that its result is used by script.
  assert.equal(foreignRequest({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, '/api/search?q=flut'), null);
});

test('without fetch metadata, a changing request must still name this node as its origin', () => {
  const host = '127.0.0.1:8787';
  assert.equal(foreignRequest({ origin: 'http://127.0.0.1:8787', host }, '/api/cases/vg_1/seal', 'POST'), null);
  assert.equal(foreignRequest({ origin: 'http://127.0.0.1:8788', host }, '/api/cases/vg_1/seal', 'POST'), 'cross-site');
  assert.equal(foreignRequest({ origin: 'https://example.org', host }, '/api/logout', 'POST'), 'cross-site');
  assert.equal(foreignRequest({ origin: 'null', host }, '/api/exercise/start', 'POST'), 'cross-site');
  // Programs name no origin: peer nodes are judged by their signature, scripts by their session.
  assert.equal(foreignRequest({ host }, '/api/federation/search', 'POST'), null);
  // Reading is not refused on the origin header alone.
  assert.equal(foreignRequest({ origin: 'http://127.0.0.1:8788', host }, '/api/state', 'GET'), null);
});
