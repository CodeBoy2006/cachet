import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { brandOf } from '../shared/brands.ts';
import { createApp } from './app.ts';
import { createRelayResolver } from './resolver.ts';

const brand = brandOf(process.env.RP);
const production = process.env.NODE_ENV === 'production';
const hostname = process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
// Hosts set PORT in production; in dev the API sits behind the Vite proxy on a fixed port.
const port = Number(production ? (process.env.PORT ?? brand.uiPort) : (process.env.API_PORT ?? brand.apiPort));
const origin = (process.env.ORIGIN ?? `http://localhost:${brand.uiPort}`).replace(/\/$/, '');
const { relays, resolve } = createRelayResolver(process.env.RELAYS);

const app = createApp({ brand, origin, resolve });

if (production) {
  const root = relative(process.cwd(), fileURLToPath(new URL(`../dist/${brand.id}`, import.meta.url)));
  app.all('/api/*', (c) => c.json({ ok: false, code: 'not_found' }, 404));
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`${brand.name} API on :${port} · origin ${origin} · relays ${relays.join(', ')}`);
});
