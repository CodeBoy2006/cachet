import { afterEach, describe, expect, it } from 'vitest';
import { resolveSnapshots } from '@cachet/core';
import { makeBinding, publishSnapshot } from '../../../../packages/core/test/helpers.ts';
import { browserCache, clearPendingSign, readPendingSign, savePendingSign, store } from './storage.ts';

describe('browserCache & store fallback', () => {
  const original = globalThis.localStorage;
  afterEach(() => {
    globalThis.localStorage = original;
  });

  it('keeps a newer withdrawn snapshot authoritative in memory when localStorage quota is full', () => {
    const backing = new Map<string, string>();
    let full = false;
    globalThis.localStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new Error('QuotaExceededError');
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
      clear: () => backing.clear(),
      key: () => null,
      get length() {
        return backing.size;
      },
    };

    const b = makeBinding();
    const withdrawn = publishSnapshot(b.id, [], b.now + 5);
    browserCache.put(b.id.nostrPubkey, b.event);
    full = true;
    browserCache.put(b.id.nostrPubkey, withdrawn);
    expect(store.persisted).toBe(false);

    const res = resolveSnapshots({
      pubkey: b.id.nostrPubkey,
      events: browserCache.get(b.id.nostrPubkey).map((event) => ({ event, relay: 'cache' })),
      reachable: true,
      cashaddr: b.id.cashaddr,
      now: b.now + 10,
    });
    expect(res.latest?.id).toBe(withdrawn.id);
    expect(res.state).toBe('withdrawn');
  });

  it('keeps a pending cross-origin sign-in within the challenge window and expires stale ones', () => {
    clearPendingSign();
    savePendingSign({ app: 'Fieldnote', search: '?app=Fieldnote&return=http%3A%2F%2Flocalhost%3A5174%2F&req=abc' });
    const saved = readPendingSign();
    expect(saved?.app).toBe('Fieldnote');
    expect(readPendingSign(saved!.at + 170_000)).toBeNull();
  });
});
