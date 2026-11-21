import { lookup } from 'node:dns';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { isPrivateIp, isPublicRelayUrl, type SocketLike } from '@cachet/discovery';
import WebSocket from 'ws';
import { brandOf } from '../shared/brands.ts';
import { createApp } from './app.ts';
import { redisStorage, StorageUnavailable } from './redis.ts';
import { createRelayResolver } from './resolver.ts';

declare const RP_BRAND: string;
declare const RP_ORIGIN: string;

const origin = RP_ORIGIN;
const brand = brandOf(RP_BRAND);
const env = process.env;
const storage = redisStorage(
  env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL,
  env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN,
  origin,
);

const socket = (url: string): SocketLike => {
  if (!isPublicRelayUrl(url)) throw new Error('Relay must use public WSS');
  return new WebSocket(url, {
    followRedirects: false,
    maxPayload: 256 * 1024,
    lookup: (host, options, done) => {
      // Gate the IPs used by this connection, not a separate DNS lookup.
      lookup(host, { all: true, family: options.family, order: 'ipv4first' }, (error, records) => {
        const addresses = records?.filter(({ address, family }) => !isPrivateIp(address) && (family === 4 || /^[23]/.test(address)));
        if (error || !addresses?.length || addresses.length !== records.length) {
          done(error ?? new Error('Relay DNS did not return a public address'), '', 0);
        } else if (options.all) {
          done(null, addresses);
        } else {
          done(null, addresses[0]!.address, addresses[0]!.family);
        }
      });
    },
  }) as unknown as SocketLike;
};
const { resolve } = createRelayResolver(undefined, { cache: storage.cache, socket });
const app = createApp({ brand, origin, resolve, state: storage.state });
app.onError((err, c) => {
  if (err instanceof StorageUnavailable) return c.json({ ok: false, code: 'network', message: err.message }, 503);
  console.error(err);
  return c.json({ ok: false, code: 'network', message: 'The demo server could not complete the request.' }, 500);
});

const listen = getRequestListener(async (request) => {
  if (new URL(request.url).pathname === '/api/health') {
    const ready = await storage.ping().catch(() => false);
    if (!ready) return Response.json({ ok: false, name: brand.name, origin, storage: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return app.fetch(request);
});

export default (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', origin);
  if (url.pathname === '/__rp') {
    const route = url.searchParams.get('__rp_route') ?? '';
    url.pathname = `/api/${route}`;
    url.searchParams.delete('__rp_route');
    req.url = url.pathname + url.search;
  }
  return listen(req, res);
};
