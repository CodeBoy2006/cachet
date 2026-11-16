import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5180/?clean');
await page.waitForFunction(() => window.__film, null, { timeout: 60000 });
const res = await page.evaluate(() => {
  const gl = document.getElementById('film').getContext('webgl2');
  const px = new Uint8Array(4);
  const rows = [];
  for (let t = 0; t <= 62; t += 1 / 24) {
    const t0 = performance.now();
    window.__film.renderAt(t);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    rows.push([t, performance.now() - t0]);
  }
  const ms = rows.map((r) => r[1]).sort((a, b) => a - b);
  const worst = rows.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, m]) => `${t.toFixed(2)}s:${m.toFixed(0)}ms`);
  return { frames: ms.length, median: ms[ms.length >> 1].toFixed(1), p95: ms[Math.floor(ms.length * 0.95)].toFixed(1), worst };
});
console.log(JSON.stringify(res));
await browser.close();
