/**
 * Local Nostr relay for offline demos and tests: NIP-01 REQ/EVENT/CLOSE with
 * replaceable-event semantics, in memory. Not for production.
 *
 *   npx tsx scripts/dev-relay.ts [port]
 */
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';

const port = Number(process.argv[2] ?? process.env.PORT ?? 7777);
type Ev = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string };
const events: Ev[] = [];

const matches = (e: Ev, f: Record<string, unknown>) => {
  if (Array.isArray(f.ids) && !f.ids.includes(e.id)) return false;
  if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false;
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false;
  if (typeof f.since === 'number' && e.created_at < f.since) return false;
  if (typeof f.until === 'number' && e.created_at > f.until) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith('#') && Array.isArray(v) && !e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1]))) return false;
  }
  return true;
};

const isReplaceable = (k: number) => k === 0 || k === 3 || (k >= 10000 && k < 20000);

const wss = new WebSocketServer({ port, host: '127.0.0.1' });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: unknown[];
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg[0] === 'EVENT') {
      const e = msg[1] as Ev;
      if (!verifyEvent({ ...e })) return ws.send(JSON.stringify(['OK', e?.id, false, 'invalid: bad signature']));
      if (e.kind >= 20000 && e.kind < 30000) return ws.send(JSON.stringify(['OK', e.id, true, 'ephemeral']));
      if (isReplaceable(e.kind)) {
        const prev = events.findIndex((x) => x.pubkey === e.pubkey && x.kind === e.kind);
        if (prev >= 0) {
          const p = events[prev]!;
          if (p.created_at > e.created_at || (p.created_at === e.created_at && p.id <= e.id)) {
            return ws.send(JSON.stringify(['OK', e.id, true, 'duplicate: have a newer event']));
          }
          events.splice(prev, 1);
        }
      }
      if (!events.some((x) => x.id === e.id)) events.push(e);
      console.log(`EVENT kind ${e.kind} from ${e.pubkey.slice(0, 8)}`);
      ws.send(JSON.stringify(['OK', e.id, true, '']));
    } else if (msg[0] === 'REQ') {
      const [, id, ...filters] = msg as [string, string, ...Record<string, unknown>[]];
      const out = events.filter((e) => filters.some((f) => matches(e, f))).sort((a, b) => b.created_at - a.created_at);
      for (const e of out.slice(0, 500)) ws.send(JSON.stringify(['EVENT', id, e]));
      ws.send(JSON.stringify(['EOSE', id]));
    } else if (msg[0] === 'CLOSE') {
      ws.send(JSON.stringify(['CLOSED', msg[1], '']));
    }
  });
});
console.log(`dev relay on ws://127.0.0.1:${port}`);
