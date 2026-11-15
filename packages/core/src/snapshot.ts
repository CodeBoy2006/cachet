import { isAddressError, normalizeCashAddrInput, parseCashAddr, sameController } from './cashaddr.ts';
import type { BindingState } from './codes.ts';
import { KIND_EXTERNAL_IDENTITIES } from './constants.ts';
import { checkEventSignature, findBchClaims, rebuildEvent, type NostrEvent } from './event.ts';
import { nowSeconds } from './statement.ts';
import { isOnlyExpired, verifyBinding, type VerifyResult } from './verify.ts';

/** NIP-01 replaceable ordering: newest first; equal timestamps keep the lowest id. */
export const compareSnapshots = (a: NostrEvent, b: NostrEvent) =>
  b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface ClaimStatus {
  cashaddr: string;
  state: Exclude<BindingState, 'not_found' | 'unavailable'>;
  /** Snapshot the claim was read from. For withdrawn claims, the older snapshot that still had it. */
  eventId: string;
  createdAt: number;
  result?: VerifyResult;
  /** For withdrawn claims: the newer snapshot that dropped it. */
  withdrawnBy?: string;
}

export interface SnapshotSighting {
  id: string;
  createdAt: number;
  relays: string[];
}

export interface Resolution {
  pubkey: string;
  state: BindingState;
  primary?: ClaimStatus;
  /** Claims in the latest snapshot, then claims seen earlier and since removed. */
  claims: ClaimStatus[];
  latest?: NostrEvent;
  /** Non-BCH NIP-39 identities kept in the same snapshot (github:…, x:…). */
  otherIdentities: string[];
  snapshots: SnapshotSighting[];
  rejected: { id?: string; relay?: string; reason: string }[];
  observedAt: number;
}

export interface ResolveInput {
  pubkey: string;
  /** Raw events from relays and from any local cache, tagged with where they came from. */
  events: { event: unknown; relay?: string }[];
  /** Whether at least one relay answered. With no snapshot and no answer, the result is `unavailable`. */
  reachable: boolean;
  cashaddr?: string;
  now?: number;
}

/**
 * Picks the newest valid snapshot and reads the claim state from it alone.
 * An older snapshot never overrides a newer one: if the newest snapshot drops,
 * breaks or lets a claim expire, that is the answer.
 */
export const resolveSnapshots = (input: ResolveInput): Resolution => {
  const now = input.now ?? nowSeconds();
  const rejected: Resolution['rejected'] = [];
  const valid = new Map<string, { event: NostrEvent; relays: Set<string> }>();

  for (const { event: raw, relay } of input.events) {
    const rebuilt = rebuildEvent(raw);
    if (!rebuilt.ok) {
      rejected.push({ relay, reason: rebuilt.detail });
      continue;
    }
    const e = rebuilt.event;
    const seen = valid.get(e.id);
    // Same id is only the same event if every field matches; a forged copy must not earn a sighting.
    if (seen && JSON.stringify(seen.event) === JSON.stringify(e)) {
      if (relay) seen.relays.add(relay);
      continue;
    }
    if (seen) {
      rejected.push({ id: e.id, relay, reason: 'bad signature' });
      continue;
    }
    if (e.kind !== KIND_EXTERNAL_IDENTITIES) rejected.push({ id: e.id, relay, reason: `kind ${e.kind}` });
    else if (e.pubkey !== input.pubkey) rejected.push({ id: e.id, relay, reason: 'different author' });
    else if (!checkEventSignature(e).ok) rejected.push({ id: e.id, relay, reason: 'bad signature' });
    else valid.set(e.id, { event: e, relays: new Set(relay ? [relay] : []) });
  }

  const ordered = [...valid.values()].sort((a, b) => compareSnapshots(a.event, b.event));
  const snapshots = ordered.map(({ event, relays }) => ({ id: event.id, createdAt: event.created_at, relays: [...relays] }));
  const base = { pubkey: input.pubkey, snapshots, rejected, observedAt: now };

  const latest = ordered[0]?.event;
  if (!latest) {
    return { ...base, state: input.reachable ? 'not_found' : 'unavailable', claims: [], otherIdentities: [] };
  }

  const claims: ClaimStatus[] = [];
  const current = new Set<string>();
  for (const { cashaddr } of findBchClaims(latest.tags)) {
    if (current.has(cashaddr)) continue;
    current.add(cashaddr);
    const result = verifyBinding(latest, { now, cashaddr });
    claims.push({
      cashaddr,
      state: result.ok ? 'active' : isOnlyExpired(result) ? 'expired' : 'invalid',
      eventId: latest.id,
      createdAt: latest.created_at,
      result,
    });
  }
  for (const { event } of ordered.slice(1)) {
    for (const { cashaddr } of findBchClaims(event.tags)) {
      if (current.has(cashaddr)) continue;
      current.add(cashaddr);
      claims.push({ cashaddr, state: 'withdrawn', eventId: event.id, createdAt: event.created_at, withdrawnBy: latest.id });
    }
  }

  let primary: ClaimStatus | undefined;
  if (input.cashaddr !== undefined) {
    const wanted = normalizeCashAddrInput(input.cashaddr);
    if (!isAddressError(wanted)) {
      const match = (entries: ClaimStatus[]) =>
        entries.find((c) => c.cashaddr === wanted.address) ??
        entries.find((c) => {
          const p = parseCashAddr(c.cashaddr);
          return !isAddressError(p) && sameController(p, wanted);
        });
      primary = match(claims.filter((c) => c.state !== 'withdrawn')) ?? match(claims.filter((c) => c.state === 'withdrawn'));
    }
  } else {
    const rank = { active: 0, expired: 1, invalid: 2, withdrawn: 3 } as const;
    primary = [...claims].sort((a, b) => rank[a.state] - rank[b.state])[0];
  }

  const otherIdentities = latest.tags
    .filter((t) => t[0] === 'i' && typeof t[1] === 'string' && !t[1].startsWith('bch:'))
    .map((t) => t[1]!);

  const state: BindingState = !input.reachable ? 'unavailable' : (primary?.state ?? 'not_found');
  return { ...base, state, ...(primary ? { primary } : {}), claims, latest, otherIdentities };
};
