import { describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import {
  addressFromPublicKey,
  buildAuthTemplate,
  claimTag,
  decodeAuthHeader,
  encodeAuthHeader,
  removeClaimTag,
  resolveSnapshots,
  serializeProof,
  verifyAuthEvent,
  type NostrEvent,
} from '../src/index.ts';
import { makeBinding, makeIdentity, publishSnapshot } from './helpers.ts';

const at = (event: NostrEvent, relay = 'wss://a') => ({ event, relay });

describe('resolveSnapshots', () => {
  it('reads the newest snapshot and reports where it was seen', () => {
    const b = makeBinding();
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event, 'wss://a'), at(b.event, 'wss://b')], reachable: true, now: b.now });
    expect(r.state).toBe('active');
    expect(r.primary?.cashaddr).toBe(b.id.cashaddr);
    expect(r.snapshots[0]?.relays.sort()).toEqual(['wss://a', 'wss://b']);
  });

  it('detects withdrawal from an older snapshot that still had the claim', () => {
    const b = makeBinding();
    const withdrawn = publishSnapshot(b.id, removeClaimTag(b.event.tags, b.id.cashaddr), b.now + 10);
    const r = resolveSnapshots({
      pubkey: b.id.nostrPubkey,
      events: [at(b.event, 'wss://stale'), at(withdrawn, 'wss://fresh')],
      reachable: true,
      now: b.now + 20,
      cashaddr: b.id.cashaddr,
    });
    expect(r.state).toBe('withdrawn');
    expect(r.primary?.withdrawnBy).toBe(withdrawn.id);
    expect(r.latest?.id).toBe(withdrawn.id);
  });

  it('never falls back to an older valid claim when the newest one is broken', () => {
    const b = makeBinding();
    const broken = JSON.parse(serializeProof(b.proof));
    broken.bch_signature = broken.bch_signature.replace(/^./, (c: string) => (c === 'I' ? 'H' : 'I'));
    const newer = publishSnapshot(b.id, [['i', `bch:${b.id.cashaddr}`, JSON.stringify(broken).replace(/\s/g, '')]], b.now + 10);
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event), at(newer)], reachable: true, now: b.now + 20 });
    expect(r.state).toBe('invalid');
    expect(r.primary?.eventId).toBe(newer.id);
  });

  it('reports expiry from the newest snapshot', () => {
    const b = makeBinding(makeIdentity(), { ttl: 100 });
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event)], reachable: true, now: b.now + 1000 });
    expect(r.state).toBe('expired');
  });

  it('breaks timestamp ties by lowest id (NIP-01)', () => {
    const b = makeBinding();
    const sibling = publishSnapshot(b.id, [...b.event.tags, ['i', 'github:alice', 'x']], b.now);
    const expected = [b.event, sibling].sort((x, y) => (x.id < y.id ? -1 : 1))[0]!;
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(sibling), at(b.event)], reachable: true, now: b.now });
    expect(r.latest?.id).toBe(expected.id);
  });

  it('ignores other authors, other kinds and forged events', () => {
    const b = makeBinding();
    const stranger = makeBinding();
    const forged = { ...b.event, created_at: b.now + 99 };
    const meta = finalizeEvent({ kind: 0, created_at: b.now + 50, tags: [], content: '{}' }, b.id.nostrSecret);
    const r = resolveSnapshots({
      pubkey: b.id.nostrPubkey,
      events: [at(b.event), at(stranger.event), at(forged), at(meta as NostrEvent), { event: 'garbage' }],
      reachable: true,
      now: b.now,
    });
    expect(r.state).toBe('active');
    expect(r.latest?.id).toBe(b.event.id);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['bad signature', 'different author', 'kind 0', 'not JSON']);
  });

  it('distinguishes not found from unavailable, even when a cached snapshot is supplied', () => {
    const pubkey = makeIdentity().nostrPubkey;
    expect(resolveSnapshots({ pubkey, events: [], reachable: true }).state).toBe('not_found');
    expect(resolveSnapshots({ pubkey, events: [], reachable: false }).state).toBe('unavailable');
    const b = makeBinding();
    const offline = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event, 'cache')], reachable: false, now: b.now });
    expect(offline.state).toBe('unavailable');
    expect(offline.latest?.id).toBe(b.event.id);
    expect(offline.primary?.cashaddr).toBe(b.id.cashaddr);
  });

  it('keeps other NIP-39 identities visible', () => {
    const b = makeBinding(makeIdentity(), { existing: [['i', 'github:alice', 'abc']] });
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event)], reachable: true, now: b.now });
    expect(r.otherIdentities).toEqual(['github:alice']);
  });

  it('matches a lookup by the other address form of the same key', () => {
    const b = makeBinding(makeIdentity({ tokenAware: true }));
    const plain = addressFromPublicKey(b.id.bchPublic, 'mainnet');
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event)], reachable: true, now: b.now, cashaddr: plain });
    expect(r.state).toBe('active');
    expect(plain).not.toBe(b.id.cashaddr);
  });

  it('prefers an active token-aware replacement over the withdrawn plain address', () => {
    const b = makeBinding();
    const newer = makeBinding({ ...b.id, cashaddr: addressFromPublicKey(b.id.bchPublic, 'mainnet', true) }, { now: b.now + 10 });
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [at(b.event), at(newer.event)], reachable: true, now: newer.now, cashaddr: b.id.cashaddr });
    expect(r.state).toBe('active');
    expect(r.primary?.cashaddr).toBe(newer.id.cashaddr);
    expect(r.primary?.eventId).toBe(newer.event.id);
  });
});

describe('NIP-98 login events', () => {
  const url = 'https://rp-a.example/api/verify';
  const body = JSON.stringify({ challenge_id: 'c1', nonce: 'ab'.repeat(32) });
  const signer = makeIdentity();
  const now = Math.floor(Date.now() / 1000);
  const signed = finalizeEvent(buildAuthTemplate({ url, method: 'post', body, createdAt: now }), signer.nostrSecret) as NostrEvent;

  it('round-trips the Authorization header and verifies', () => {
    const decoded = decodeAuthHeader(encodeAuthHeader(signed));
    expect(verifyAuthEvent(decoded, { url, method: 'POST', body, now, pubkey: signer.nostrPubkey }).ok).toBe(true);
  });

  it('rejects every mismatch with its own code', () => {
    const base = { url, method: 'POST', body, now, pubkey: signer.nostrPubkey };
    expect(verifyAuthEvent(signed, { ...base, url: 'https://rp-b.example/api/verify' })).toMatchObject({ code: 'auth_url_mismatch' });
    expect(verifyAuthEvent(signed, { ...base, method: 'GET' })).toMatchObject({ code: 'auth_method_mismatch' });
    expect(verifyAuthEvent(signed, { ...base, body: body.replace('c1', 'c2') })).toMatchObject({ code: 'auth_payload_mismatch' });
    expect(verifyAuthEvent(signed, { ...base, now: now + 120 })).toMatchObject({ code: 'auth_stale' });
    expect(verifyAuthEvent(signed, { ...base, pubkey: makeIdentity().nostrPubkey })).toMatchObject({ code: 'auth_pubkey_mismatch' });
    expect(verifyAuthEvent({ ...signed, tags: [['u', url]] }, base)).toMatchObject({ code: 'auth_signature_invalid' });
    const noPayload = finalizeEvent({ kind: 27235, created_at: now, tags: [['u', url], ['method', 'POST']], content: '' }, signer.nostrSecret);
    expect(verifyAuthEvent(noPayload, base)).toMatchObject({ code: 'auth_payload_mismatch' });
    const binding = makeBinding();
    expect(verifyAuthEvent(binding.event, base)).toMatchObject({ code: 'auth_kind' });
    expect(claimTag(binding.proof)[0]).toBe('i');
  });
});
