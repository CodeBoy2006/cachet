import type { SnapshotCache } from '@cachet/discovery';
import type { LogEntry } from './app.ts';
import { LOG_LIMIT, LOG_PAGE, type RpState } from './state.ts';

export class StorageUnavailable extends Error {
  constructor() {
    super('Demo storage is temporarily unavailable.');
  }
}

const CONSUME = `
local value = redis.call('GET', KEYS[1])
if not value or value == ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'KEEPTTL')
return 1
`;

const NOTE = `
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

const REMEMBER = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYRANK', KEYS[1], 3, -1)
return 1
`;

export const redisStorage = (url: string | undefined, token: string | undefined, origin: string) => {
  const key = (id: string) => `cachet-rp:${origin}:${id}`;
  const run = async <T>(...command: (string | number)[]): Promise<T> => {
    if (!url?.startsWith('https://') || !token) throw new StorageUnavailable();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(command),
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new StorageUnavailable();
      const json = (await res.json()) as { result?: T; error?: unknown };
      if (json.error || !('result' in json)) throw new StorageUnavailable();
      return json.result as T;
    } catch {
      throw new StorageUnavailable();
    }
  };

  const state: RpState = {
    get: async <T>(id: string) => {
      const value = await run<string | null>('GET', key(id));
      return value === null ? undefined : JSON.parse(value) as T;
    },
    set: async (id, value, ttl, onlyIfPresent) =>
      (await run('SET', key(id), JSON.stringify(value), 'EX', ttl, ...(onlyIfPresent ? ['XX'] : []))) === 'OK',
    remove: async (id) => { await run('DEL', key(id)); },
    consumeChallenge: async (id) => (await run('EVAL', CONSUME, 1, key(id), JSON.stringify('used'))) === 1,
    note: async (visitor, entry) => {
      await run('EVAL', NOTE, 1, key(`log:${visitor}`), JSON.stringify(entry), LOG_LIMIT, 24 * 3600);
    },
    log: async (visitor) => (await run<string[]>('LRANGE', key(`log:${visitor}`), 0, LOG_PAGE - 1)).map((value) => JSON.parse(value) as LogEntry),
  };
  const cache: SnapshotCache = {
    get: async (pubkey) => (await run<string[]>('ZRANGE', key(`snapshots:${pubkey}`), 0, 2)).map((value) => JSON.parse(value.slice(65))),
    put: async (pubkey, event) => {
      // Negative score puts the newest timestamp first; the ID prefix breaks ties lexicographically.
      await run('EVAL', REMEMBER, 1, key(`snapshots:${pubkey}`), -event.created_at, `${event.id}:${JSON.stringify(event)}`);
    },
  };
  return { state, cache, ping: async () => (await run('PING')) === 'PONG' };
};
