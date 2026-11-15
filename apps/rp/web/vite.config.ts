import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { brandOf } from '../shared/brands.ts';

const brand = brandOf(process.env.VITE_RP);
process.env.VITE_RP_TITLE = `${brand.name} · example app`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { conditions: ['@cachet/source'] },
  build: { target: 'es2022', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: `http://127.0.0.1:${brand.apiPort}` } },
  },
});
