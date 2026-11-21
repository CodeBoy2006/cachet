/**
 * A deliberately small relay client: one socket per call, explicit outcome per relay.
 * Discovery needs per-relay evidence (who answered, what, how fast), not a pool
 * that hides failures.
 */
export type RelayStatus = 'ok' | 'timeout' | 'error' | 'closed' | 'auth-required';

export interface RelayQueryResult {
  url: string;
  status: RelayStatus;
  events: unknown[];
  ms: number;
  message?: string;
}

export interface PublishResult {
  url: string;
  ok: boolean;
  status: 'accepted' | 'rejected' | 'timeout' | 'error' | 'auth-required';
  message?: string;
  ms: number;
}

export type Filter = Record<string, unknown>;

export const normalizeRelayUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
    url.hash = '';
    const out = url.toString();
    return out.endsWith('/') && url.pathname === '/' ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
};

export const uniqueRelays = (...lists: (readonly string[] | undefined)[]): string[] => [
  ...new Set(lists.flatMap((l) => l ?? []).map(normalizeRelayUrl).filter((u): u is string => !!u)),
];

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

export const isPrivateIp = (raw: string): boolean => {
  const ip = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]!.toLowerCase();
  if (isPrivateIpv4(ip)) return true;
  if (!ip.includes(':')) return false;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:0' || ip === '0:0:0:0:0:0:0:1') return true;
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (tail.includes('.')) return isPrivateIpv4(tail);
    const [hi, lo] = tail.split(':').map((x) => parseInt(x, 16));
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return isPrivateIpv4(`${(hi! >> 8) & 255}.${hi! & 255}.${(lo! >> 8) & 255}.${lo! & 255}`);
    }
    return true;
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  return ip.startsWith('2001:db8:') || ip.startsWith('100::') || ip.startsWith('64:ff9b:');
};

/** True only for `wss://` relays on public DNS/IPv4 hosts (blocks loopback, RFC1918, link-local, IPv6 literals, and `.local`). */
export const isPublicRelayUrl = (raw: string): boolean => {
  const norm = normalizeRelayUrl(raw);
  if (!norm) return false;
  const url = new URL(norm);
  if (url.protocol !== 'wss:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || !host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isPrivateIp(host)) return false;
  return true;
};

const subId = () => Math.random().toString(36).slice(2, 10);
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export type SocketLike = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onerror' | 'onclose' | 'onmessage'>;

let openSocket: (url: string) => SocketLike = (url) => new WebSocket(url);

/** Test seam for deterministic in-memory relays when local TCP sockets are unavailable. */
export const setRelaySocketFactory = (factory?: (url: string) => SocketLike) => {
  openSocket = factory ?? ((url) => new WebSocket(url));
};

const parse = (data: unknown): unknown[] | null => {
  try {
    const value = JSON.parse(typeof data === 'string' ? data : String(data));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

export const queryRelay = (url: string, filters: Filter[], opts: { timeout?: number; maxEvents?: number; socket?: (url: string) => SocketLike } = {}) =>
  new Promise<RelayQueryResult>((resolve) => {
    const started = clock();
    const id = subId();
    const events: unknown[] = [];
    let settled = false;
    let ws: SocketLike;
    const done = (status: RelayStatus, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', id]));
        ws.close();
      } catch {
        /* socket already gone */
      }
      resolve({ url, status, events, ms: Math.round(clock() - started), ...(message ? { message } : {}) });
    };
    const timer = setTimeout(() => done('timeout'), opts.timeout ?? 4500);
    try {
      ws = (opts.socket ?? openSocket)(url);
    } catch (e) {
      clearTimeout(timer);
      resolve({ url, status: 'error', events, ms: 0, message: String(e) });
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', id, ...filters]));
    ws.onerror = () => done('error', 'connection failed');
    ws.onclose = () => done('error', 'connection closed');
    ws.onmessage = (msg) => {
      const m = parse(msg.data);
      if (!m) return;
      if (m[0] === 'EVENT' && m[1] === id) {
        events.push(m[2]);
        if (events.length >= (opts.maxEvents ?? 200)) done('ok', 'truncated');
      } else if (m[0] === 'EOSE' && m[1] === id) done('ok');
      else if (m[0] === 'CLOSED' && m[1] === id) {
        const reason = String(m[2] ?? '');
        done(reason.startsWith('auth-required') ? 'auth-required' : 'closed', reason);
      }
    };
  });

export const publishToRelay = (url: string, event: { id: string }, opts: { timeout?: number } = {}) =>
  new Promise<PublishResult>((resolve) => {
    const started = clock();
    let settled = false;
    let ws: SocketLike;
    const done = (r: Omit<PublishResult, 'url' | 'ms'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ url, ms: Math.round(clock() - started), ...r });
    };
    const timer = setTimeout(() => done({ ok: false, status: 'timeout' }), opts.timeout ?? 7000);
    try {
      ws = openSocket(url);
    } catch (e) {
      clearTimeout(timer);
      resolve({ url, ok: false, status: 'error', message: String(e), ms: 0 });
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onerror = () => done({ ok: false, status: 'error', message: 'connection failed' });
    ws.onclose = () => done({ ok: false, status: 'error', message: 'connection closed' });
    ws.onmessage = (msg) => {
      const m = parse(msg.data);
      if (!m || m[0] !== 'OK' || m[1] !== event.id) return;
      const message = String(m[3] ?? '');
      if (m[2] === true) done({ ok: true, status: 'accepted', ...(message ? { message } : {}) });
      else done({ ok: false, status: message.startsWith('auth-required') ? 'auth-required' : 'rejected', message });
    };
  });
