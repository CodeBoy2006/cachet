import { buildAuthTemplate, encodeAuthHeader, type NostrEvent } from '@cachet/core';
import type { LoginSigner } from './signers.ts';

export interface SessionInfo {
  pubkey: string;
  npub: string;
  name?: string;
  cashaddr: string;
  bindingId: string;
  snapshotId: string;
  bindingExpiresAt: number;
  createdAt: number;
  checkedAt: number;
  relays: { url: string; status: string; ms: number }[];
}

export interface LogEntry {
  t: number;
  tone: 'ok' | 'reject' | 'info';
  text: string;
  code?: string;
}

export interface NoteItem {
  id: string;
  title: string;
  date: string;
  preview: string;
  body?: string;
}

export interface StallListing {
  id: string;
  name: string;
  sats: number;
  bch: string;
  stock: number;
}

export interface StallSeller {
  pubkey: string;
  npub: string;
  name?: string;
  cashaddr: string;
  snapshotId: string;
  checkedAt: number;
}

export interface StallState {
  seller: StallSeller | null;
  sellerState?: string;
  listings: StallListing[];
}

export class LoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const post = async (path: string, body?: string, headers: Record<string, string> = {}) => {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...headers }, body });
  return (await res.json().catch(() => ({ ok: false, code: 'network', message: `HTTP ${res.status}` }))) as Record<string, any>;
};

export type LoginStep = 'identity' | 'challenge' | 'sign' | 'verify';

export const login = async (getSigner: () => Promise<LoginSigner>, onStep: (step: LoginStep, detail?: string) => void): Promise<SessionInfo> => {
  onStep('identity');
  const signer = await getSigner();
  try {
    onStep('challenge', signer.pubkey);
    const ch = await post('/api/challenge', JSON.stringify({ pubkey: signer.pubkey }));
    if (!ch.ok) throw new LoginError(ch.code, ch.message);
    const answered = (ch.binding.relays as { status: string }[]).filter((r) => r.status === 'ok').length;
    onStep('sign', `${answered}/${ch.binding.relays.length} relays`);
    // The body we sign is exactly the body we send; the server hashes the raw bytes.
    const body = JSON.stringify({ challenge_id: ch.challenge_id, nonce: ch.nonce, binding_id: ch.binding.binding_id });
    const event = await signer.sign(buildAuthTemplate({ url: ch.url, method: 'POST', body }));
    onStep('verify');
    const res = await post('/api/verify', body, { authorization: encodeAuthHeader(event) });
    if (!res.ok) throw new LoginError(res.code, res.message);
    return res.session as SessionInfo;
  } finally {
    signer.close();
  }
};

/** Step one of the redirect flow: an open challenge, before anyone knows which key will sign. */
export const openChallenge = async () => {
  const ch = await post('/api/challenge', '{}');
  if (!ch.ok) throw new LoginError(ch.code, ch.message);
  return ch as { challenge_id: string; nonce: string; url: string };
};

/** Step two: the signed event came back from Cachet; our server verifies it and resolves the key. */
export const completeRedirect = async (body: string, event: unknown): Promise<SessionInfo> => {
  const res = await post('/api/verify', body, { authorization: encodeAuthHeader(event as NostrEvent) });
  if (!res.ok) throw new LoginError(res.code, res.message);
  return res.session as SessionInfo;
};

export const getSession = async (): Promise<SessionInfo | null> => {
  const res = await fetch('/api/session', { credentials: 'same-origin' });
  if (!res.ok) return null;
  return ((await res.json()) as { session: SessionInfo }).session;
};

export const recheck = () => post('/api/session/recheck');
export const logout = () => post('/api/logout');
export const getLog = async (): Promise<LogEntry[]> => (await fetch('/api/log')).json();
export const getNotes = async (): Promise<{ locked: boolean; notes: NoteItem[] }> =>
  (await fetch('/api/notes', { credentials: 'same-origin' })).json();
export const getStall = async (seller?: string): Promise<StallState> =>
  (await fetch(seller ? `/api/stall?seller=${encodeURIComponent(seller)}` : '/api/stall', { credentials: 'same-origin' })).json();
