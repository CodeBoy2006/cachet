// Renders exact film times to PNG: node tools/frames.mjs <outDir> 0 2.5 20.1 ...
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outDir, ...times] = process.argv.slice(2);
const scale = Number(process.env.SCALE ?? 1);
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5180/?clean&w=${1920 * scale}&h=${1080 * scale}`);
await page.waitForFunction(() => window.__film, null, { timeout: 30000 });
for (const t of times) {
  const data = await page.evaluate((s) => {
    window.__film.renderAt(Number(s));
    return document.getElementById('film').toDataURL('image/png');
  }, t);
  const file = path.join(outDir, `t${String(Number(t).toFixed(2)).padStart(6, '0')}.png`);
  await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(file);
}
await browser.close();
