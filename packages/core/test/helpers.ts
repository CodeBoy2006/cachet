import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  addressFromPublicKey,
  bindMessage,
  claimTag,
  createStatement,
  hexToBin,
  signMessage,
  upsertClaimTag,
  type BindStatement,
  type Network,
  type NostrEvent,
} from '../src/index.ts';

export interface TestIdentity {
  nostrSecret: Uint8Array;
  nostrPubkey: string;
  bchPrivate: Uint8Array;
  bchPublic: Uint8Array;
  cashaddr: string;
}

export const makeIdentity = (opts: { network?: Network; tokenAware?: boolean; sameKey?: boolean } = {}): TestIdentity => {
  const nostrSecret = generateSecretKey();
  const bchPrivate = opts.sameKey ? nostrSecret : generateSecretKey();
  const bchPublic = secp256k1.derivePublicKeyCompressed(bchPrivate) as Uint8Array;
  return {
    nostrSecret,
    nostrPubkey: getPublicKey(nostrSecret),
    bchPrivate,
    bchPublic,
    cashaddr: addressFromPublicKey(bchPublic, opts.network ?? 'mainnet', opts.tokenAware),
  };
};

export const signProof = (id: TestIdentity, statement: BindStatement, message = bindMessage(statement)) => ({
  type: 'bch-nostr-bind/v1' as const,
  statement,
  bch_signature: signMessage(id.bchPrivate, message),
});

export const publishSnapshot = (
  id: TestIdentity,
  tags: string[][],
  createdAt = Math.floor(Date.now() / 1000),
  secret = id.nostrSecret,
): NostrEvent => finalizeEvent({ kind: 10011, created_at: createdAt, tags, content: '' }, secret) as NostrEvent;

export const makeBinding = (
  id = makeIdentity(),
  opts: { now?: number; ttl?: number; existing?: string[][]; statement?: Partial<BindStatement> } = {},
) => {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const statement = {
    ...createStatement({ cashaddr: id.cashaddr, nostrPubkey: id.nostrPubkey, issuedAt: now - 10, ttlSeconds: opts.ttl }),
    ...opts.statement,
  } as BindStatement;
  const proof = signProof(id, statement);
  const event = publishSnapshot(id, upsertClaimTag(opts.existing ?? [], claimTag(proof)), now);
  return { id, statement, proof, event, now };
};

/** Negate a private key: d → n − d. Same x-coordinate, opposite y. */
export const negatePrivateKey = (d: Uint8Array): Uint8Array => {
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const value = n - BigInt(`0x${Buffer.from(d).toString('hex')}`);
  return hexToBin(value.toString(16).padStart(64, '0'));
};
