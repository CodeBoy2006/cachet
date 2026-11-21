import { describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { buildAuthTemplate, encodeAuthHeader, npubEncode, resolveSnapshots, type NostrEvent } from '@cachet/core';
import { makeBinding, makeIdentity } from '../../../packages/core/test/helpers.ts';
import { BRANDS } from '../shared/brands.ts';
import { createApp, type ResolvedBinding } from './app.ts';
import { createGateway } from './gateway.ts';

const ORIGIN = 'http://localhost:5174';

const setup = (state: 'active' | 'withdrawn' = 'active', brand = BRANDS.a) => {
  const b = makeBinding();
  let t = b.now;
  let current: ResolvedBinding;
  const fromResolution = (): ResolvedBinding => {
    const r = resolveSnapshots({ pubkey: b.id.nostrPubkey, events: [{ event: b.event }], reachable: true, now: t });
    const bind = r.primary!.result!.binding!;
    return { state: r.state, cashaddr: bind.cashaddr, bindingId: bind.bindingId, snapshotId: bind.eventId, expiresAt: bind.expiresAt, relays: [{ url: 'wss://x', status: 'ok', ms: 1 }] };
  };
  current = state === 'active' ? fromResolution() : { state: 'withdrawn', relays: [] };
  const app = createApp({ brand, origin: `http://localhost:${brand.uiPort}`, resolve: async () => current, now: () => t });
  return { b, app, setResolved: (r: ResolvedBinding) => (current = r), fromResolution, setNow: (now: number) => (t = now) };
};

const cookieOf = (res: Response, name: string) => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return raw ? raw.split(';')[0]! : '';
};

const challenge = async (app: ReturnType<typeof createApp>, pubkey: string, cookie = '', brandId: 'a' | 'b' = 'a') => {
  const res = await app.request('/api/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ pubkey }),
  });
  return { res, json: (await res.json()) as Record<string, any>, cookie: cookieOf(res, `rp_${brandId}_pre`) || cookie };
};

const signedVerify = (secret: Uint8Array, body: string, url = `${ORIGIN}/api/verify`) =>
  encodeAuthHeader(finalizeEvent(buildAuthTemplate({ url, method: 'POST', body }), secret) as NostrEvent);

const verify = async (app: ReturnType<typeof createApp>, cookie: string, body: string, auth: string): Promise<Response> =>
  app.request('/api/verify', { method: 'POST', headers: { cookie, authorization: auth, 'content-type': 'application/json' }, body });

const signIn = async (app: ReturnType<typeof createApp>, b: ReturnType<typeof makeBinding>, brandId: 'a' | 'b' = 'a', cookie = '') => {
  const ch = await challenge(app, b.id.nostrPubkey, cookie, brandId);
  const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
  const res = await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body, ch.json.url));
  expect(res.status).toBe(200);
  return cookieOf(res, `rp_${brandId}_sid`);
};

describe('relying party login', () => {
  it('signs in with a fresh challenge and creates its own session', async () => {
    const { b, app } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    expect(ch.json.ok).toBe(true);
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
    const res = await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body));
    const json = (await res.json()) as Record<string, any>;
    expect(json.ok).toBe(true);
    expect(json.session.cashaddr).toBe(b.id.cashaddr);
    const sid = cookieOf(res, 'rp_a_sid');
    expect(sid).toMatch(/^rp_a_sid=/);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('rp_a_sid='))).toMatch(/HttpOnly/);
    const me = await app.request('/api/session', { headers: { cookie: sid } });
    expect(me.status).toBe(200);
  });

  it('refuses an npub without an active link before issuing a challenge', async () => {
    const { b, app } = setup('withdrawn');
    const ch = await challenge(app, b.id.nostrPubkey);
    expect(ch.res.status).toBe(403);
    expect(ch.json.code).toBe('binding_inactive');
  });

  it('accepts a replayed request at most once, even concurrently', async () => {
    const { b, app } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
    const auth = signedVerify(b.id.nostrSecret, body);
    const results = await Promise.all(Array.from({ length: 5 }, () => verify(app, ch.cookie, body, auth).then((r: Response) => r.json() as Promise<Record<string, any>>)));
    expect(results.filter((r: Record<string, any>) => r.ok)).toHaveLength(1);
    expect(results.filter((r: Record<string, any>) => r.code === 'challenge_used')).toHaveLength(4);
  });

  it('rejects wrong URL, body, key or browser session without burning the challenge', async () => {
    const { b, app } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
    const code = async (r: Response) => ((await r.json()) as Record<string, any>).code;

    expect(await code(await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body, 'http://localhost:5175/api/verify')))).toBe('auth_url_mismatch');
    expect(await code(await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body.replace('}', ',"x":1}'))))).toBe('auth_payload_mismatch');
    expect(await code(await verify(app, ch.cookie, body, signedVerify(makeIdentity().nostrSecret, body)))).toBe('auth_pubkey_mismatch');
    expect(await code(await verify(app, 'rp_a_pre=' + 'ab'.repeat(16), body, signedVerify(b.id.nostrSecret, body)))).toBe('session_mismatch');
    expect(await code(await verify(app, ch.cookie, body, ''))).toBe('auth_missing');

    const ok = await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body));
    expect(((await ok.json()) as Record<string, any>).ok).toBe(true);
  });

  it('rejects a mismatched nonce and expired challenges', async () => {
    const b = makeBinding();
    let t = Math.floor(Date.now() / 1000);
    const resolved: ResolvedBinding = { state: 'active', cashaddr: b.id.cashaddr, bindingId: 'f'.repeat(64), snapshotId: b.event.id, expiresAt: t + 999, relays: [] };
    const app = createApp({ brand: BRANDS.a, origin: ORIGIN, resolve: async () => resolved, now: () => t });
    const ch = await challenge(app, b.id.nostrPubkey);
    const wrongNonce = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: '00'.repeat(32), binding_id: 'f'.repeat(64) });
    const r1 = await verify(app, ch.cookie, wrongNonce, signedVerify(b.id.nostrSecret, wrongNonce));
    expect(((await r1.json()) as Record<string, any>).code).toBe('challenge_unknown');
    t += 200;
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: 'f'.repeat(64) });
    const auth = encodeAuthHeader(finalizeEvent(buildAuthTemplate({ url: `${ORIGIN}/api/verify`, method: 'POST', body, createdAt: t }), b.id.nostrSecret) as NostrEvent);
    const r2 = await verify(app, ch.cookie, body, auth);
    expect(((await r2.json()) as Record<string, any>).code).toBe('challenge_expired');
  });

  it('ends the session when a re-check finds the link withdrawn', async () => {
    const { b, app, setResolved } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    const vid = cookieOf(ch.res, 'rp_a_vid');
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
    const res = await verify(app, `${ch.cookie}; ${vid}`, body, signedVerify(b.id.nostrSecret, body));
    const sid = cookieOf(res, 'rp_a_sid');
    setResolved({ state: 'withdrawn', relays: [] });
    const re = (await (await app.request('/api/session/recheck', { method: 'POST', headers: { cookie: `${sid}; ${vid}` } })).json()) as Record<string, any>;
    expect(re.revoked).toBe(true);
    expect((await app.request('/api/session', { headers: { cookie: sid } })).status).toBe(401);
    const log = (await (await app.request('/api/log', { headers: { cookie: vid } })).json()) as { code?: string; text: string }[];
    expect(log[0]?.code).toBe('binding_inactive');
    expect(log.map((e) => e.text)).toContain(`Signature valid for ${npubEncode(b.id.nostrPubkey).slice(0, 12)}…; looking up its BCH link`);
  });

  it('shows each browser only its own log entries', async () => {
    const { b, app } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    const vid = cookieOf(ch.res, 'rp_a_vid');
    expect(vid).toMatch(/^rp_a_vid=[0-9a-f]{32}$/);
    const mine = (await (await app.request('/api/log', { headers: { cookie: vid } })).json()) as unknown[];
    expect(mine.length).toBeGreaterThan(0);
    const other = await app.request('/api/log');
    expect(await other.json()).toEqual([]);
    expect(cookieOf(other, 'rp_a_vid')).not.toBe(vid);
  });

  it('keeps an active session when relays are temporarily unreachable during re-check', async () => {
    const { b, app, setResolved } = setup();
    const sid = await signIn(app, b);
    setResolved({ state: 'unavailable', relays: [{ url: 'wss://x', status: 'timeout', ms: 4000 }] });
    const res = await app.request('/api/session/recheck', { method: 'POST', headers: { cookie: sid } });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, revoked: false, state: 'unavailable' });
    expect((await app.request('/api/session', { headers: { cookie: sid } })).status).toBe(200);
  });

  it('supports open challenges for redirect sign-in and resolves the key after the signature', async () => {
    const { b, app } = setup();
    const res = await app.request('/api/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const ch = (await res.json()) as Record<string, any>;
    const cookie = cookieOf(res, 'rp_a_pre');
    expect(ch.binding).toBeUndefined();
    const body = JSON.stringify({ challenge_id: ch.challenge_id, nonce: ch.nonce });
    const auth = signedVerify(b.id.nostrSecret, body);
    const ok = (await (await verify(app, cookie, body, auth)).json()) as Record<string, any>;
    expect(ok.ok).toBe(true);
    expect(ok.session.pubkey).toBe(b.id.nostrPubkey);
    const replay = (await (await verify(app, cookie, body, auth)).json()) as Record<string, any>;
    expect(replay.code).toBe('challenge_used');
  });

  it('rejects an open-challenge login from a key without an active link', async () => {
    const { b, app } = setup('withdrawn');
    const res = await app.request('/api/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const ch = (await res.json()) as Record<string, any>;
    const body = JSON.stringify({ challenge_id: ch.challenge_id, nonce: ch.nonce });
    const out = await verify(app, cookieOf(res, 'rp_a_pre'), body, signedVerify(b.id.nostrSecret, body));
    expect(out.status).toBe(403);
    expect(((await out.json()) as Record<string, any>).code).toBe('binding_inactive');
  });

  it('isolates Fieldnote and Stall cookies on the same host', async () => {
    const a = setup();
    const b = setup('active', BRANDS.b);
    const preA = await challenge(a.app, a.b.id.nostrPubkey);
    const preB = await challenge(b.app, b.b.id.nostrPubkey, preA.cookie, 'b');
    expect(preA.cookie).toMatch(/^rp_a_pre=/);
    expect(preB.cookie).toMatch(/^rp_b_pre=/);
    const cookies = `${preA.cookie}; ${preB.cookie}`;
    const sidA = await signIn(a.app, a.b, 'a', cookies);
    const sidB = await signIn(b.app, b.b, 'b', cookies);
    expect(sidA).toMatch(/^rp_a_sid=/);
    expect(sidB).toMatch(/^rp_b_sid=/);
    for (const app of [a.app, b.app]) {
      expect((await app.request('/api/session', { headers: { cookie: `${sidA}; ${sidB}` } })).status).toBe(200);
    }
    expect((await a.app.request('/api/session', { headers: { cookie: sidB } })).status).toBe(401);
    expect((await b.app.request('/api/session', { headers: { cookie: sidA } })).status).toBe(401);
  });

  it.each(['withdrawn', 'expired', 'address changed'] as const)('rejects a binding that became %s after challenge issuance', async (change) => {
    const { b, app, setResolved, fromResolution } = setup();
    const ch = await challenge(app, b.id.nostrPubkey);
    const binding = fromResolution();
    setResolved(change === 'withdrawn' ? { state: 'withdrawn', relays: [] }
      : change === 'expired' ? { ...binding, expiresAt: b.now }
      : { ...binding, cashaddr: makeIdentity().cashaddr });
    const body = JSON.stringify({ challenge_id: ch.json.challenge_id, nonce: ch.json.nonce, binding_id: ch.json.binding.binding_id });
    const res = await verify(app, ch.cookie, body, signedVerify(b.id.nostrSecret, body));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: 'binding_inactive' });
    expect(cookieOf(res, 'rp_a_sid')).toBe('');
  });

  it.each(['/api/challenge', '/api/verify'])('rejects non-object JSON at %s with 400', async (path) => {
    const { app } = setup();
    for (const body of ['null', '[]', '42', '"text"', '{']) {
      const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'auth_malformed' });
    }
  });

  it('serves article bodies only while a member session is valid', async () => {
    const { b, app, setResolved } = setup();
    const notes = async (cookie = '') => (await (await app.request('/api/notes', { headers: { cookie } })).json()) as { locked: boolean; notes: { id: string; preview: string; body?: string }[] };
    const locked = await notes();
    expect(locked.locked).toBe(true);
    expect(locked.notes).toHaveLength(3);
    expect(locked.notes.every((n) => !('body' in n) && n.id && n.preview)).toBe(true);
    const sid = await signIn(app, b);
    const unlocked = await notes(sid);
    expect(unlocked.locked).toBe(false);
    expect(unlocked.notes.every((n) => typeof n.body === 'string' && n.body.length > 0)).toBe(true);
    setResolved({ state: 'withdrawn', relays: [] });
    await app.request('/api/session/recheck', { method: 'POST', headers: { cookie: sid } });
    expect(await notes(sid)).toEqual(locked);
  });

  it('ends access when the binding expires, without waiting for recheck', async () => {
    const { b, app, setNow, setResolved, fromResolution } = setup();
    setResolved({ ...fromResolution(), expiresAt: b.now + 20 });
    const sid = await signIn(app, b);
    setNow(b.now + 20);
    expect((await app.request('/api/session', { headers: { cookie: sid } })).status).toBe(401);
    const notes = await app.request('/api/notes', { headers: { cookie: sid } });
    expect(await notes.json()).toMatchObject({ locked: true });
  });

  it('scopes Stall payouts per seller, resolves ?seller= live from relays, and blocks checkout immediately on withdrawal', async () => {
    const alice = makeBinding();
    const bob = makeBinding();
    const table = new Map<string, ResolvedBinding>(
      [alice, bob].map((x) => {
        const r = resolveSnapshots({ pubkey: x.id.nostrPubkey, events: [{ event: x.event }], reachable: true, now: x.now });
        const bind = r.primary!.result!.binding!;
        return [
          x.id.nostrPubkey,
          { state: r.state, cashaddr: bind.cashaddr, bindingId: bind.bindingId, snapshotId: bind.eventId, expiresAt: bind.expiresAt, relays: [] },
        ];
      }),
    );
    const app = createApp({ brand: BRANDS.b, origin: 'http://localhost:5175', resolve: async (pk) => table.get(pk)!, now: () => alice.now });
    const stall = async (path = '/api/stall', cookie = '') =>
      (await (await app.request(path, cookie ? { headers: { cookie } } : undefined)).json()) as Record<string, any>;

    expect((await stall()).seller).toBeNull();
    // Public ?seller= links resolve directly from relays, surviving server restarts without prior seller login.
    expect((await stall(`/api/stall?seller=${alice.id.nostrPubkey}`)).seller).toMatchObject({
      pubkey: alice.id.nostrPubkey,
      cashaddr: alice.id.cashaddr,
      snapshotId: alice.event.id,
    });

    const sidAlice = await signIn(app, alice, 'b');
    const aliceShown = await stall('/api/stall', sidAlice);
    expect(aliceShown.seller).toMatchObject({ pubkey: alice.id.nostrPubkey, cashaddr: alice.id.cashaddr, snapshotId: alice.event.id });
    expect(aliceShown.listings).toHaveLength(2);

    // A second verified seller signing in never hijacks Alice's session or her public ?seller= stall link.
    const sidBob = await signIn(app, bob, 'b');
    expect((await stall('/api/stall')).seller).toBeNull();
    expect((await stall('/api/stall', sidAlice)).seller.cashaddr).toBe(alice.id.cashaddr);
    expect((await stall(`/api/stall?seller=${aliceShown.seller.npub}`)).seller.cashaddr).toBe(alice.id.cashaddr);
    expect((await stall('/api/stall', sidBob)).seller.cashaddr).toBe(bob.id.cashaddr);

    table.set(alice.id.nostrPubkey, { ...table.get(alice.id.nostrPubkey)!, snapshotId: 'new-snapshot' });
    expect((await stall(`/api/stall?seller=${alice.id.nostrPubkey}`)).seller.snapshotId).toBe('new-snapshot');

    // As soon as Alice withdraws on relays, buyer ?seller= checkout shuts down immediately — even before Alice clicks Re-check.
    table.set(alice.id.nostrPubkey, { state: 'withdrawn', relays: [] });
    expect(await stall(`/api/stall?seller=${aliceShown.seller.npub}`)).toMatchObject({ seller: null, sellerState: 'withdrawn' });
    expect(await stall('/api/stall?seller=not-a-key')).toMatchObject({ seller: null, sellerState: 'invalid' });

    const recheck = await app.request('/api/session/recheck', { method: 'POST', headers: { cookie: sidAlice } });
    expect(await recheck.json()).toMatchObject({ revoked: true });
    // Bob's stall remains intact.
    expect((await stall('/api/stall', sidBob)).seller.cashaddr).toBe(bob.id.cashaddr);
  });

  it('clears the seller dashboard on logout, and closes both dashboard and ?seller= on binding expiry', async () => {
    const { b, app, setNow, fromResolution } = setup('active', BRANDS.b);
    const sid = await signIn(app, b, 'b');
    await app.request('/api/logout', { method: 'POST', headers: { cookie: sid } });
    expect(await (await app.request('/api/stall', { headers: { cookie: sid } })).json()).toMatchObject({ seller: null });
    // Public buyer link stays valid while the relay binding itself is active, then closes upon expiry.
    expect(((await (await app.request(`/api/stall?seller=${b.id.nostrPubkey}`)).json()) as Record<string, any>).seller.cashaddr).toBe(b.id.cashaddr);

    const sid2 = await signIn(app, b, 'b');
    setNow(fromResolution().expiresAt!);
    expect(await (await app.request('/api/stall', { headers: { cookie: sid2 } })).json()).toMatchObject({ seller: null });
    expect(await (await app.request(`/api/stall?seller=${b.id.nostrPubkey}`)).json()).toMatchObject({ seller: null, sellerState: 'expired' });
  });

  it('does not resurrect a logged-out seller session when an in-flight recheck finishes late', async () => {
    const b = makeBinding();
    const active: ResolvedBinding = {
      state: 'active',
      cashaddr: b.id.cashaddr,
      bindingId: 'a'.repeat(64),
      snapshotId: b.event.id,
      expiresAt: b.statement.expires_at,
      relays: [],
    };
    let finish!: (v: ResolvedBinding) => void;
    let slow = false;
    const app = createApp({
      brand: BRANDS.b,
      origin: 'http://localhost:5175',
      resolve: () => (slow ? new Promise((r) => (finish = r)) : Promise.resolve(active)),
      now: () => b.now,
    });
    const sid = await signIn(app, b, 'b');
    slow = true;
    const inflight = app.request('/api/session/recheck', { method: 'POST', headers: { cookie: sid } });
    await Promise.resolve();
    await app.request('/api/logout', { method: 'POST', headers: { cookie: sid } });
    finish(active);
    expect((await inflight).status).toBe(401);
    expect(await (await app.request('/api/stall', { headers: { cookie: sid } })).json()).toMatchObject({ seller: null });
  });

  it('routes multi-origin gateway traffic strictly by Host header with isolated RP state', async () => {
    const { b } = setup();
    const resolved: ResolvedBinding = {
      state: 'active',
      cashaddr: b.id.cashaddr,
      bindingId: 'c'.repeat(64),
      snapshotId: b.event.id,
      expiresAt: b.statement.expires_at,
      relays: [],
    };
    expect(() =>
      createGateway({
        rpAOrigin: 'https://same.example',
        rpBOrigin: 'https://same.example',
        resolveA: async () => resolved,
        resolveB: async () => resolved,
      }),
    ).toThrow(/distinct hosts/);

    const gw = createGateway({
      rpAOrigin: 'https://fieldnote.example',
      rpBOrigin: 'https://stall.example',
      webOrigin: 'https://cachet.example',
      resolveA: async () => resolved,
      resolveB: async () => resolved,
      webApp: { fetch: () => new Response('web-ok') },
    });

    const aHealth = await (await gw.fetch(new Request('http://internal/api/health', { headers: { host: 'fieldnote.example:443' } }))).json();
    const bHealth = await (await gw.fetch(new Request('http://internal/api/health', { headers: { host: 'stall.example' } }))).json();
    expect(aHealth).toMatchObject({ name: 'Fieldnote', origin: 'https://fieldnote.example' });
    expect(bHealth).toMatchObject({ name: 'Stall', origin: 'https://stall.example' });
    expect(await (await gw.fetch(new Request('http://internal/', { headers: { host: 'cachet.example' } }))).text()).toBe('web-ok');
    expect((await gw.fetch(new Request('http://internal/', { headers: { host: 'stranger.example' } }))).status).toBe(404);
  });
});

