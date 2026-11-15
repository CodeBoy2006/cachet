import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { encodeCashAddress } from '@bitauth/libauth';
import { KIND_APP_DATA, PAYTACA_LEGACY_D_TAG, removeClaimTag, toggleTokenForm, parseCashAddr, type NostrEvent, type ParsedAddress } from '@cachet/core';
import { isPrivateIp, isPublicRelayUrl, lookupIdentity, memoryCache, parseIdentityInput, publishEvent, readPaytacaLegacy, reverseLookup } from '../src/index.ts';
import * as relayClient from '../src/relay.ts';
import { makeBinding, makeIdentity, publishSnapshot } from '../../core/test/helpers.ts';
import { startMockRelay } from './mock-relay.ts';

const relays: Awaited<ReturnType<typeof startMockRelay>>[] = [];
const relay = async (...args: Parameters<typeof startMockRelay>) => {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

const isolated = { timeout: 600, indexers: [] as string[] };

describe('publishEvent', () => {
  it('returns one honest result per relay', async () => {
    const [ok, reject, silent, auth] = await Promise.all([relay(), relay('reject'), relay('silent'), relay('auth')]);
    const b = makeBinding();
    const results = await publishEvent(b.event, [ok.url, reject.url, silent.url, auth.url], { timeout: 400 });
    expect(results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'timeout', 'auth-required']);
    expect(ok.events).toHaveLength(1);
  });
});

describe('lookupIdentity', () => {
  it('finds an active binding and records every relay outcome', async () => {
    const [a, down] = await Promise.all([relay(), relay('close')]);
    const b = makeBinding();
    a.seed(b.event);
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: [a.url, down.url], ...isolated, now: b.now });
    expect(r.resolution.state).toBe('active');
    expect(r.relays.find((x) => x.url === a.url)?.status).toBe('ok');
    expect(r.relays.find((x) => x.url === down.url)?.status).toBe('error');
  });

  it('sees a withdrawal even when another relay still serves the old snapshot', async () => {
    const [fresh, stale] = await Promise.all([relay(), relay()]);
    const b = makeBinding();
    const withdrawn = publishSnapshot(b.id, removeClaimTag(b.event.tags, b.id.cashaddr), b.now + 5);
    stale.seed(b.event);
    fresh.seed(withdrawn);
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: [fresh.url, stale.url], cashaddr: b.id.cashaddr, ...isolated, now: b.now + 10 });
    expect(r.resolution.state).toBe('withdrawn');
  });

  it('does not roll back to an older snapshot already seen in cache', async () => {
    const stale = await relay();
    const b = makeBinding();
    const withdrawn = publishSnapshot(b.id, removeClaimTag(b.event.tags, b.id.cashaddr), b.now + 5);
    stale.seed(b.event);
    const cache = memoryCache();
    cache.put(b.id.nostrPubkey, withdrawn);
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: [stale.url], cache, cashaddr: b.id.cashaddr, ...isolated, now: b.now + 10 });
    expect(r.resolution.state).toBe('withdrawn');
    expect(r.usedCache).toBe(true);
  });

  it('separates not found from relays being unreachable', async () => {
    const [empty, down] = await Promise.all([relay(), relay('close')]);
    const pk = makeIdentity().nostrPubkey;
    expect((await lookupIdentity(pk, { relays: [empty.url], ...isolated })).resolution.state).toBe('not_found');
    expect((await lookupIdentity(pk, { relays: [down.url], ...isolated })).resolution.state).toBe('unavailable');
  });

  it('follows the author’s NIP-65 write relays', async () => {
    const [bootstrap, home] = await Promise.all([relay(), relay()]);
    const b = makeBinding();
    const list = finalizeEvent({ kind: 10002, created_at: b.now, tags: [['r', home.url, 'write']], content: '' }, b.id.nostrSecret);
    bootstrap.seed(list as NostrEvent);
    home.seed(b.event);
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: [bootstrap.url], ...isolated, now: b.now });
    expect(r.relayList.write).toEqual([home.url]);
    expect(r.resolution.state).toBe('active');
  });

  it('ignores events a relay serves for the wrong author', async () => {
    const evil = await relay();
    const b = makeBinding();
    const other = makeBinding();
    evil.seed({ ...other.event, pubkey: b.id.nostrPubkey });
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: [evil.url], ...isolated });
    expect(r.resolution.state).toBe('not_found');
    expect(r.resolution.rejected.length).toBe(1);
  });
});

describe('reverseLookup', () => {
  it('finds claimants by either address form, then resolves each one', async () => {
    const a = await relay();
    const b = makeBinding(makeIdentity({ tokenAware: true }));
    a.seed(b.event);
    const q = toggleTokenForm(parseCashAddr(b.id.cashaddr) as ParsedAddress)!;
    const r = await reverseLookup(q, { relays: [a.url], ...isolated, now: b.now });
    expect(r.candidates).toEqual([b.id.nostrPubkey]);
    expect(r.results[0]?.resolution.state).toBe('active');
  });
});

describe('parseIdentityInput', () => {
  it('understands the common ways people paste an identity', () => {
    const id = makeIdentity();
    expect(parseIdentityInput(id.nostrPubkey)).toMatchObject({ kind: 'pubkey', pubkey: id.nostrPubkey });
    expect(parseIdentityInput(id.cashaddr.split(':')[1]!)).toMatchObject({ kind: 'address', cashaddr: id.cashaddr });
    expect(parseIdentityInput('alice@example.com')).toMatchObject({ kind: 'nip05', name: 'alice' });
    expect(parseIdentityInput('hello')).toMatchObject({ kind: 'invalid' });
  });
});

describe('Paytaca legacy announcements', () => {
  const b = makeBinding();
  const announcement = (content: string, createdAt = b.now, tags = [['d', PAYTACA_LEGACY_D_TAG]]) =>
    finalizeEvent({ kind: KIND_APP_DATA, created_at: createdAt, tags, content }, b.id.nostrSecret);

  it.each(['direct', 'address', 'bchAddress', 'cashaddr', 'paytacaNested'])('reads and normalizes %s content without a BCH proof', (field) => {
    const raw = b.id.cashaddr.toUpperCase();
    const content =
      field === 'direct'
        ? ` ${raw} `
        : field === 'paytacaNested'
          ? JSON.stringify({ name: 'Paytaca BCH Address', data: { address: raw } })
          : JSON.stringify({ [field]: raw });
    const event = announcement(content);
    expect(readPaytacaLegacy([event], b.id.nostrPubkey)).toEqual({ cashaddr: b.id.cashaddr, eventId: event.id, createdAt: b.now });
  });

  it('uses replaceable ordering and ignores forged events, other authors and other d tags', () => {
    const older = announcement(b.id.cashaddr, b.now - 1);
    const newest = announcement(JSON.stringify({ address: b.id.cashaddr }));
    const sibling = announcement(JSON.stringify({ cashaddr: b.id.cashaddr }));
    const winner = [newest, sibling].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    const other = makeIdentity();
    const stranger = finalizeEvent({ kind: KIND_APP_DATA, created_at: b.now + 1, tags: [['d', PAYTACA_LEGACY_D_TAG]], content: other.cashaddr }, other.nostrSecret);
    const wrongTag = announcement(b.id.cashaddr, b.now + 2, [['d', 'another-app']]);
    const forged = { ...newest, created_at: b.now + 3 };
    expect(readPaytacaLegacy([older, sibling, newest, stranger, wrongTag, forged, null], b.id.nostrPubkey)?.eventId).toBe(winner.id);
  });

  it.each([
    'not an address', 'null', '[]', '{', '{}', '{"address":42}',
    encodeCashAddress({ prefix: 'bchreg', type: 'p2pkh', payload: new Uint8Array(20) }).address,
  ])('does not fall back past a newest announcement with unusable content: %s', (content) => {
    expect(readPaytacaLegacy([announcement(b.id.cashaddr, b.now - 1), announcement(content)], b.id.nostrPubkey)).toBeUndefined();
  });

  it('queries legacy on both relay waves and leaves resolution unverified', async () => {
    const home = 'wss://home.example';
    const event = announcement(b.id.cashaddr);
    const list = finalizeEvent({ kind: 10002, created_at: b.now, tags: [['r', home, 'write']], content: '' }, b.id.nostrSecret);
    const query = vi.spyOn(relayClient, 'queryRelay').mockImplementation(async (url) => ({ url, status: 'ok', ms: 1, events: url === home ? [event] : [list] }));
    const r = await lookupIdentity(b.id.nostrPubkey, { relays: ['wss://bootstrap.example'], ...isolated, now: b.now });
    expect(r.resolution.state).toBe('not_found');
    expect(r.resolution.primary).toBeUndefined();
    expect(r.legacy?.cashaddr).toBe(b.id.cashaddr);
    for (const url of ['wss://bootstrap.example', home]) {
      expect(query).toHaveBeenCalledWith(url, expect.arrayContaining([
        { authors: [b.id.nostrPubkey], kinds: [KIND_APP_DATA], '#d': [PAYTACA_LEGACY_D_TAG], limit: 2 },
      ]), { timeout: isolated.timeout });
    }
  });

  it('suppresses legacy whenever a current snapshot exists, including a cached withdrawal', async () => {
    const event = announcement(b.id.cashaddr);
    const withdrawn = publishSnapshot(b.id, [], b.now + 1);
    vi.spyOn(relayClient, 'queryRelay').mockResolvedValue({ url: 'wss://test', status: 'ok', ms: 1, events: [event] });
    for (const snapshot of [b.event, withdrawn]) {
      const cache = memoryCache();
      cache.put(b.id.nostrPubkey, snapshot);
      const r = await lookupIdentity(b.id.nostrPubkey, { relays: ['wss://test.example'], cache, ...isolated, now: b.now + 2 });
      expect(r.resolution.latest?.id).toBe(snapshot.id);
      expect(r.legacy).toBeUndefined();
    }
  });
});

describe('relay egress safety', () => {
  it('blocks loopback, RFC1918, link-local, cleartext ws:// and IPv6 literals from untrusted NIP-65 lists', async () => {
    expect(isPublicRelayUrl('wss://relay.damus.io')).toBe(true);
    expect(isPublicRelayUrl('ws://relay.damus.io')).toBe(false);
    expect(isPublicRelayUrl('wss://localhost:8080')).toBe(false);
    expect(isPublicRelayUrl('wss://127.0.0.1:8080')).toBe(false);
    expect(isPublicRelayUrl('wss://169.254.169.254/latest')).toBe(false);
    expect(isPublicRelayUrl('wss://192.168.1.1')).toBe(false);
    expect(isPublicRelayUrl('wss://[::1]:8080')).toBe(false);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
    expect(isPrivateIp('fd00::1')).toBe(true);
    expect(isPrivateIp('1.1.1.1')).toBe(false);

    const b = makeBinding();
    const list = finalizeEvent(
      {
        kind: 10002,
        created_at: b.now,
        tags: [
          ['r', 'ws://127.0.0.1:8080/internal', 'write'],
          ['r', 'wss://169.254.169.254/latest', 'write'],
          ['r', 'wss://192.168.1.1/admin', 'write'],
          ['r', 'wss://good-home.example', 'write'],
        ],
        content: '',
      },
      b.id.nostrSecret,
    );
    const seen: string[] = [];
    vi.spyOn(relayClient, 'queryRelay').mockImplementation(async (url) => {
      seen.push(url);
      return { url, status: 'ok', ms: 1, events: url === 'wss://bootstrap.example' ? [list] : [b.event] };
    });
    const r = await lookupIdentity(b.id.nostrPubkey, {
      relays: ['wss://bootstrap.example'],
      hints: ['ws://10.0.0.1:9000'],
      ...isolated,
      now: b.now,
    });
    expect(seen).toEqual(['wss://bootstrap.example', 'wss://good-home.example']);
    expect(r.resolution.state).toBe('active');
  });
});
