import {
  bindMessage,
  claimTag,
  createStatement,
  nowSeconds,
  verifyBinding,
  type BindProof,
  type NostrEvent,
  type VerifyResult,
} from '@cachet/core';
import { LocalBchSigner, LocalNostrSigner } from '@cachet/signers';

export interface Example {
  event: NostrEvent;
  proof: BindProof;
  result: VerifyResult;
  nostr: LocalNostrSigner;
  bch: LocalBchSigner;
}

/** A complete binding made with throwaway keys, entirely in this browser. Nothing is published. */
export const makeExample = async (opts: { tokenAware?: boolean; sameKey?: boolean } = {}): Promise<Example> => {
  const nostr = LocalNostrSigner.generate();
  const bch = LocalBchSigner.generate('mainnet');
  const now = nowSeconds();
  const statement = createStatement({ cashaddr: bch.address(opts.tokenAware), nostrPubkey: nostr.pubkey, issuedAt: now - 60 });
  const message = bindMessage(statement);
  const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: await bch.signMessage(message, statement.cashaddr) };
  const event = await nostr.signEvent({ kind: 10011, created_at: now - 30, tags: [claimTag(proof)], content: '' });
  return { event, proof, result: verifyBinding(event, { now }), nostr, bch };
};
