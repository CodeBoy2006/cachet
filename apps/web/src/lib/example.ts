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
  /** Same Nostr author validly signing a claim for a BCH address whose key they do not hold. */
  forged: {
    cashaddr: string;
    /** The address the forged BCH signature actually recovers to (the attacker's). */
    signer: string;
    /** That key, compressed SEC hex. */
    signerKey: string;
    message: string;
    event: NostrEvent;
    result: VerifyResult;
  };
}

/** A complete binding made with throwaway keys, entirely in this browser. Nothing is published. */
export const makeExample = async (opts: { tokenAware?: boolean } = {}): Promise<Example> => {
  const nostr = LocalNostrSigner.generate();
  const bch = LocalBchSigner.generate('mainnet');
  const now = nowSeconds();
  const statement = createStatement({ cashaddr: bch.address(opts.tokenAware), nostrPubkey: nostr.pubkey, issuedAt: now - 60 });
  const message = bindMessage(statement);
  const proof: BindProof = { type: 'bch-nostr-bind/v1', statement, bch_signature: await bch.signMessage(message, statement.cashaddr) };
  const event = await nostr.signEvent({ kind: 10011, created_at: now - 30, tags: [claimTag(proof)], content: '' });

  // Build a realistic spoofing attempt: valid Nostr event, victim's CashAddr, signed by wrong BCH key.
  const victimAddr = LocalBchSigner.generate('mainnet').address(opts.tokenAware);
  const attackerBch = LocalBchSigner.generate('mainnet');
  const forgedStatement = createStatement({ cashaddr: victimAddr, nostrPubkey: nostr.pubkey, issuedAt: now - 60 });
  const forgedProof: BindProof = {
    type: 'bch-nostr-bind/v1',
    statement: forgedStatement,
    bch_signature: attackerBch.signRaw(bindMessage(forgedStatement)),
  };
  const forgedEvent = await nostr.signEvent({ kind: 10011, created_at: now - 25, tags: [claimTag(forgedProof)], content: '' });

  return {
    event,
    proof,
    result: verifyBinding(event, { now }),
    nostr,
    bch,
    forged: {
      cashaddr: victimAddr,
      signer: attackerBch.address(opts.tokenAware),
      signerKey: Array.from(attackerBch.publicKey, (b) => b.toString(16).padStart(2, '0')).join(''),
      message: bindMessage(forgedStatement),
      event: forgedEvent,
      result: verifyBinding(forgedEvent, { now }),
    },
  };
};
