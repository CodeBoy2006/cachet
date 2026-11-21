import {
  KIND_APP_DATA,
  KIND_EXTERNAL_IDENTITIES,
  KIND_METADATA,
  KIND_RELAY_LIST,
  PAYTACA_LEGACY_D_TAG,
  checkEventSignature,
  claimIdentity,
  compareSnapshots,
  decodeNip19,
  isAddressError,
  isLowerHex,
  normalizeCashAddrInput,
  npubEncode,
  parseCashAddr,
  rebuildEvent,
  resolveSnapshots,
  toggleTokenForm,
  type NostrEvent,
  type Resolution,
} from '@cachet/core';
import { isPublicRelayUrl, publishToRelay, queryRelay, uniqueRelays, type PublishResult, type RelayQueryResult, type SocketLike } from './relay.ts';

export * from './relay.ts';

/** Broad, reliable defaults. Users can replace them; nothing here is a trusted service. */
export const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nostr.mom'];
/** Extra relays used only for finding a user's NIP-65 relay list. */
export const INDEXER_RELAYS = ['wss://purplepag.es'];

export type IdentityInput =
  | { kind: 'pubkey'; pubkey: string; relays: string[] }
  | { kind: 'address'; cashaddr: string }
  | { kind: 'nip05'; name: string; domain: string }
  | { kind: 'invalid'; reason: string };

/** Accepts npub, nprofile, nostr: URIs, 64-hex keys, NIP-05 names and CashAddr. */
export const parseIdentityInput = (raw: string): IdentityInput => {
  const value = raw.trim().replace(/^nostr:/i, '');
  if (!value) return { kind: 'invalid', reason: 'empty' };
  if (/^(npub1|nprofile1)/i.test(value)) {
    try {
      const decoded = decodeNip19(value.toLowerCase());
      if (decoded.type === 'npub') return { kind: 'pubkey', pubkey: decoded.data, relays: [] };
      if (decoded.type === 'nprofile') {
        return { kind: 'pubkey', pubkey: decoded.data.pubkey, relays: uniqueRelays(decoded.data.relays ?? []) };
      }
    } catch {
      return { kind: 'invalid', reason: 'not a valid npub' };
    }
  }
  if (isLowerHex(value.toLowerCase(), 32) && value.length === 64) {
    return { kind: 'pubkey', pubkey: value.toLowerCase(), relays: [] };
  }
  const nip05 = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(value);
  if (nip05) return { kind: 'nip05', name: nip05[1]!.toLowerCase(), domain: nip05[2]!.toLowerCase() };
  const address = normalizeCashAddrInput(value);
  if (!isAddressError(address)) return { kind: 'address', cashaddr: address.address };
  return { kind: 'invalid', reason: 'Enter an npub, a NIP-05 name or a BCH address' };
};

/** NIP-05 is a convenience pointer, never the root of trust: the result is just a pubkey to look up. */
export const resolveNip05 = async (name: string, domain: string): Promise<{ pubkey: string; relays: string[] } | null> => {
  try {
    const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { names?: Record<string, string>; relays?: Record<string, string[]> };
    const pubkey = json.names?.[name];
    if (!isLowerHex(pubkey, 32)) return null;
    return { pubkey, relays: uniqueRelays(json.relays?.[pubkey] ?? []) };
  } catch {
    return null;
  }
};

export interface Profile {
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

export interface SnapshotCache {
  get(pubkey: string): unknown[] | Promise<unknown[]>;
  put(pubkey: string, event: NostrEvent): void | Promise<void>;
}

/**
 * Keeps the few newest snapshots per author. The newest stops rollback; the older
 * ones let a resolver say "withdrawn" (seen, then removed) instead of "not found".
 */
export const memoryCache = (keep = 3) => {
  const store = new Map<string, NostrEvent[]>();
  return {
    get: (pk) => store.get(pk) ?? [],
    put: (pk, e) => {
      const list = (store.get(pk) ?? []).filter((x) => x.id !== e.id);
      store.set(pk, [...list, e].sort(compareSnapshots).slice(0, keep));
    },
  } satisfies SnapshotCache;
};

export interface LegacyAnnouncement {
  cashaddr: string;
  eventId: string;
  createdAt: number;
}

export interface LookupResult {
  pubkey: string;
  npub: string;
  resolution: Resolution;
  relays: RelayQueryResult[];
  relayList: { write: string[]; read: string[]; source: 'nip65' | 'none' };
  profile?: Profile;
  /** Unverified address announced via Paytaca's legacy kind 30078 (`d=paytaca:bch-address`), present ONLY when no kind 10011 snapshot exists. */
  legacy?: LegacyAnnouncement;
  /** True if a cached snapshot was newer than anything the relays returned. */
  usedCache: boolean;
}

const latestValid = (events: unknown[], pubkey: string, kind: number): NostrEvent | undefined =>
  events
    .map((e) => rebuildEvent(e))
    .flatMap((r) => (r.ok && r.event.pubkey === pubkey && r.event.kind === kind && checkEventSignature(r.event).ok ? [r.event] : []))
    .sort(compareSnapshots)[0];

/** Reads the latest signed announcement without treating it as proof of address ownership. */
export const readPaytacaLegacy = (events: unknown[], pubkey: string): LegacyAnnouncement | undefined => {
  const event = events
    .map((e) => rebuildEvent(e))
    .flatMap((r) => (r.ok && r.event.pubkey === pubkey && r.event.kind === KIND_APP_DATA &&
      r.event.tags.some((t) => t[0] === 'd' && t[1] === PAYTACA_LEGACY_D_TAG) && checkEventSignature(r.event).ok ? [r.event] : []))
    .sort(compareSnapshots)[0];
  if (!event) return undefined;
  let raw = event.content.trim();
  if (raw.startsWith('{')) {
    try {
      const value = JSON.parse(raw) as {
        address?: unknown;
        bchAddress?: unknown;
        cashaddr?: unknown;
        data?: { address?: unknown; bchAddress?: unknown; cashaddr?: unknown } | null;
      };
      const nested = value?.data && typeof value.data === 'object' ? value.data : undefined;
      const address = value?.address ?? value?.bchAddress ?? value?.cashaddr ?? nested?.address ?? nested?.bchAddress ?? nested?.cashaddr;
      if (typeof address !== 'string') return undefined;
      raw = address;
    } catch {
      return undefined;
    }
  }
  const parsed = normalizeCashAddrInput(raw);
  if (isAddressError(parsed) || parsed.network === 'regtest') return undefined;
  return { cashaddr: parsed.address, eventId: event.id, createdAt: event.created_at };
};

export const readRelayList = (event: NostrEvent | undefined) => {
  const write: string[] = [];
  const read: string[] = [];
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    if (tag[2] !== 'read') write.push(tag[1]);
    if (tag[2] !== 'write') read.push(tag[1]);
  }
  return { write: uniqueRelays(write), read: uniqueRelays(read) };
};

const readProfile = (event: NostrEvent | undefined): Profile | undefined => {
  if (!event) return undefined;
  try {
    const m = JSON.parse(event.content) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.length < 512 ? v : undefined);
    return {
      name: str(m.name),
      displayName: str(m.display_name) ?? str(m.displayName),
      picture: str(m.picture)?.startsWith('https://') ? str(m.picture) : undefined,
      about: str(m.about),
      nip05: str(m.nip05),
    };
  } catch {
    return undefined;
  }
};

export interface LookupOptions {
  relays?: string[];
  hints?: string[];
  /** Relays queried only to find the NIP-65 list. Defaults to INDEXER_RELAYS. */
  indexers?: string[];
  /** Optional policy gate (e.g. server DNS check) for untrusted hint / NIP-65 relay URLs. */
  allowRelay?: (url: string) => Promise<boolean> | boolean;
  /** Permit non-public (`ws://` / loopback) URLs in hints and NIP-65; defaults to true only when `relays` itself uses a local URL. */
  allowPrivateRelays?: boolean;
  /** Server socket factory can enforce address policy on the actual connection. */
  socket?: (url: string) => SocketLike;
  cashaddr?: string;
  cache?: SnapshotCache;
  timeout?: number;
  now?: number;
  /** Called as each relay answers, for progressive UI. */
  onRelay?: (r: RelayQueryResult) => void;
}

/**
 * Forward lookup: author + kind 10011, newest valid snapshot wins.
 * Never filters by `#i` first; that would hide a newer snapshot that removed the claim.
 */
export const lookupIdentity = async (pubkey: string, opts: LookupOptions = {}): Promise<LookupResult> => {
  const timeout = opts.timeout ?? 4500;
  const configured = uniqueRelays(opts.relays ?? DEFAULT_RELAYS, opts.indexers ?? INDEXER_RELAYS);
  const allowPrivate = opts.allowPrivateRelays ?? (opts.relays ?? []).some((u) => !isPublicRelayUrl(u));
  const admitUntrusted = async (urls: string[], max = 4) => {
    const out: string[] = [];
    for (const u of urls.slice(0, max * 3)) {
      if (out.length >= max) break;
      if (!allowPrivate && !isPublicRelayUrl(u)) continue;
      if (opts.allowRelay && !(await opts.allowRelay(u))) continue;
      out.push(u);
    }
    return out;
  };
  const safeHints = await admitUntrusted(uniqueRelays(opts.hints), 4);
  const firstWave = uniqueRelays(configured, safeHints);
  const legacyFilter = { authors: [pubkey], kinds: [KIND_APP_DATA], '#d': [PAYTACA_LEGACY_D_TAG], limit: 2 };
  const filters = [{ authors: [pubkey], kinds: [KIND_METADATA, KIND_RELAY_LIST, KIND_EXTERNAL_IDENTITIES], limit: 12 }, legacyFilter];
  const track = (p: Promise<RelayQueryResult>) =>
    p.then((r) => {
      opts.onRelay?.(r);
      return r;
    });
  const results = await Promise.all(firstWave.map((url) => track(queryRelay(url, filters, { timeout, socket: opts.socket }))));

  const relayListEvent = latestValid(results.flatMap((r) => r.events), pubkey, KIND_RELAY_LIST);
  const relayList = readRelayList(relayListEvent);
  const secondWave = await admitUntrusted(relayList.write.filter((u) => !firstWave.includes(u)), 4);
  if (secondWave.length) {
    const more = await Promise.all(
      secondWave.map((url) => track(queryRelay(url, [{ authors: [pubkey], kinds: [KIND_METADATA, KIND_EXTERNAL_IDENTITIES], limit: 6 }, legacyFilter], { timeout, socket: opts.socket }))),
    );
    results.push(...more);
  }

  const all = results.flatMap((r) => r.events.map((event) => ({ event, relay: r.url })));
  const snapshots = all.filter((x) => (x.event as { kind?: number })?.kind === KIND_EXTERNAL_IDENTITIES);
  const cached = ((await opts.cache?.get(pubkey)) ?? []).map((event) => ({ event, relay: 'cache' }));
  const resolution = resolveSnapshots({
    pubkey,
    events: [...snapshots, ...cached],
    reachable: results.some((r) => r.status === 'ok'),
    ...(opts.cashaddr ? { cashaddr: opts.cashaddr } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  if (resolution.latest) await opts.cache?.put(pubkey, resolution.latest);
  // Remember a snapshot that still carried a claim the latest one dropped.
  for (const c of resolution.claims) if (c.state === 'withdrawn') {
    const seen = snapshots.find((x) => (x.event as { id?: string })?.id === c.eventId);
    const r = seen ? rebuildEvent(seen.event) : null;
    if (r?.ok) await opts.cache?.put(pubkey, r.event);
  }
  const usedCache = !!resolution.snapshots[0] && resolution.snapshots[0].relays.length === 1 && resolution.snapshots[0].relays[0] === 'cache';

  return {
    pubkey,
    npub: npubEncode(pubkey),
    resolution,
    relays: results,
    relayList: { ...relayList, source: relayListEvent ? 'nip65' : 'none' },
    profile: readProfile(latestValid(all.map((x) => x.event), pubkey, KIND_METADATA)),
    ...(!resolution.latest ? { legacy: readPaytacaLegacy(all.map((x) => x.event), pubkey) } : {}),
    usedCache,
  };
};

/**
 * Reverse lookup: which npubs claim this address? A `#i` query only yields
 * candidates; each is then resolved through its own latest snapshot.
 * Several npubs may legitimately claim one address.
 */
export const reverseLookup = async (cashaddr: string, opts: LookupOptions = {}) => {
  const parsed = parseCashAddr(cashaddr);
  if (isAddressError(parsed)) return { candidates: [] as string[], results: [] as LookupResult[], relays: [] as RelayQueryResult[] };
  const forms = [parsed.address, toggleTokenForm(parsed)].filter((x): x is string => !!x).map(claimIdentity);
  const relays = uniqueRelays(opts.relays ?? DEFAULT_RELAYS);
  const answers = await Promise.all(
    relays.map((url) => queryRelay(url, [{ kinds: [KIND_EXTERNAL_IDENTITIES], '#i': forms, limit: 50 }], { timeout: opts.timeout ?? 4500 })),
  );
  const candidates = [
    ...new Set(
      answers.flatMap((a) => a.events).flatMap((e) => {
        const r = rebuildEvent(e);
        return r.ok && checkEventSignature(r.event).ok ? [r.event.pubkey] : [];
      }),
    ),
  ].slice(0, 10);
  const results = await Promise.all(candidates.map((pk) => lookupIdentity(pk, { ...opts, cashaddr: parsed.address })));
  return { candidates, results, relays: answers };
};

export const publishEvent = (event: NostrEvent, relays: string[], opts: { timeout?: number; onResult?: (r: PublishResult) => void } = {}) =>
  Promise.all(
    uniqueRelays(relays).map((url) =>
      publishToRelay(url, event, opts).then((r) => {
        opts.onResult?.(r);
        return r;
      }),
    ),
  );

/** Reads the author's current snapshot so a new one keeps every other claim. */
export const fetchCurrentSnapshot = async (pubkey: string, relays: string[] = DEFAULT_RELAYS, timeout = 4000) => {
  const answers = await Promise.all(
    uniqueRelays(relays).map((url) => queryRelay(url, [{ authors: [pubkey], kinds: [KIND_EXTERNAL_IDENTITIES], limit: 5 }], { timeout })),
  );
  return {
    latest: latestValid(answers.flatMap((a) => a.events), pubkey, KIND_EXTERNAL_IDENTITIES),
    reachable: answers.some((a) => a.status === 'ok'),
    answers,
  };
};
