/**
 * Optional single-process multi-origin production host.
 *
 * Serves Cachet (`apps/web/dist`), Fieldnote (`RP=a`) and Stall (`RP=b`) on one
 * port by matching the HTTP `Host` header. In the browser they remain three
 * distinct origins with isolated cookies, challenges, sessions and relay caches,
 * while avoiding cold-start delays from running three separate containers.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative } from 'node:path';
import { BRANDS } from '../shared/brands.ts';
import { createApp, type Resolver } from './app.ts';
import { createRelayResolver } from './resolver.ts';

const normalizeHost = (raw: string | undefined, protocol = 'https:'): string => {
  if (!raw) return '';
  try {
    return new URL(`${protocol}//${raw.trim()}`).host.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
};

const hostOfOrigin = (origin: string): string => {
  const u = new URL(origin);
  return normalizeHost(u.host, u.protocol);
};

export interface GatewayOptions {
  rpAOrigin: string;
  rpBOrigin: string;
  webOrigin?: string;
  resolveA: Resolver;
  resolveB: Resolver;
  webApp?: { fetch: (req: Request) => Response | Promise<Response> };
  attachStatic?: (app: Hono, id: 'a' | 'b') => void;
}

export const createGateway = (opts: GatewayOptions) => {
  const originA = opts.rpAOrigin.replace(/\/$/, '');
  const originB = opts.rpBOrigin.replace(/\/$/, '');
  const protoA = new URL(originA).protocol;
  const protoB = new URL(originB).protocol;
  const hostA = hostOfOrigin(originA);
  const hostB = hostOfOrigin(originB);
  const hostWeb = opts.webOrigin ? hostOfOrigin(opts.webOrigin.replace(/\/$/, '')) : undefined;
  const protoWeb = opts.webOrigin ? new URL(opts.webOrigin).protocol : 'https:';

  if (hostA === hostB || (hostWeb && (hostWeb === hostA || hostWeb === hostB))) {
    throw new Error('Gateway origins must have distinct hosts so each app keeps its own origin.');
  }

  const appA = createApp({ brand: BRANDS.a, origin: originA, resolve: opts.resolveA });
  const appB = createApp({ brand: BRANDS.b, origin: originB, resolve: opts.resolveB });
  opts.attachStatic?.(appA, 'a');
  opts.attachStatic?.(appB, 'b');

  return {
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (url.pathname === '/healthz') return Response.json({ ok: true, hosts: { a: hostA, b: hostB, ...(hostWeb ? { web: hostWeb } : {}) } });
      const rawHost = req.headers.get('host') ?? url.host;
      if (normalizeHost(rawHost, protoA) === hostA) return appA.fetch(req);
      if (normalizeHost(rawHost, protoB) === hostB) return appB.fetch(req);
      if (opts.webApp && (!hostWeb || normalizeHost(rawHost, protoWeb) === hostWeb)) return opts.webApp.fetch(req);
      return Response.json({ ok: false, error: 'Unknown host' }, { status: 404 });
    },
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8080);
  const hostname = process.env.HOST ?? '0.0.0.0';
  const rpAOrigin = process.env.RP_A_ORIGIN ?? `http://fieldnote.localhost:${port}`;
  const rpBOrigin = process.env.RP_B_ORIGIN ?? `http://stall.localhost:${port}`;
  const webOrigin = process.env.WEB_ORIGIN;

  const resolverA = createRelayResolver(process.env.RELAYS);
  const resolverB = createRelayResolver(process.env.RELAYS);

  const attachStatic = (app: Hono, id: 'a' | 'b') => {
    const root = relative(process.cwd(), fileURLToPath(new URL(`../dist/${id}`, import.meta.url)));
    app.all('/api/*', (c) => c.json({ ok: false, code: 'not_found' }, 404));
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  };

  const webRoot = relative(process.cwd(), fileURLToPath(new URL('../../web/dist', import.meta.url)));
  const webApp = new Hono();
  webApp.use('/*', serveStatic({ root: webRoot }));
  webApp.get('*', serveStatic({ root: webRoot, path: 'index.html' }));

  const gateway = createGateway({
    rpAOrigin,
    rpBOrigin,
    ...(webOrigin ? { webOrigin } : {}),
    resolveA: resolverA.resolve,
    resolveB: resolverB.resolve,
    webApp,
    attachStatic,
  });

  serve({ fetch: gateway.fetch, port, hostname }, () => {
    console.log(`Cachet gateway on :${port} · Fieldnote=${rpAOrigin} · Stall=${rpBOrigin} · Web=${webOrigin ?? '*'}`);
  });
}
