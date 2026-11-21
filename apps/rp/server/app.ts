/**
 * A relying party that signs people in with a BCH × Nostr identity.
 *
 * It trusts no identity server. For every login it:
 *   1. resolves the npub's latest kind 10011 snapshot from relays itself,
 *   2. issues a one-time challenge tied to this browser's pre-login cookie,
 *   3. verifies a NIP-98 event over the exact request body,
 *   4. consumes the challenge atomically, then creates its own session.
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  AUTH_CODES,
  STATE_LABELS,
  decodeAuthHeader,
  decodeNip19,
  isLowerHex,
  npubEncode,
  nowSeconds,
  randomHex,
  verifyAuthEvent,
  type AuthCode,
  type BindingState,
} from '@cachet/core';
import type { Brand } from '../shared/brands.ts';

/** Long enough to approve in another tab, short enough that a stolen nonce goes stale. */
export const CHALLENGE_TTL = 180;
const SESSION_TTL = 12 * 3600;
/** Each browser sees only its own decisions; these bound the memory the log can use. */
const LOG_PER_VISITOR = 40;
const LOG_VISITORS = 500;

const NOTES = [
  {
    id: 'meetup-tab',
    title: 'Running a meetup tab in BCH',
    date: 'Nov 9',
    preview: 'Twenty-two people, one shared tab, settled before the bill…',
    body: 'Twenty-two people, one shared tab, settled before the bill arrived. The trick was not the wallet; it was printing the QR on the table card.',
  },
  {
    id: 'pricing-in-sats',
    title: 'Pricing in sats without confusing anyone',
    date: 'Nov 3',
    preview: 'Show the fiat price large and the BCH amount…',
    body: 'Show the fiat price large and the BCH amount small, then let the wallet do the math. Nobody wants to divide by a hundred million at a counter.',
  },
  {
    id: 'npub-invoice',
    title: 'Why your npub should be your invoice',
    date: 'Oct 28',
    preview: 'Addresses change, people do not. If a wallet can…',
    body: 'Addresses change, people do not. If a wallet can resolve my npub to an address I signed for, I never paste a string into a chat again.',
  },
];

export interface ResolvedBinding {
  state: BindingState;
  cashaddr?: string;
  bindingId?: string;
  snapshotId?: string;
  expiresAt?: number;
  name?: string;
  relays: { url: string; status: string; ms: number }[];
}

export type Resolver = (pubkey: string) => Promise<ResolvedBinding>;

interface Challenge {
  id: string;
  nonce: string;
  pre: string;
  /** Known up front for in-page signing; learned from the signature for redirects. */
  pubkey?: string;
  binding?: ResolvedBinding;
  expiresAt: number;
}

export interface Session {
  pubkey: string;
  npub: string;
  name?: string;
  cashaddr: string;
  bindingId: string;
  snapshotId: string;
  bindingExpiresAt: number;
  createdAt: number;
  checkedAt: number;
  relays: ResolvedBinding['relays'];
}

export interface LogEntry {
  t: number;
  tone: 'ok' | 'reject' | 'info';
  text: string;
  code?: string;
}

export const createApp = (opts: { brand: Brand; origin: string; resolve: Resolver; now?: () => number }) => {
  const now = opts.now ?? nowSeconds;
  const verifyUrl = `${opts.origin}/api/verify`;
  const secure = opts.origin.startsWith('https://');
  const preCookie = `rp_${opts.brand.id}_pre`;
  const sidCookie = `rp_${opts.brand.id}_sid`;
  const challenges = new Map<string, Challenge>();
  const used = new Map<string, number>();
  const sessions = new Map<string, Session & { expires: number }>();
  const vidCookie = `rp_${opts.brand.id}_vid`;
  /** Log entries per visitor cookie, oldest visitor first, so a shared demo never shows one person's sign-ins to another. */
  const logs = new Map<string, LogEntry[]>();

  const parseSellerKey = (raw: string | undefined): string | null => {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    if (v.startsWith('npub1')) {
      try {
        const d = decodeNip19(v as `npub1${string}`);
        return d.type === 'npub' ? d.data : null;
      } catch {
        return null;
      }
    }
    return isLowerHex(v, 32) ? v : null;
  };

  const cookieOpts = { httpOnly: true, sameSite: 'Lax' as const, secure, path: '/' };

  /** A random id for this browser's log. It authorizes nothing; it only keeps visitors' logs apart. */
  const visitorOf = (c: Context) => {
    let v = getCookie(c, vidCookie);
    if (!v || !isLowerHex(v, 16)) {
      v = randomHex(16);
      setCookie(c, vidCookie, v, { ...cookieOpts, maxAge: 30 * 86400 });
    }
    return v;
  };

  const note = (c: Context, tone: LogEntry['tone'], text: string, code?: string) => {
    const who = visitorOf(c);
    const entries = logs.get(who) ?? [];
    logs.delete(who);
    logs.set(who, entries);
    entries.unshift({ t: now(), tone, text, ...(code ? { code } : {}) });
    entries.length = Math.min(entries.length, LOG_PER_VISITOR);
    while (logs.size > LOG_VISITORS) logs.delete(logs.keys().next().value!);
  };
  const short = (pk: string) => `${npubEncode(pk).slice(0, 12)}…`;
  const deny = (c: Context, status: 400 | 401 | 403, code: AuthCode, detail?: string) => {
    note(c, 'reject', `Rejected: ${AUTH_CODES[code]}`, code);
    return c.json({ ok: false, code, message: detail ?? AUTH_CODES[code] }, status);
  };

  const preSession = (c: Context) => {
    let pre = getCookie(c, preCookie);
    if (!pre || !isLowerHex(pre, 16)) {
      pre = randomHex(16);
      setCookie(c, preCookie, pre, { ...cookieOpts, maxAge: 3600 });
    }
    return pre;
  };

  const sweep = () => {
    const t = now();
    // Keep expired challenges a while so a late attempt gets 'expired', not 'unknown'.
    for (const [id, ch] of challenges) if (ch.expiresAt + 600 < t) challenges.delete(id);
    for (const [id, expiresAt] of used) if (expiresAt < t) used.delete(id);
    for (const [id, s] of sessions) if (s.expires < t || s.bindingExpiresAt <= t) sessions.delete(id);
  };

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, name: opts.brand.name, origin: opts.origin }));

  app.get('/api/log', (c) => c.json((logs.get(visitorOf(c)) ?? []).slice(0, 20)));

  /**
   * Two shapes:
   *  - with `pubkey` (NIP-07 in this page): the link is resolved up front and its binding id is part of what gets signed;
   *  - without (redirect to a signer): the challenge is open, and the link is resolved once the signature names the key.
   */
  app.post('/api/challenge', async (c) => {
    sweep();
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return deny(c, 400, 'auth_malformed', 'Body must be a JSON object');
    const pubkey = body.pubkey;
    if (pubkey !== undefined && !isLowerHex(pubkey, 32)) {
      return c.json({ ok: false, code: 'auth_malformed', message: 'pubkey must be 64 lowercase hex' }, 400);
    }
    const pre = preSession(c);
    let binding: ResolvedBinding | undefined;
    if (pubkey) {
      note(c, 'info', `Looking up ${short(pubkey)} on relays`);
      binding = await opts.resolve(pubkey);
      const answered = binding.relays.filter((r) => r.status === 'ok').length;
      if (binding.state !== 'active' || !binding.bindingId) {
        note(c, 'reject', `No active BCH link for ${short(pubkey)} (${STATE_LABELS[binding.state].toLowerCase()}, ${answered}/${binding.relays.length} relays)`, 'binding_inactive');
        return c.json({ ok: false, code: 'binding_inactive', state: binding.state, message: `${AUTH_CODES.binding_inactive} (${STATE_LABELS[binding.state]})`, relays: binding.relays }, 403);
      }
      note(c, 'info', `Challenge issued to ${short(pubkey)}; link active on ${answered}/${binding.relays.length} relays`);
    } else {
      note(c, 'info', 'Challenge issued for a sign-in redirect');
    }
    const ch: Challenge = { id: randomHex(16), nonce: randomHex(32), pre, ...(pubkey ? { pubkey } : {}), ...(binding ? { binding } : {}), expiresAt: now() + CHALLENGE_TTL };
    challenges.set(ch.id, ch);
    return c.json({
      ok: true,
      challenge_id: ch.id,
      nonce: ch.nonce,
      expires_at: ch.expiresAt,
      url: verifyUrl,
      ...(binding ? { binding: { cashaddr: binding.cashaddr, binding_id: binding.bindingId, snapshot_id: binding.snapshotId, relays: binding.relays } } : {}),
    });
  });

  app.post('/api/verify', async (c) => {
    sweep();
    const raw = await c.req.text();
    let body: { challenge_id?: unknown; nonce?: unknown; binding_id?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return deny(c, 400, 'auth_malformed', 'Body is not JSON');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return deny(c, 400, 'auth_malformed', 'Body must be a JSON object');
    const id = typeof body.challenge_id === 'string' ? body.challenge_id : '';
    if (used.has(id)) return deny(c, 401, 'challenge_used');
    const ch = challenges.get(id);
    if (!ch) return deny(c, 401, 'challenge_unknown');
    if (getCookie(c, preCookie) !== ch.pre) return deny(c, 401, 'session_mismatch');
    if (ch.expiresAt < now()) {
      challenges.delete(id);
      return deny(c, 401, 'challenge_expired');
    }
    const eventJson = decodeAuthHeader(c.req.header('authorization'));
    if (!eventJson) return deny(c, 401, 'auth_missing');
    // Failures before the delete below leave the challenge usable: a bad request must not burn a good one.
    const auth = verifyAuthEvent(eventJson, { url: verifyUrl, method: 'POST', body: raw, now: now(), ...(ch.pubkey ? { pubkey: ch.pubkey } : {}) });
    if (!auth.ok) return deny(c, 401, auth.code);
    if (body.nonce !== ch.nonce) return deny(c, 401, 'challenge_unknown', 'Nonce does not match the challenge');
    if (ch.binding && body.binding_id !== ch.binding.bindingId) return deny(c, 401, 'binding_inactive', 'Signed for a different binding');
    // Atomic: no await between get() above and delete() here, so concurrent replays cannot both pass.
    if (!challenges.delete(id)) return deny(c, 401, 'challenge_used');
    used.set(id, ch.expiresAt + 600);

    const pubkey = auth.event.pubkey;
    note(c, 'info', `Signature valid for ${short(pubkey)}; looking up its BCH link`);
    const b = await opts.resolve(pubkey);
    if (b.state !== 'active' || !b.bindingId || (b.expiresAt ?? 0) <= now() || (ch.binding?.cashaddr && b.cashaddr !== ch.binding.cashaddr)) {
      note(c, 'reject', `No active BCH link for ${short(pubkey)} (${STATE_LABELS[b.state].toLowerCase()})`, 'binding_inactive');
      return c.json({ ok: false, code: 'binding_inactive', state: b.state, message: `${AUTH_CODES.binding_inactive} (${STATE_LABELS[b.state]})` }, 403);
    }

    const t = now();
    const session = {
      pubkey,
      npub: npubEncode(pubkey),
      ...(b.name ? { name: b.name } : {}),
      cashaddr: b.cashaddr!,
      bindingId: b.bindingId!,
      snapshotId: b.snapshotId!,
      bindingExpiresAt: b.expiresAt!,
      createdAt: t,
      checkedAt: t,
      relays: b.relays,
      expires: t + SESSION_TTL,
    };
    const sid = randomHex(24);
    sessions.set(sid, session);
    setCookie(c, sidCookie, sid, { ...cookieOpts, maxAge: SESSION_TTL });
    deleteCookie(c, preCookie, cookieOpts);
    note(c, 'ok', `Signed in ${short(pubkey)} → ${b.cashaddr?.split(':')[1]?.slice(0, 10)}…`);
    const { expires: _e, ...pub } = session;
    return c.json({ ok: true, session: pub });
  });

  const current = (c: Context) => {
    const sid = getCookie(c, sidCookie);
    const s = sid ? sessions.get(sid) : undefined;
    if (!s) return undefined;
    const t = now();
    if (s.expires >= t && s.bindingExpiresAt > t) return { sid: sid!, s };
    sessions.delete(sid!);
    return undefined;
  };

  app.get('/api/notes', (c) => {
    if (!current(c)) return c.json({ locked: true, notes: NOTES.map(({ body: _b, ...n }) => n) });
    return c.json({ locked: false, notes: NOTES });
  });

  app.get('/api/stall', async (c) => {
    const t = now();
    const q = c.req.query('seller');
    let seller: { pubkey: string; npub: string; name?: string; cashaddr: string; snapshotId: string; checkedAt: number } | null = null;
    let sellerState: BindingState | undefined;
    if (q !== undefined) {
      const pk = parseSellerKey(q);
      if (!pk) {
        sellerState = 'invalid';
      } else {
        const b = (await opts.resolve(pk)) ?? { state: 'not_found' as const, relays: [] };
        if (b.state === 'active' && b.cashaddr && b.snapshotId && (b.expiresAt ?? 0) > t) {
          seller = {
            pubkey: pk,
            npub: npubEncode(pk),
            ...(b.name ? { name: b.name } : {}),
            cashaddr: b.cashaddr,
            snapshotId: b.snapshotId,
            checkedAt: t,
          };
        } else {
          sellerState = b.state === 'active' ? 'expired' : b.state;
        }
      }
    } else {
      const cur = current(c);
      if (cur) {
        seller = {
          pubkey: cur.s.pubkey,
          npub: cur.s.npub,
          ...(cur.s.name ? { name: cur.s.name } : {}),
          cashaddr: cur.s.cashaddr,
          snapshotId: cur.s.snapshotId,
          checkedAt: cur.s.checkedAt,
        };
      }
    }
    return c.json({
      seller,
      ...(sellerState ? { sellerState } : {}),
      listings: [
        { id: 'notebook', name: 'Hand-bound pocket notebook', sats: 1000, bch: '0.00001', stock: 4 },
        { id: 'pin', name: 'Enamel pin, verifiable green', sats: 3000, bch: '0.00003', stock: 31 },
      ],
    });
  });

  app.get('/api/session', (c) => {
    const cur = current(c);
    if (!cur) return c.json({ ok: false }, 401);
    const { expires: _e, ...pub } = cur.s;
    return c.json({ ok: true, session: pub });
  });

  /** Re-reads the relays. A withdrawn or expired link ends the session here, not just at next login. */
  app.post('/api/session/recheck', async (c) => {
    const cur = current(c);
    if (!cur) return c.json({ ok: false }, 401);
    const b = await opts.resolve(cur.s.pubkey);
    if (!sessions.has(cur.sid)) return c.json({ ok: false }, 401);
    if (b.state === 'unavailable') {
      note(c, 'info', `Could not re-check ${short(cur.s.pubkey)}: relays unavailable`);
      return c.json({ ok: false, revoked: false, state: b.state, message: 'Relays did not answer; could not re-check right now.' }, 503);
    }
    if (b.state !== 'active' || !b.bindingId || (b.expiresAt ?? 0) <= now() || b.cashaddr !== cur.s.cashaddr) {
      sessions.delete(cur.sid);
      deleteCookie(c, sidCookie, cookieOpts);
      note(c, 'reject', `Session ended for ${short(cur.s.pubkey)}: link ${STATE_LABELS[b.state].toLowerCase()}`, 'binding_inactive');
      return c.json({ ok: false, revoked: true, state: b.state, message: `Your BCH link is ${STATE_LABELS[b.state].toLowerCase()}. Signed out.` });
    }
    Object.assign(cur.s, { checkedAt: now(), relays: b.relays, bindingId: b.bindingId, snapshotId: b.snapshotId, bindingExpiresAt: b.expiresAt });
    note(c, 'info', `Re-checked ${short(cur.s.pubkey)}: still active`);
    const { expires: _e, ...pub } = cur.s;
    return c.json({ ok: true, session: pub });
  });

  app.post('/api/logout', (c) => {
    const cur = current(c);
    if (cur) sessions.delete(cur.sid);
    deleteCookie(c, sidCookie, cookieOpts);
    return c.json({ ok: true });
  });

  return app;
};
