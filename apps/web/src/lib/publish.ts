import {
  KIND_EXTERNAL_IDENTITIES,
  checkEventSignature,
  claimTag,
  compareSnapshots,
  nowSeconds,
  rebuildEvent,
  removeClaimTag,
  upsertClaimTag,
  verifyBinding,
  type BindProof,
  type NostrEvent,
  type VerifyResult,
} from '@cachet/core';
import { fetchCurrentSnapshot, publishEvent, type PublishResult } from '@cachet/discovery';
import type { NostrConnection } from './session.tsx';
import { browserCache } from './storage.ts';
import { invalidateLookups } from './useLookup.ts';

/** Newest verified snapshot from relays or this browser's cache: the base every edit must build on. */
const currentBase = async (pubkey: string, relays: string[]) => {
  const fetched = await fetchCurrentSnapshot(pubkey, relays);
  const cached = browserCache
    .get(pubkey)
    .map((e) => rebuildEvent(e))
    .flatMap((r) =>
      r.ok && r.event.pubkey === pubkey && r.event.kind === KIND_EXTERNAL_IDENTITIES && checkEventSignature(r.event).ok ? [r.event] : [],
    );
  const all = [fetched.latest, ...cached].filter((e): e is NostrEvent => !!e && e.pubkey === pubkey);
  return { base: all.sort(compareSnapshots)[0], reachable: fetched.reachable };
};

const signAndPublish = async (
  nostr: NostrConnection,
  base: NostrEvent | undefined,
  tags: string[][],
  relays: string[],
  onResult?: (r: PublishResult) => void,
  precheck?: (event: NostrEvent) => void,
) => {
  const event = await nostr.signer.signEvent({
    kind: KIND_EXTERNAL_IDENTITIES,
    // Strictly newer than the base, so no relay keeps the old one on a timestamp tie.
    created_at: Math.max(nowSeconds(), (base?.created_at ?? 0) + 1),
    tags,
    content: base?.content ?? '',
  });
  precheck?.(event);
  const results = await publishEvent(event, relays, { onResult });
  if (results.some((r) => r.ok)) {
    browserCache.put(nostr.pubkey, event);
    invalidateLookups();
  }
  return { event, results };
};

export const publishBinding = async (input: {
  nostr: NostrConnection;
  proof: BindProof;
  relays: string[];
  onResult?: (r: PublishResult) => void;
}) => {
  const { base, reachable } = await currentBase(input.nostr.pubkey, input.relays);
  if (!reachable) throw new Error('No relay answered. Check your connection or relay list, then try again.');
  const tags = upsertClaimTag(base?.tags ?? [], claimTag(input.proof));
  const cashaddr = input.proof.statement.cashaddr;
  // Run the same verifier everyone else will use, before anything leaves this browser.
  let check: VerifyResult | undefined;
  const out = await signAndPublish(input.nostr, base, tags, input.relays, input.onResult, (event) => {
    check = verifyBinding(event, { cashaddr });
    if (!check.ok) throw new Error(`Refusing to publish: ${check.code}`);
  });
  return { ...out, check: check!, kept: tags.filter((t) => t[0] === 'i' && t[1] !== `bch:${input.proof.statement.cashaddr}`).map((t) => t[1]!) };
};

export const withdrawBinding = async (input: { nostr: NostrConnection; cashaddr: string; relays: string[]; onResult?: (r: PublishResult) => void }) => {
  const { base, reachable } = await currentBase(input.nostr.pubkey, input.relays);
  if (!reachable) throw new Error('No relay answered. Check your connection or relay list, then try again.');
  if (!base) throw new Error('No current snapshot found to withdraw from.');
  return signAndPublish(input.nostr, base, removeClaimTag(base.tags, input.cashaddr), input.relays, input.onResult);
};
