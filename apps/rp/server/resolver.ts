import { lookup } from 'node:dns/promises';
import { DEFAULT_RELAYS, INDEXER_RELAYS, isPrivateIp, isPublicRelayUrl, lookupIdentity, memoryCache, uniqueRelays, type SnapshotCache, type SocketLike } from '@cachet/discovery';
import type { Resolver } from './app.ts';

export const createRelayResolver = (rawRelays = process.env.RELAYS, opts: { cache?: SnapshotCache; socket?: (url: string) => SocketLike } = {}) => {
  const relays = rawRelays ? uniqueRelays(rawRelays.split(',')) : DEFAULT_RELAYS;
  // With a custom relay list (e.g. a local dev relay) skip the public indexers.
  const indexers = rawRelays ? [] : INDEXER_RELAYS;
  const localDevRelays = relays.some((u) => !isPublicRelayUrl(u));

  const allowRelay = async (url: string) => {
    if (localDevRelays) return true;
    if (!isPublicRelayUrl(url)) return false;
    if (opts.socket) return true; // The hosted socket checks DNS on the connection itself.
    try {
      const records = await lookup(new URL(url).hostname, { all: true });
      return records.length > 0 && records.every((r) => !isPrivateIp(r.address));
    } catch {
      return false;
    }
  };

  // Each server keeps its own view of each author's newest snapshot; relays cannot roll it back.
  const cache = opts.cache ?? memoryCache();

  const resolve: Resolver = async (pubkey) => {
    const r = await lookupIdentity(pubkey, { relays, indexers, cache, allowRelay, socket: opts.socket, timeout: 4000 });
    const claim = r.resolution.primary;
    const b = claim?.result?.binding;
    return {
      state: r.resolution.state,
      ...(claim ? { cashaddr: claim.cashaddr } : {}),
      ...(b ? { bindingId: b.bindingId, snapshotId: b.eventId, expiresAt: b.expiresAt } : {}),
      ...(r.profile?.displayName || r.profile?.name ? { name: r.profile.displayName || r.profile.name } : {}),
      relays: r.relays.map((x) => ({ url: x.url, status: x.status, ms: x.ms })),
    };
  };

  return { relays, resolve };
};
