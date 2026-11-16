// Renders the score in the browser and writes it as WAV: node tools/audio.mjs out.wav
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'cachet-film.wav';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
await page.goto('http://localhost:5180/?clean&live&w=480&h=270');
await page.waitForFunction(() => window.__film, null, { timeout: 30000 });
const t0 = Date.now();
const b64 = await page.evaluate(async () => {
  const blob = await window.__film.wav();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
await writeFile(out, Buffer.from(b64, 'base64'));
console.log('wrote', out, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
