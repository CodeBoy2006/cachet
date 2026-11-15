import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import {
  addressFromPublicKey,
  bindMessage,
  canonicalize,
  claimTag,
  createStatement,
  findBchClaims,
  isOnlyExpired,
  parseCashAddr,
  serializeProof,
  signMessage,
  toggleTokenForm,
  upsertClaimTag,
  verifyBinding,
  verifySnapshot,
  type BindStatement,
  type ParsedAddress,
} from '../src/index.ts';
import { makeBinding, makeIdentity, negatePrivateKey, publishSnapshot, signProof } from './helpers.ts';

const failing = (r: ReturnType<typeof verifyBinding>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.code);

/** Re-sign a modified claim with the real Nostr key, so only the inner proof is wrong. */
const resignWithProof = (b: ReturnType<typeof makeBinding>, proofJson: string, identity = `bch:${b.statement.cashaddr}`) =>
  publishSnapshot(b.id, [['i', identity, proofJson]], b.now);

describe('verifyBinding: valid bindings', () => {
  it('accepts a fresh binding and reports every check', () => {
    const b = makeBinding();
    const r = verifyBinding(b.event, { now: b.now });
    expect(r.ok).toBe(true);
    expect(r.code).toBe('ok');
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(r.binding?.cashaddr).toBe(b.id.cashaddr);
    expect(r.binding?.nostrPubkey).toBe(b.id.nostrPubkey);
    expect(r.binding?.bindingId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts JSON string input and token-aware addresses', () => {
    const b = makeBinding(makeIdentity({ tokenAware: true }));
    const r = verifyBinding(JSON.stringify(b.event), { now: b.now });
    expect(r.ok).toBe(true);
    expect(r.binding?.tokenAware).toBe(true);
  });

  it('signs the documented three-line message', () => {
    const b = makeBinding();
    const lines = bindMessage(b.statement).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('BCH-NOSTR-ID/v1');
    expect(lines[1]).toMatch(/^Verifying that I control the following Nostr public key: npub1[0-9a-z]+$/);
    expect(lines[2]).toBe(canonicalize(b.statement));
  });

  it('keeps unrelated NIP-39 claims in the snapshot', () => {
    const b = makeBinding(makeIdentity(), { existing: [['i', 'github:alice', 'gistid']] });
    expect(b.event.tags[0]).toEqual(['i', 'github:alice', 'gistid']);
    expect(verifyBinding(b.event, { now: b.now }).ok).toBe(true);
  });
});

describe('verifyBinding: tampering', () => {
  const tamperStatement = (patch: Partial<BindStatement>, resignBch = false) => {
    const b = makeBinding();
    const statement = { ...b.statement, ...patch } as BindStatement;
    const proof = resignBch ? signProof(b.id, statement) : { ...b.proof, statement };
    return { b, r: verifyBinding(resignWithProof(b, serializeProof(proof), `bch:${statement.cashaddr}`), { now: b.now }) };
  };

  it('rejects someone else’s address (no matching BCH signature)', () => {
    const victim = makeIdentity();
    expect(failing(tamperStatement({ cashaddr: victim.cashaddr }).r)).toEqual(['signature_invalid']);
  });

  it('rejects a changed nonce, network, or expiry', () => {
    expect(tamperStatement({ nonce: 'ab'.repeat(32) }).r.code).toBe('signature_invalid');
    expect(tamperStatement({ expires_at: 9_999_999_999 }).r.code).toBe('signature_invalid');
    expect(tamperStatement({ network: 'chipnet' }).r.code).toBe('network_mismatch');
  });

  it('rejects a binding replayed under another npub', () => {
    const b = makeBinding();
    const thief = makeIdentity();
    const stolen = publishSnapshot(thief, [claimTag(b.proof)], b.now);
    expect(verifyBinding(stolen, { now: b.now }).code).toBe('pubkey_mismatch');
  });

  it('rejects a tag that names a different address than the statement', () => {
    const b = makeBinding();
    const other = makeIdentity();
    const r = verifyBinding(resignWithProof(b, serializeProof(b.proof), `bch:${other.cashaddr}`), { now: b.now });
    expect(r.code).toBe('address_mismatch');
  });

  it('rejects edits to the outer event', () => {
    const b = makeBinding();
    expect(verifyBinding({ ...b.event, content: 'x' }, { now: b.now }).code).toBe('event_id_mismatch');
    const flipped = b.event.sig.slice(0, -1) + (b.event.sig.endsWith('0') ? '1' : '0');
    expect(verifyBinding({ ...b.event, sig: flipped }, { now: b.now }).code).toBe('event_signature_invalid');
    expect(verifyBinding({ ...b.event, kind: 30078 }, { now: b.now }).code).toBe('wrong_kind');
    expect(verifyBinding({ ...b.event, created_at: '1' }, { now: b.now }).code).toBe('malformed_event');
  });

  it('cannot be fooled by nostr-tools’ verification cache', () => {
    const b = makeBinding();
    const cached = finalizeEvent({ kind: 10011, created_at: b.now, tags: b.event.tags, content: '' }, b.id.nostrSecret);
    expect(verifyEvent(cached)).toBe(true);
    const thief = makeIdentity();
    cached.tags = [['i', `bch:${thief.cashaddr}`, serializeProof(b.proof)]];
    const shallow = { ...cached };
    expect(verifyEvent(cached)).toBe(true); // cached: still "valid"
    expect(verifyEvent(shallow)).toBe(true); // spread copies the cache
    expect(verifyBinding(cached, { now: b.now }).code).toBe('event_id_mismatch');
    expect(verifyBinding(shallow, { now: b.now }).code).toBe('event_id_mismatch');
  });

  it('rejects a flipped bit in the BCH signature', () => {
    const b = makeBinding();
    const sig = b.proof.bch_signature;
    const bad = { ...b.proof, bch_signature: sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11) };
    expect(['signature_invalid', 'bch_signature_malformed']).toContain(
      verifyBinding(resignWithProof(b, serializeProof(bad)), { now: b.now }).code,
    );
  });
});

describe('verifyBinding: encoding strictness', () => {
  it('rejects non-canonical proof JSON (whitespace, order, duplicate keys)', () => {
    const b = makeBinding();
    const pretty = JSON.stringify(b.proof, null, 1);
    expect(verifyBinding(resignWithProof(b, pretty), { now: b.now }).code).toBe('proof_not_canonical');
    const canonical = serializeProof(b.proof);
    const dup = canonical.replace('{"bch_signature"', '{"bch_signature":"x","bch_signature"');
    expect(verifyBinding(resignWithProof(b, dup), { now: b.now }).code).toBe('proof_not_canonical');
  });

  it('rejects unknown fields, wrong versions and millisecond timestamps', () => {
    const b = makeBinding();
    const extra = { ...b.proof, statement: { ...b.statement, note: 'hi' } };
    expect(verifyBinding(resignWithProof(b, canonicalize(extra)), { now: b.now }).code).toBe('proof_malformed');
    const v2 = { ...b.proof, statement: { ...b.statement, version: 2 } };
    expect(verifyBinding(resignWithProof(b, canonicalize(v2)), { now: b.now }).code).toBe('unsupported_profile');
    const ms = { ...b.proof, statement: { ...b.statement, issued_at: b.now * 1000, expires_at: b.now * 1000 + 1 } };
    expect(verifyBinding(resignWithProof(b, canonicalize(ms)), { now: b.now }).code).toBe('proof_malformed');
    const typo = { ...b.proof, type: 'bch-nostr-bind/v2' };
    expect(verifyBinding(resignWithProof(b, canonicalize(typo)), { now: b.now }).code).toBe('unsupported_profile');
  });

  it('rejects uppercase or P2SH addresses in the statement', () => {
    const b = makeBinding();
    const upper = { ...b.statement, cashaddr: b.statement.cashaddr.toUpperCase() };
    const r = verifyBinding(resignWithProof(b, canonicalize({ ...b.proof, statement: upper }), `bch:${upper.cashaddr}`), {
      now: b.now,
    });
    expect(failing(r)).toContain('address_invalid');
    const p2sh = 'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq';
    const st = { ...b.statement, cashaddr: p2sh };
    const r2 = verifyBinding(resignWithProof(b, canonicalize(signProof(b.id, st)), `bch:${p2sh}`), { now: b.now });
    expect(r2.code).toBe('unsupported_address_type');
    expect(() => createStatement({ cashaddr: p2sh, nostrPubkey: b.id.nostrPubkey })).toThrow();
  });
});

describe('verifyBinding: time and keys', () => {
  it('reports expiry separately from forgery', () => {
    const b = makeBinding(makeIdentity(), { ttl: 60 });
    const r = verifyBinding(b.event, { now: b.now + 3600 });
    expect(r.code).toBe('expired');
    expect(isOnlyExpired(r)).toBe(true);
    expect(r.checks.find((c) => c.id === 'bch_signature')?.status).toBe('pass');
  });

  it('rejects statements and events from the future', () => {
    const b = makeBinding();
    expect(verifyBinding(b.event, { now: b.now - 3600 }).code).toBe('not_yet_valid');
    const late = makeBinding(makeIdentity(), { statement: { issued_at: Math.floor(Date.now() / 1000) + 3600 } });
    expect(verifyBinding(late.event, { now: late.now }).code).toBe('not_yet_valid');
  });

  it('rejects one key used on both sides, including the d / n−d twin', () => {
    const same = makeBinding(makeIdentity({ sameKey: true }));
    expect(verifyBinding(same.event, { now: same.now }).code).toBe('key_reuse');

    // BCH key = n − d of the Nostr key: same x-only key, different compressed key.
    const base = makeIdentity();
    const negated = negatePrivateKey(base.nostrSecret);
    const bchPublic = secp256k1.derivePublicKeyCompressed(negated) as Uint8Array;
    expect(bchPublic.slice(1)).toEqual((secp256k1.derivePublicKeyCompressed(base.nostrSecret) as Uint8Array).slice(1));
    const twin = { ...base, bchPrivate: negated, bchPublic, cashaddr: addressFromPublicKey(bchPublic, 'mainnet') };
    expect(twin.cashaddr).not.toBe(addressFromPublicKey(base.bchPublic, 'mainnet'));
    const r = verifyBinding(makeBinding(twin).event, { now: Math.floor(Date.now() / 1000) });
    expect(r.code).toBe('key_reuse');
  });
});

describe('verifySnapshot and claim selection', () => {
  it('verifies several BCH claims independently and requires a choice', () => {
    const id = makeIdentity();
    const a = makeBinding(id);
    const second = { ...makeIdentity(), nostrSecret: id.nostrSecret, nostrPubkey: id.nostrPubkey };
    const st2 = createStatement({ cashaddr: second.cashaddr, nostrPubkey: id.nostrPubkey, issuedAt: a.now - 5 });
    const tags = upsertClaimTag(a.event.tags, claimTag({ type: 'bch-nostr-bind/v1', statement: st2, bch_signature: signMessage(second.bchPrivate, bindMessage(st2)) }));
    const event = publishSnapshot(id, tags, a.now);
    expect(verifyBinding(event, { now: a.now }).code).toBe('claim_ambiguous');
    expect(verifyBinding(event, { now: a.now, cashaddr: second.cashaddr }).ok).toBe(true);
    const all = verifySnapshot(event, { now: a.now });
    expect(all.claims.map((c) => c.ok)).toEqual([true, true]);
    expect(findBchClaims(event.tags)).toHaveLength(2);
  });

  it('selects by q-form or z-form only when the claim uses that exact form', () => {
    const b = makeBinding();
    const z = toggleTokenForm(parseCashAddr(b.id.cashaddr) as ParsedAddress)!;
    expect(verifyBinding(b.event, { now: b.now, cashaddr: b.id.cashaddr.toUpperCase() }).ok).toBe(true);
    expect(verifyBinding(b.event, { now: b.now, cashaddr: z }).code).toBe('claim_missing');
  });
});
