import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { build } from 'vite';

const output = process.argv[2];
const brand = process.env.VITE_RP;
if (!output || !isAbsolute(output) || !['a', 'b'].includes(brand)) {
  throw new Error('Set VITE_RP to a or b and pass a new absolute .vercel/output path.');
}
const origin = (name) => {
  const raw = process.env[name]?.replace(/\/$/, '');
  const parsed = raw ? new URL(raw) : undefined;
  if (parsed?.protocol !== 'https:' || parsed.origin !== raw) throw new Error(`Set ${name} to an HTTPS origin.`);
  return parsed.origin;
};
const appOrigin = origin('RP_VERCEL_ORIGIN');
const cachetOrigin = origin('VITE_CACHET_URL');
const siblingOrigin = origin('VITE_SIBLING_URL');
if (new Set([appOrigin, cachetOrigin, siblingOrigin]).size !== 3) throw new Error('Cachet and both apps need distinct origins.');

await mkdir(output);
await build({ configFile: 'web/vite.config.ts', build: { outDir: join(output, 'static') } });
const func = join(output, 'functions', '__rp.func');
await build({
  configFile: false,
  define: { RP_BRAND: JSON.stringify(brand), RP_ORIGIN: JSON.stringify(appOrigin) },
  resolve: { conditions: ['@cachet/source', 'node', 'module'] },
  ssr: { noExternal: true, resolve: { conditions: ['@cachet/source', 'node', 'module'] } },
  build: { ssr: 'server/vercel.ts', outDir: func, emptyOutDir: false, minify: true, rolldownOptions: { output: { entryFileNames: 'index.mjs' } } },
});

const json = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
await json(join(func, '.vc-config.json'), {
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  maxDuration: 30,
  shouldAddHelpers: false,
});
await json(join(output, 'config.json'), {
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/__rp?__rp_route=$1' },
    { handle: 'filesystem' },
  ],
});
