import { KIND_EXTERNAL_IDENTITIES, checkEventSignature, compareSnapshots, rebuildEvent, type NostrEvent } from '@cachet/core';
import type { SnapshotCache } from '@cachet/discovery';

const memory = new Map<string, string | null>();
let canPersist = true;

/** localStorage can throw (private mode, blocked storage, full quota); keep failed writes authoritative in tab memory. */
export const store = {
  get persisted() {
    return canPersist;
  },
  get(key: string): string | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
      return localStorage.getItem(key);
    } catch {
      canPersist = false;
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
      return true;
    } catch {
      canPersist = false;
      memory.set(key, value);
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
      memory.delete(key);
    } catch {
      canPersist = false;
      memory.set(key, null);
    }
  },
};

export const KEYS = {
  sandboxNostr: 'cachet.sandbox.nsec',
  sandboxBch: 'cachet.sandbox.wif',
  nostrMode: 'cachet.nostr.mode',
  pendingSign: 'cachet.pending-sign',
  snapshot: (pk: string) => `cachet.snapshot.${pk}`,
};

export interface PendingSign {
  app: string;
  search: string;
  at: number;
}

/** Matches the RP challenge window (180 s) with safety margin so stale login redirects expire cleanly. */
const PENDING_SIGN_TTL_MS = 160_000;
let memPendingSign: string | null = null;

export const savePendingSign = (input: { app: string; search: string }) => {
  if (!input.search.startsWith('?')) return;
  const raw = JSON.stringify({ app: input.app, search: input.search, at: Date.now() } satisfies PendingSign);
  memPendingSign = raw;
  try {
    sessionStorage.setItem(KEYS.pendingSign, raw);
  } catch {
    /* private mode / blocked sessionStorage falls back to tab memory */
  }
};

export const clearPendingSign = () => {
  memPendingSign = null;
  try {
    sessionStorage.removeItem(KEYS.pendingSign);
  } catch {
    /* ignore */
  }
};

export const readPendingSign = (nowMs = Date.now()): PendingSign | null => {
  let raw = memPendingSign;
  if (!raw) {
    try {
      raw = sessionStorage.getItem(KEYS.pendingSign);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSign>;
    if (
      typeof parsed.app !== 'string' ||
      typeof parsed.search !== 'string' ||
      !parsed.search.startsWith('?') ||
      typeof parsed.at !== 'number' ||
      nowMs - parsed.at > PENDING_SIGN_TTL_MS
    ) {
      clearPendingSign();
      return null;
    }
    return { app: parsed.app, search: parsed.search, at: parsed.at };
  } catch {
    clearPendingSign();
    return null;
  }
};

/**
 * Remembers the three newest verified snapshots seen per author: the newest so a relay serving
 * an older copy cannot roll this browser back, the others so a removed claim reads as
 * "withdrawn" rather than "not found".
 */
export const browserCache: SnapshotCache = {
  get(pubkey) {
    try {
      const raw = JSON.parse(store.get(KEYS.snapshot(pubkey)) ?? '[]');
      return Array.isArray(raw) ? raw : [raw];
    } catch {
      return [];
    }
  },
  put(pubkey, event: NostrEvent) {
    const list = browserCache
      .get(pubkey)
      .map((e) => rebuildEvent(e))
      .flatMap((r) =>
        r.ok && r.event.id !== event.id && r.event.pubkey === pubkey && r.event.kind === KIND_EXTERNAL_IDENTITIES && checkEventSignature(r.event).ok
          ? [r.event]
          : [],
      );
    store.set(KEYS.snapshot(pubkey), JSON.stringify([...list, event].sort(compareSnapshots).slice(0, 3)));
  },
};
