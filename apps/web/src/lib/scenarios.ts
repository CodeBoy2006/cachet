import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import {
  KIND_APP_DATA,
  PAYTACA_LEGACY_D_TAG,
  bindMessage,
  canonicalize,
  claimTag,
  createStatement,
  hexToBin,
  binToHex,
  nowSeconds,
  type BindProof,
  type BindStatement,
  type VerifyCode,
} from '@cachet/core';
import { LocalBchSigner, LocalNostrSigner } from '@cachet/signers';

export interface Built {
  event: unknown;
  now: number;
  /** Extra line shown under the verdict, e.g. what a naive verifier said. */
  aside?: string;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  expect: VerifyCode;
  build(): Promise<Built>;
}

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const keys = (secret?: Uint8Array) => {
  const s = secret ?? generateSecretKey();
  return { secret: s, nostr: new LocalNostrSigner(s) };
};

const proofFor = (bch: LocalBchSigner, statement: BindStatement): BindProof => ({
  type: 'bch-nostr-bind/v1',
  statement,
  bch_signature: bch.signRaw(bindMessage(statement)),
});

const snapshot = (secret: Uint8Array, tags: string[][], createdAt = nowSeconds()) =>
  finalizeEvent({ kind: 10011, created_at: createdAt, tags, content: '' }, secret);

const honest = () => {
  const n = keys();
  const bch = LocalBchSigner.generate();
  const now = nowSeconds();
  const statement = createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 });
  const proof = proofFor(bch, statement);
  return { n, bch, now, statement, proof, event: snapshot(n.secret, [claimTag(proof)], now - 30) };
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'valid',
    title: 'Honest binding',
    blurb: 'Both keys sign; nothing touched.',
    expect: 'ok',
    async build() {
      const h = honest();
      return { event: h.event, now: h.now };
    },
  },
  {
    id: 'steal',
    title: 'Claim someone else’s address',
    blurb: 'An attacker names your address but can only sign with their own BCH key.',
    expect: 'signature_invalid',
    async build() {
      const victim = LocalBchSigner.generate();
      const attackerBch = LocalBchSigner.generate();
      const n = keys();
      const now = nowSeconds();
      const statement = createStatement({ cashaddr: victim.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 });
      const proof = proofFor(attackerBch, statement);
      return { event: snapshot(n.secret, [claimTag(proof)], now - 30), now };
    },
  },
  {
    id: 'replay',
    title: 'Replay a proof under another npub',
    blurb: 'Copy a valid BCH proof into the attacker’s own Nostr profile.',
    expect: 'pubkey_mismatch',
    async build() {
      const h = honest();
      const attacker = keys();
      return { event: snapshot(attacker.secret, [claimTag(h.proof)], h.now - 10), now: h.now };
    },
  },
  {
    id: 'legacy30078',
    title: 'Unverified 30078 announcement',
    blurb: 'Announce someone else’s BCH address in kind 30078 with no BCH signature.',
    expect: 'wrong_kind',
    async build() {
      const victim = LocalBchSigner.generate();
      const attacker = keys();
      const now = nowSeconds();
      const event = finalizeEvent(
        { kind: KIND_APP_DATA, created_at: now - 20, tags: [['d', PAYTACA_LEGACY_D_TAG]], content: JSON.stringify({ address: victim.address() }) },
        attacker.secret,
      );
      return {
        event,
        now,
        aside: 'A kind 30078 announcement is only signed by the Nostr key, never by the BCH wallet. Cachet reads it strictly as unverified awareness and requires a dual-signed kind 10011 link before paying or signing in.',
      };
    },
  },
  {
    id: 'edit',
    title: 'Edit after signing',
    blurb: 'Swap the address inside a published event without re-signing it.',
    expect: 'event_id_mismatch',
    async build() {
      const h = honest();
      const other = LocalBchSigner.generate().address();
      const proof = { ...h.proof, statement: { ...h.statement, cashaddr: other } };
      const event = { ...h.event, tags: [['i', `bch:${other}`, canonicalize(proof)]] };
      return { event, now: h.now };
    },
  },
  {
    id: 'cache',
    title: 'Trust a cached check',
    blurb: 'Mutate an event after nostr-tools has verified it once.',
    expect: 'event_id_mismatch',
    async build() {
      const h = honest();
      const other = LocalBchSigner.generate().address();
      verifyEvent(h.event); // caches "valid" on the object
      h.event.tags = [['i', `bch:${other}`, canonicalize({ ...h.proof, statement: { ...h.statement, cashaddr: other } })]];
      const naive = verifyEvent({ ...h.event });
      return { event: h.event, now: h.now, aside: `nostr-tools verifyEvent() on a spread copy still says ${naive}. Cachet rebuilds the event and checks again.` };
    },
  },
  {
    id: 'reuse',
    title: 'One key for both sides',
    blurb: 'Use the same secret as the Nostr key and the BCH key.',
    expect: 'key_reuse',
    async build() {
      const n = keys();
      const bch = new LocalBchSigner(n.secret);
      const now = nowSeconds();
      const statement = createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 });
      return { event: snapshot(n.secret, [claimTag(proofFor(bch, statement))], now - 30), now };
    },
  },
  {
    id: 'mirror',
    title: 'Mirrored key (d and n − d)',
    blurb: 'Different BCH address, same x-only key as the Nostr side.',
    expect: 'key_reuse',
    async build() {
      const n = keys();
      const d = BigInt(`0x${binToHex(n.secret)}`);
      const bch = new LocalBchSigner(hexToBin((N - d).toString(16).padStart(64, '0')));
      const now = nowSeconds();
      const statement = createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 });
      return {
        event: snapshot(n.secret, [claimTag(proofFor(bch, statement))], now - 30),
        now,
        aside: 'Comparing 33-byte keys or addresses would miss this. Cachet compares x-coordinates.',
      };
    },
  },
  {
    id: 'expired',
    title: 'Expired',
    blurb: 'Signed 40 days ago with a 30-day validity.',
    expect: 'expired',
    async build() {
      const n = keys();
      const bch = LocalBchSigner.generate();
      const now = nowSeconds();
      const then = now - 40 * 86400;
      const statement = createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: then, ttlSeconds: 30 * 86400 });
      return { event: snapshot(n.secret, [claimTag(proofFor(bch, statement))], then + 10), now };
    },
  },
  {
    id: 'network',
    title: 'Wrong network',
    blurb: 'A mainnet address in a statement that says chipnet, validly signed.',
    expect: 'network_mismatch',
    async build() {
      const n = keys();
      const bch = LocalBchSigner.generate();
      const now = nowSeconds();
      const statement: BindStatement = { ...createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 }), network: 'chipnet' };
      return { event: snapshot(n.secret, [claimTag(proofFor(bch, statement))], now - 30), now };
    },
  },
  {
    id: 'canonical',
    title: 'Non-canonical proof',
    blurb: 'Same proof, pretty-printed. Two encodings of one claim are not allowed.',
    expect: 'proof_not_canonical',
    async build() {
      const h = honest();
      const tag = ['i', `bch:${h.statement.cashaddr}`, JSON.stringify(h.proof, null, 2)];
      return { event: snapshot(h.n.secret, [tag], h.now - 30), now: h.now };
    },
  },
  {
    id: 'p2sh',
    title: 'Contract address',
    blurb: 'P2SH has no single key, so a message signature cannot prove control.',
    expect: 'unsupported_address_type',
    async build() {
      const n = keys();
      const bch = LocalBchSigner.generate();
      const now = nowSeconds();
      const statement: BindStatement = {
        ...createStatement({ cashaddr: bch.address(), nostrPubkey: n.nostr.pubkey, issuedAt: now - 60 }),
        cashaddr: 'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq',
      };
      return { event: snapshot(n.secret, [claimTag(proofFor(bch, statement))], now - 30), now };
    },
  },
];
