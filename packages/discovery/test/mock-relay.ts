import { setRelaySocketFactory, type SocketLike } from '../src/relay.ts';

export type RelayMode = 'normal' | 'reject' | 'silent' | 'auth' | 'close';

interface StoredEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
}

const matches = (e: StoredEvent, f: Record<string, unknown>) => {
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('#') || !Array.isArray(v)) continue;
    const name = k.slice(1);
    if (!e.tags.some((t) => t[0] === name && v.includes(t[1]))) return false;
  }
  return true;
};

const servers = new Map<string, (client: MockSocket) => void>();
let nextPort = 47000;

class MockSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onPeerMessage?: (raw: string) => void;

  deliver(data: string) {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data } as MessageEvent);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1) throw new Error('Socket not open');
    const raw = typeof data === 'string' ? data : String(data);
    queueMicrotask(() => this.onPeerMessage?.(raw));
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({} as CloseEvent));
  }
}

const ensureFactory = () =>
  setRelaySocketFactory((url) => {
    const handler = servers.get(url);
    const sock = new MockSocket();
    if (!handler) {
      queueMicrotask(() => {
        sock.readyState = 3;
        sock.onerror?.(new Event('error'));
        sock.onclose?.({} as CloseEvent);
      });
      return sock;
    }
    queueMicrotask(() => handler(sock));
    return sock;
  });

/** In-memory relay for deterministic failure tests: rejects, timeouts, AUTH, stale copies. */
export const startMockRelay = async (mode: RelayMode = 'normal', opts: { keepHistory?: boolean } = {}) => {
  const url = `ws://127.0.0.1:${++nextPort}`;
  const events: StoredEvent[] = [];
  const state = { mode };
  ensureFactory();

  servers.set(url, (client) => {
    if (state.mode === 'close') {
      client.readyState = 3;
      client.onerror?.(new Event('error'));
      client.onclose?.({} as CloseEvent);
      return;
    }
    client.onPeerMessage = (raw) => {
      if (client.readyState !== 1) return;
      const msg = JSON.parse(raw);
      if (msg[0] === 'EVENT') {
        const e = msg[1] as StoredEvent;
        if (state.mode === 'silent') return;
        if (state.mode === 'reject') return client.deliver(JSON.stringify(['OK', e.id, false, 'blocked: not accepted']));
        if (state.mode === 'auth') return client.deliver(JSON.stringify(['OK', e.id, false, 'auth-required: sign in first']));
        if (!opts.keepHistory && e.kind >= 10000 && e.kind < 20000) {
          for (let i = events.length - 1; i >= 0; i--) {
            if (events[i]!.pubkey === e.pubkey && events[i]!.kind === e.kind) events.splice(i, 1);
          }
        }
        events.push(e);
        client.deliver(JSON.stringify(['OK', e.id, true, '']));
      } else if (msg[0] === 'REQ') {
        const [, id, ...filters] = msg as [string, string, ...Record<string, unknown>[]];
        if (state.mode === 'silent') return;
        if (state.mode === 'auth') return client.deliver(JSON.stringify(['CLOSED', id, 'auth-required: sign in first']));
        for (const e of events) if (filters.some((f) => matches(e, f))) client.deliver(JSON.stringify(['EVENT', id, e]));
        client.deliver(JSON.stringify(['EOSE', id]));
      }
    };
    client.readyState = 1;
    client.onopen?.(new Event('open'));
  });

  return {
    url,
    events,
    state,
    seed: (...e: StoredEvent[]) => events.push(...e),
    close: async () => {
      servers.delete(url);
      if (servers.size === 0) setRelaySocketFactory(undefined);
    },
  };
};
