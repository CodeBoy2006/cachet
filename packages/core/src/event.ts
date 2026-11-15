import { getEventHash, verifyEvent, type Event } from 'nostr-tools/pure';
import { isLowerHex, isSafeUnixSeconds } from './bytes.ts';
import { CLAIM_PLATFORM, MAX_EVENT_BYTES } from './constants.ts';
import { serializeProof, type BindProof } from './statement.ts';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

type RebuildResult = { ok: true; event: NostrEvent } | { ok: false; detail: string };

/**
 * Builds a fresh, frozen event from untrusted input (string or object).
 *
 * nostr-tools caches verification results on the object it was given, and a
 * spread copy keeps that cache. Rebuilding field by field drops any cache and
 * any extra properties, so later checks always run on exactly what was signed.
 */
export const rebuildEvent = (input: unknown): RebuildResult => {
  let value: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_EVENT_BYTES) return { ok: false, detail: 'event too large' };
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, detail: 'not JSON' };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, detail: 'not an object' };
  }
  const e = value as Record<string, unknown>;
  if (!isLowerHex(e.id, 32)) return { ok: false, detail: 'id must be 64 lowercase hex' };
  if (!isLowerHex(e.pubkey, 32)) return { ok: false, detail: 'pubkey must be 64 lowercase hex' };
  if (!isLowerHex(e.sig, 64)) return { ok: false, detail: 'sig must be 128 lowercase hex' };
  if (!isSafeUnixSeconds(e.created_at)) return { ok: false, detail: 'created_at must be Unix seconds' };
  if (typeof e.kind !== 'number' || !Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) {
    return { ok: false, detail: 'kind must be an integer 0–65535' };
  }
  if (typeof e.content !== 'string') return { ok: false, detail: 'content must be a string' };
  if (!Array.isArray(e.tags)) return { ok: false, detail: 'tags must be an array' };
  const tags: string[][] = [];
  let size = 0;
  for (const tag of e.tags) {
    if (!Array.isArray(tag) || !tag.every((x) => typeof x === 'string')) {
      return { ok: false, detail: 'every tag must be an array of strings' };
    }
    size += tag.reduce((n: number, x: string) => n + x.length, 0);
    tags.push(Object.freeze([...tag]) as string[]);
  }
  if (size + e.content.length > MAX_EVENT_BYTES) return { ok: false, detail: 'event too large' };
  return {
    ok: true,
    event: Object.freeze({
      id: e.id,
      pubkey: e.pubkey,
      created_at: e.created_at,
      kind: e.kind,
      tags: Object.freeze(tags) as string[][],
      content: e.content,
      sig: e.sig,
    }),
  };
};

export type SignatureCheck = { ok: true } | { ok: false; code: 'event_id_mismatch' | 'event_signature_invalid' };

/** Checks id and BIP-340 signature on a rebuilt event. Never reads a cached result. */
export const checkEventSignature = (event: NostrEvent): SignatureCheck => {
  const fresh = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((t) => [...t]),
    content: event.content,
    sig: event.sig,
  };
  if (getEventHash(fresh) !== event.id) return { ok: false, code: 'event_id_mismatch' };
  return verifyEvent(fresh as Event) ? { ok: true } : { ok: false, code: 'event_signature_invalid' };
};

export const claimIdentity = (cashaddr: string) => `${CLAIM_PLATFORM}:${cashaddr}`;

export const isBchClaimTag = (tag: readonly string[]) =>
  tag[0] === 'i' && typeof tag[1] === 'string' && tag[1].startsWith(`${CLAIM_PLATFORM}:`);

export interface ClaimTag {
  index: number;
  identity: string;
  cashaddr: string;
  proof: string | undefined;
}

export const findBchClaims = (tags: readonly (readonly string[])[]): ClaimTag[] =>
  tags.flatMap((tag, index) =>
    isBchClaimTag(tag)
      ? [{ index, identity: tag[1]!, cashaddr: tag[1]!.slice(CLAIM_PLATFORM.length + 1), proof: tag[2] }]
      : [],
  );

export const claimTag = (proof: BindProof): string[] => [
  'i',
  claimIdentity(proof.statement.cashaddr),
  serializeProof(proof),
];

/**
 * Next snapshot tags: keeps every non-BCH claim (GitHub, X, …) and any other
 * BCH address, replaces the claim for this address.
 */
export const upsertClaimTag = (existing: readonly (readonly string[])[], tag: string[]): string[][] => [
  ...existing.filter((t) => !(t[0] === 'i' && t[1] === tag[1])).map((t) => [...t]),
  tag,
];

export const removeClaimTag = (existing: readonly (readonly string[])[], cashaddr: string): string[][] =>
  existing.filter((t) => !(t[0] === 'i' && t[1] === claimIdentity(cashaddr))).map((t) => [...t]);
