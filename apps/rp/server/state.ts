import type { LogEntry } from './app.ts';

type MaybePromise<T> = T | Promise<T>;

export interface RpState {
  get<T>(key: string): MaybePromise<T | undefined>;
  set(key: string, value: unknown, ttl: number, onlyIfPresent?: boolean): MaybePromise<boolean>;
  remove(key: string): MaybePromise<void>;
  consumeChallenge(key: string): MaybePromise<boolean>;
  note(visitor: string, entry: LogEntry): MaybePromise<void>;
  log(visitor: string): MaybePromise<LogEntry[]>;
}

export const LOG_LIMIT = 40;
export const LOG_PAGE = 20;

export const memoryState = (now: () => number): RpState => {
  const entries = new Map<string, { value: unknown; expires: number }>();
  const logs = new Map<string, LogEntry[]>();
  const read = (key: string) => {
    const entry = entries.get(key);
    if (entry && entry.expires > now()) return entry;
    entries.delete(key);
    return undefined;
  };

  return {
    get: <T>(key: string) => read(key)?.value as T | undefined,
    set: (key, value, ttl, onlyIfPresent) => {
      for (const k of entries.keys()) read(k);
      if (onlyIfPresent && !entries.has(key)) return false;
      entries.set(key, { value, expires: now() + ttl });
      return true;
    },
    remove: (key) => { entries.delete(key); },
    consumeChallenge: (key) => {
      const entry = read(key);
      if (!entry || entry.value === 'used') return false;
      entry.value = 'used';
      return true;
    },
    note: (visitor, entry) => {
      const log = logs.get(visitor) ?? [];
      logs.delete(visitor);
      logs.set(visitor, log);
      log.unshift(entry);
      log.length = Math.min(log.length, LOG_LIMIT);
      while (logs.size > 500) logs.delete(logs.keys().next().value!);
    },
    log: (visitor) => (logs.get(visitor) ?? []).slice(0, LOG_PAGE),
  };
};
