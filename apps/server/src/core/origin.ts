/**
 * Where a request to the interface was started, as far as the browser tells.
 *
 * Every query is recorded under the name of the person signed in. A page on another site, or a
 * link in a mail, must therefore not be able to make that person's browser run one: the cookie
 * would travel along (it is `SameSite=Lax`, which still covers a followed link), and the entry
 * would carry the wrong author. Browsers state with `Sec-Fetch-Site` whether a request was started
 * by the same origin, by another site or by the user, and with `Sec-Fetch-Mode` whether it is a
 * page being opened. Programs (peer nodes, scripts, the checks of this repository) send neither
 * header and are judged by their signature or their session as before.
 */

export interface FetchMetadata {
  'sec-fetch-site'?: string | string[] | undefined;
  'sec-fetch-mode'?: string | string[] | undefined;
  'sec-fetch-dest'?: string | string[] | undefined;
  origin?: string | string[] | undefined;
  host?: string | string[] | undefined;
}

/** Ways that take a text from the address and write it to the ledger. Never opened as a page. */
const RECORDING_QUERIES = ['/api/search', '/api/explain'];

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Returns the reason for refusing the request, or null when it may pass.
 *
 * - A request another site started is refused for the interface and the imagery. Browsers that
 *   send no fetch metadata still name the origin of every request that changes something; it has
 *   to be this node.
 * - A query that is opened as a page (a followed link, a typed address) or loaded as a picture,
 *   frame or script is refused: the console only ever asks with `fetch`, so anything else is an
 *   address someone planted, be it in a mail or in the answer of a peer.
 */
export function foreignRequest(headers: FetchMetadata, url: string, method = 'GET'): 'cross-site' | 'navigation' | null {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/') && !path.startsWith('/media/')) return null;
  const site = first(headers['sec-fetch-site'])?.toLowerCase();
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'cross-site';
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = first(headers.origin);
    const host = first(headers.host);
    if (origin !== undefined && host !== undefined) {
      let originHost: string | null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null; // "null" (a sandboxed page) or anything that is no address
      }
      if (originHost !== host.toLowerCase()) return 'cross-site';
    }
  }
  if (RECORDING_QUERIES.includes(path)) {
    const mode = first(headers['sec-fetch-mode'])?.toLowerCase();
    const dest = first(headers['sec-fetch-dest'])?.toLowerCase();
    if (mode === 'navigate' || (dest !== undefined && dest !== 'empty')) return 'navigation';
  }
  return null;
}
