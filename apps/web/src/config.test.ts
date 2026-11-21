import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('example app links', () => {
  it.each([
    { host: 'cachet.example', urls: [] },
    { host: 'localhost', urls: ['http://localhost:5174', 'http://localhost:5175'] },
    { host: 'cachet.example', fieldnote: 'https://fieldnote.example', urls: ['https://fieldnote.example'] },
  ])('only lists available apps on $host', async ({ host, fieldnote, urls }) => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_RP_A_URL', fieldnote);
    vi.stubEnv('VITE_RP_B_URL', undefined);
    vi.stubGlobal('location', { hostname: host });
    const { config } = await import('./config.ts');
    expect(config.apps.map((app) => app.url)).toEqual(urls);
  });
});

describe('featured home identity', () => {
  it('defaults to the live mainnet npub on public production hosts', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURED_NPUB', undefined);
    vi.stubEnv('VITE_RELAYS', undefined);
    vi.stubGlobal('location', { hostname: 'cachet-three.vercel.app' });
    const { config, DEFAULT_FEATURED_NPUB } = await import('./config.ts');
    expect(config.featured).toBe(DEFAULT_FEATURED_NPUB);
  });

  it('stays unset on localhost or custom relays unless explicitly configured', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FEATURED_NPUB', undefined);
    vi.stubEnv('VITE_RELAYS', 'ws://127.0.0.1:7777');
    vi.stubGlobal('location', { hostname: 'cachet-three.vercel.app' });
    const { config } = await import('./config.ts');
    expect(config.featured).toBeUndefined();
  });
});
