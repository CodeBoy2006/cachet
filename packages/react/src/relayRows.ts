import type { RelayQueryResult } from '@cachet/discovery';
import type { Resolution } from '@cachet/core';
import type { RelayRow } from './RelayList.tsx';

/** Describes what each relay contributed to a resolution, in words a person can act on. */
export const relayRowsFromLookup = (relays: RelayQueryResult[], resolution: Resolution | undefined, pending: string[] = []): RelayRow[] => {
  const latestId = resolution?.latest?.id;
  const rows: RelayRow[] = relays.map((r) => {
    if (r.status !== 'ok') {
      const note = r.status === 'timeout' ? 'No answer' : r.status === 'auth-required' ? 'Requires AUTH' : 'Unreachable';
      return { url: r.url, tone: r.status === 'timeout' ? 'warn' : 'bad', note, ms: r.ms };
    }
    const snapshots = r.events.filter((e) => (e as { kind?: number })?.kind === 10011) as { id?: string }[];
    if (!snapshots.length) return { url: r.url, tone: 'idle', note: 'No snapshot', ms: r.ms };
    const hasLatest = snapshots.some((e) => e.id === latestId);
    return {
      url: r.url,
      tone: hasLatest ? 'good' : 'warn',
      note: hasLatest ? 'Latest snapshot' : 'Older snapshot',
      ms: r.ms,
    };
  });
  for (const url of pending) if (!rows.some((r) => r.url === url)) rows.push({ url, tone: 'wait', note: 'Asking…' });
  return rows;
};
