import { createHmac } from 'node:crypto';
import type { PeerRecord } from './federation.js';

/**
 * How the nodes of a federation are named in a configuration file.
 *
 * Nodes that run in one process (the demonstration) refer to each other by id. A node on another
 * machine is described with the address it is reached at. Either way two nodes share one key,
 * which both derive from a common secret and their two ids, or which is given for the pair.
 */

/** One key per pair of nodes, the same on both sides. */
export function pairSecret(master: string, a: string, b: string): string {
  return createHmac('sha256', master).update([a, b].sort().join('|')).digest('hex');
}

/** A peer that runs elsewhere. Both sides name each other and hold the same key. */
export interface ExternalPeer {
  id: string;
  name: string;
  operator?: string;
  region?: string;
  /** Where the peer is reached, e.g. https://sicht.kreis-beispiel.example or http://192.168.1.20:8787 */
  url: string;
  lat?: number;
  lon?: number;
  /** Key of this pair; without it the key is derived from `federationSecret` and the two ids. */
  secret?: string;
}

/** Checks the description of a peer on another machine and completes it. */
export function externalPeer(file: string, nodeId: string, peer: ExternalPeer, master: string | undefined): PeerRecord {
  const fail = (what: string): never => {
    throw new Error(`${file}: Nachbar von "${nodeId}": ${what}`);
  };
  if (typeof peer.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(peer.id)) fail('"id" fehlt oder enthält anderes als Kleinbuchstaben, Ziffern und Bindestriche.');
  if (peer.id === nodeId) fail('ein Knoten kann nicht sein eigener Nachbar sein.');
  if (typeof peer.name !== 'string' || peer.name.trim() === '') fail(`"name" fehlt bei "${peer.id}".`);
  let url: URL;
  try {
    url = new URL(peer.url);
  } catch {
    return fail(`"url" von "${peer.id}" ist keine Adresse.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(`"url" von "${peer.id}" muss mit http:// oder https:// beginnen.`);
  if (url.username !== '' || url.password !== '') fail(`"url" von "${peer.id}" darf keine Zugangsdaten enthalten; der Schlüssel steht in "secret" oder "federationSecret".`);
  if (peer.secret !== undefined && (typeof peer.secret !== 'string' || peer.secret.length < 32)) fail(`"secret" von "${peer.id}" ist kürzer als 32 Zeichen.`);
  if (peer.secret === undefined && (typeof master !== 'string' || master.length < 16)) fail(`für "${peer.id}" fehlt ein Schlüssel: "secret" beim Nachbarn oder "federationSecret" für die Datei.`);
  return {
    id: peer.id,
    name: peer.name.trim().slice(0, 80),
    operator: typeof peer.operator === 'string' ? peer.operator.slice(0, 120) : '',
    region: typeof peer.region === 'string' ? peer.region.slice(0, 80) : '',
    url: `${url.origin}${url.pathname.replace(/\/$/, '')}`,
    lat: typeof peer.lat === 'number' && Math.abs(peer.lat) <= 90 ? peer.lat : 0,
    lon: typeof peer.lon === 'number' && Math.abs(peer.lon) <= 180 ? peer.lon : 0,
    secret: peer.secret ?? pairSecret(master as string, nodeId, peer.id),
  };
}
