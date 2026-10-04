// Owner edit tokens of partner declarations, kept in this browser only (no accounts), keyed by partner id.
// The server stores just a hash; a token proves "same browser as the submitter", not ownership of the venue.
// The About dialog's "delete data from this browser" clears every `krok-*` key, including this one.
import type { ObjectSource } from './explore-types';

const KEY = 'krok-partner-tokens-v1';
export const PARTNER_TOKEN_HEADER = 'x-partner-token';

function read(): Record<string, string> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

export function rememberPartnerToken(id: unknown, token: unknown) {
  if (typeof id !== 'string' || typeof token !== 'string') return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: token }));
    return true;
  } catch {
    return false;
  }
}

export function partnerToken(id: string): string | null {
  const token = read()[id];
  return typeof token === 'string' ? token : null;
}

export function forgetPartnerToken(id: string) {
  try {
    const all = read();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** Partner declarations on a place card that this browser can correct or withdraw. */
export function ownedDeclarations(sources: ObjectSource[]) {
  return sources
    .filter(s => s.kind === 'partner' && s.id.startsWith('partner:') && s.status === 'partner')
    .map(s => ({ id: s.id.slice('partner:'.length), source: s }))
    .filter(d => partnerToken(d.id));
}

// Place details are cached by the browser for 30 s. After this browser changes a declaration the card must not show
// the old catalogue, so writes leave a stamp (this tab session) that the card appends to its request URL.
const STAMP = 'krok-partner-write';
export function touchPartnerWrite() {
  try {
    sessionStorage.setItem(STAMP, String(Date.now()));
  } catch {}
}
export function partnerWriteStamp() {
  try {
    return sessionStorage.getItem(STAMP) ?? '';
  } catch {
    return '';
  }
}
