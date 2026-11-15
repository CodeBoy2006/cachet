import { buildAuthTemplate, fromBase64Url, toBase64Url, type EventTemplate, type NostrEvent } from '@cachet/core';
import { Nip07Signer } from '@cachet/signers';

export interface LoginSigner {
  pubkey: string;
  sign(template: EventTemplate): Promise<NostrEvent>;
  close(): void;
}

export const CACHET_URL = (import.meta.env.VITE_CACHET_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const PENDING = 'cachet.pending-login';

export const extensionSigner = async (): Promise<LoginSigner> => {
  const s = new Nip07Signer();
  const pubkey = await s.getPublicKey();
  return { pubkey, sign: (t) => s.signEvent(t), close: () => {} };
};

/**
 * Redirect sign-in: the challenge comes first (no pubkey yet), Cachet signs that
 * one request for this origin, and sends the event back in the URL fragment.
 * The exact body is kept here, because the signature commits to its hash.
 */
export const startRedirect = (appName: string, challenge: { challenge_id: string; nonce: string; url: string }) => {
  const body = JSON.stringify({ challenge_id: challenge.challenge_id, nonce: challenge.nonce });
  const template = buildAuthTemplate({ url: challenge.url, method: 'POST', body });
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({ body, at: Date.now() }));
  } catch {
    throw new Error('This browser blocks session storage, which sign-in needs.');
  }
  const ret = `${location.origin}${location.pathname}`;
  const q = new URLSearchParams({ app: appName, return: ret, req: toBase64Url(JSON.stringify(template)) });
  location.assign(`${CACHET_URL}/sign?${q.toString()}`);
};

export type RedirectResult = { kind: 'none' } | { kind: 'cancelled' } | { kind: 'error'; message: string } | { kind: 'signed'; body: string; event: unknown };

/** Reads and clears a sign-in result from the URL fragment. */
export const takeRedirectResult = (): RedirectResult => {
  const hash = location.hash.slice(1);
  if (!hash.startsWith('cachet')) return { kind: 'none' };
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  let pending: { body: string; at: number } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null');
    sessionStorage.removeItem(PENDING);
  } catch {
    /* treated as missing */
  }
  const params = new URLSearchParams(hash);
  if (params.has('cachet-error')) return { kind: 'cancelled' };
  const json = fromBase64Url(params.get('cachet') ?? '');
  if (!json) return { kind: 'error', message: 'The signed request came back unreadable.' };
  if (!pending) return { kind: 'error', message: 'This sign-in was started in another tab or has expired. Start again.' };
  try {
    return { kind: 'signed', body: pending.body, event: JSON.parse(json) };
  } catch {
    return { kind: 'error', message: 'The signed request came back unreadable.' };
  }
};
