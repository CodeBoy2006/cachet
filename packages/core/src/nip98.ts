/**
 * NIP-98 HTTP auth, tightened for login:
 * the payload tag is mandatory and must hash the exact request body.
 * One-time nonces live on the relying party, not here.
 */
import { base64ToBin, binToBase64, utf8ToBin } from '@bitauth/libauth';
import { sha256Hex } from './bytes.ts';
import type { AuthCode } from './codes.ts';
import { KIND_HTTP_AUTH } from './constants.ts';
import { checkEventSignature, rebuildEvent, type EventTemplate, type NostrEvent } from './event.ts';
import { nowSeconds } from './statement.ts';

export const DEFAULT_AUTH_WINDOW = 60;

export const buildAuthTemplate = (input: {
  url: string;
  method: string;
  body: Uint8Array | string;
  createdAt?: number;
}): EventTemplate => ({
  kind: KIND_HTTP_AUTH,
  created_at: input.createdAt ?? nowSeconds(),
  tags: [
    ['u', input.url],
    ['method', input.method.toUpperCase()],
    ['payload', sha256Hex(input.body)],
  ],
  content: '',
});

export const encodeAuthHeader = (event: NostrEvent): string =>
  `Nostr ${binToBase64(utf8ToBin(JSON.stringify(event)))}`;

export const decodeAuthHeader = (header: string | null | undefined): string | null => {
  if (!header || !header.startsWith('Nostr ')) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBin(header.slice(6).trim()));
  } catch {
    return null;
  }
};

/** URL-safe Base64 of UTF-8 text, for carrying signed events in URL fragments. */
export const toBase64Url = (text: string): string =>
  binToBase64(utf8ToBin(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromBase64Url = (value: string): string | null => {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBin(padded));
  } catch {
    return null;
  }
};

export type AuthResult = { ok: true; event: NostrEvent } | { ok: false; code: AuthCode; detail?: string };

const single = (tags: readonly (readonly string[])[], name: string) => {
  const found = tags.filter((t) => t[0] === name);
  return found.length === 1 ? found[0]![1] : undefined;
};

export const verifyAuthEvent = (
  raw: unknown,
  expect: { url: string; method: string; body: Uint8Array | string; now?: number; window?: number; pubkey?: string },
): AuthResult => {
  const rebuilt = rebuildEvent(raw);
  if (!rebuilt.ok) return { ok: false, code: 'auth_malformed', detail: rebuilt.detail };
  const event = rebuilt.event;
  if (event.kind !== KIND_HTTP_AUTH) return { ok: false, code: 'auth_kind' };
  if (!checkEventSignature(event).ok) return { ok: false, code: 'auth_signature_invalid' };
  if (single(event.tags, 'u') !== expect.url) return { ok: false, code: 'auth_url_mismatch' };
  if (single(event.tags, 'method') !== expect.method.toUpperCase()) return { ok: false, code: 'auth_method_mismatch' };
  if (single(event.tags, 'payload') !== sha256Hex(expect.body)) return { ok: false, code: 'auth_payload_mismatch' };
  const now = expect.now ?? nowSeconds();
  if (Math.abs(now - event.created_at) > (expect.window ?? DEFAULT_AUTH_WINDOW)) return { ok: false, code: 'auth_stale' };
  if (expect.pubkey !== undefined && event.pubkey !== expect.pubkey) return { ok: false, code: 'auth_pubkey_mismatch' };
  return { ok: true, event };
};
