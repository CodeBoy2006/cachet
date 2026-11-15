import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lookupIdentity,
  parseIdentityInput,
  resolveNip05,
  reverseLookup,
  uniqueRelays,
  type LookupResult,
  type RelayQueryResult,
} from '@cachet/discovery';
import { config } from '../config.ts';
import { browserCache } from './storage.ts';

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; relays: RelayQueryResult[]; pending: string[]; pubkey?: string }
  | { status: 'done'; result: LookupResult; others: LookupResult[] }
  | { status: 'error'; message: string };

const RECENT_TTL_MS = 25_000;
const recentLookups = new Map<string, { at: number; result: LookupResult; others: LookupResult[] }>();
let cacheEpoch = 0;
const cacheKey = (input: string, cashaddr?: string) => `${input.trim().toLowerCase()}|${cashaddr ?? ''}`;

export const invalidateLookups = () => {
  cacheEpoch++;
  recentLookups.clear();
};

/** Resolves an npub / nprofile / hex / NIP-05 / CashAddr to a verified identity, relay by relay. */
export const useLookup = (input: string | undefined, cashaddr?: string) => {
  const [state, setState] = useState<LookupState>(() => {
    if (!input) return { status: 'idle' };
    const hit = recentLookups.get(cacheKey(input, cashaddr));
    return hit && Date.now() - hit.at < RECENT_TTL_MS ? { status: 'done', result: hit.result, others: hit.others } : { status: 'idle' };
  });
  const run = useRef(0);

  const go = useCallback(async (force = false) => {
    const id = ++run.current;
    const startedEpoch = cacheEpoch;
    const live = () => id === run.current;
    if (!input) return setState({ status: 'idle' });
    const key = cacheKey(input, cashaddr);
    if (!force) {
      const hit = recentLookups.get(key);
      if (hit && Date.now() - hit.at < RECENT_TTL_MS) {
        setState({ status: 'done', result: hit.result, others: hit.others });
        return;
      }
    }
    const parsed = parseIdentityInput(input);
    if (parsed.kind === 'invalid') return setState({ status: 'error', message: parsed.reason });

    const relays: RelayQueryResult[] = [];
    const onRelay = (r: RelayQueryResult) => {
      relays.push(r);
      if (live()) setState((s) => (s.status === 'loading' ? { ...s, relays: [...relays], pending: s.pending.filter((u) => u !== r.url) } : s));
    };

    try {
      if (parsed.kind === 'address') {
        setState({ status: 'loading', relays: [], pending: config.relays });
        const r = await reverseLookup(parsed.cashaddr, { relays: config.relays, indexers: config.indexers, cache: browserCache });
        if (!live()) return;
        if (!r.results.length) {
          const reachable = r.relays.some((x) => x.status === 'ok');
          return setState({ status: 'error', message: reachable ? 'No Nostr identity claims this address yet.' : 'Relays did not answer. Try again.' });
        }
        const active = r.results.filter((x) => x.resolution.state === 'active');
        const [first, ...rest] = active.length ? active : r.results;
        if (startedEpoch === cacheEpoch) recentLookups.set(key, { at: Date.now(), result: first!, others: rest });
        return setState({ status: 'done', result: first!, others: rest });
      }
      let pubkey: string;
      let hints: string[] = [];
      if (parsed.kind === 'nip05') {
        setState({ status: 'loading', relays: [], pending: [] });
        const found = await resolveNip05(parsed.name, parsed.domain);
        if (!live()) return;
        if (!found) return setState({ status: 'error', message: `${parsed.name}@${parsed.domain} did not resolve to a Nostr key.` });
        pubkey = found.pubkey;
        hints = found.relays;
      } else {
        pubkey = parsed.pubkey;
        hints = parsed.relays;
      }
      setState({ status: 'loading', relays: [], pending: uniqueRelays(config.relays, hints, config.indexers), pubkey });
      const result = await lookupIdentity(pubkey, { relays: config.relays, indexers: config.indexers, hints, cache: browserCache, onRelay, ...(cashaddr ? { cashaddr } : {}) });
      if (live()) {
        if (startedEpoch === cacheEpoch) {
          recentLookups.set(key, { at: Date.now(), result, others: [] });
          recentLookups.set(cacheKey(result.npub, cashaddr), { at: Date.now(), result, others: [] });
        }
        setState({ status: 'done', result, others: [] });
      }
    } catch (e) {
      if (live()) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [input, cashaddr]);

  useEffect(() => {
    void go(false);
    return () => {
      run.current++;
    };
  }, [go]);

  const refresh = useCallback(() => go(true), [go]);

  return { state, refresh };
};
