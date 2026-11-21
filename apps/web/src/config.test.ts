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
